import { diffOffsetsOf, explainDiff, isMinorDiff } from '../project/bankDiff';
import { bytesEqual } from '../lib/bytes';
import { err, ok, type Result } from '../lib/result';
import type { ReceivedBank } from '../midi/patternTransfer';
import { GLOBAL } from '../project/layout';

/**
 * Transaction d'écriture vers l'OP-Z — le SEUL chemin autorisé pour écrire (CLAUDE.md).
 *
 *   1. relire l'état actuel de l'appareil (banque + global si nécessaire) ;
 *   2. enregistrer ce checkpoint (échec ⇒ on n'écrit rien) ;
 *   3. vérifier le projet cible et les modifications faites sur l'appareil depuis l'import ;
 *   4. écrire ; 5. RELIRE et comparer octet par octet ;
 *   6. en cas d'échec ou d'écart : réécrire le checkpoint et le relire.
 *
 * États distincts : envoyé ≠ acquitté ($0B) ≠ confirmé par relecture.
 */
export interface DeviceWriter {
  readPatternBank(): Promise<Result<ReceivedBank, Error>>;
  writePatternBank(bank: Uint8Array, address: number, transferId: number): Promise<Result<{ packets: number }, Error>>;
  readGlobal(fresh?: boolean): Promise<Result<Uint8Array, Error>>;
  writeGlobal(global: Uint8Array): Promise<Result<void, Error>>;
}

export interface Checkpoint {
  id: string;
  createdAt: string;
  label: string;
  /** Adresse $09 lue : quartet haut = projet de l'OP-Z. */
  address: number;
  transferId: number;
  /** null pour une sauvegarde qui ne concerne que les réglages de sons. */
  bank: Uint8Array | null;
  global: Uint8Array | null;
  /** settings/slotConfiguration.json d'avant (sauvegarde d'une installation de son). */
  slotConfiguration?: Uint8Array | null;
}

export interface PushTarget {
  bank: Uint8Array;
  /** null = ne pas toucher au global. */
  global: Uint8Array | null;
}

export interface PushOptions {
  label: string;
  saveCheckpoint: (cp: Checkpoint) => Promise<Result<void, Error>>;
  /** Question à l'utilisateur ; false = annuler sans rien écrire. */
  confirm: (message: string) => Promise<boolean>;
  /** Projet OP-Z d'origine (0..15) si connu. */
  expectedProject?: number | null;
  /** Octets de référence du projet (import) : sert à détecter des modifications faites sur l'appareil. */
  baselineBank?: Uint8Array | null;
  /**
   * Écart toléré (octets) entre l'OP-Z et `baselineBank` sans demander : les réglages envoyés en
   * direct (CC) créent de petits écarts ; un écart massif signifie un autre projet ou de gros changements.
   */
  baselineTolerance?: number;
  progress?: (step: string) => void;
}

export type PushOutcome =
  | { status: 'cancelled' }
  | { status: 'unchanged'; checkpointId: string }
  | { status: 'confirmed'; checkpointId: string; project: number; bankBytes: number; globalBytes: number };

export const projectOfAddress = (address: number): number => (address >> 4) & 0x0f;

/** Le tampon de chaîne active (480..511) est reconstruit par l'OP-Z à chaque sélection de pattern : exclu des comparaisons. */
export function globalStableEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (i >= GLOBAL.ACTIVE_CHAIN && i < GLOBAL.ACTIVE_CHAIN + GLOBAL.CHAIN_RECORD_SIZE) continue;
    if (a[i] !== b[i]) return false;
  }
  return true;
}

const countDiff = (a: Uint8Array, b: Uint8Array) => a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0);

export async function pushToOpz(device: DeviceWriter, target: PushTarget, options: PushOptions): Promise<Result<PushOutcome, Error>> {
  const step = options.progress ?? (() => undefined);

  // 1. Checkpoint
  step('Sauvegarde de l’état actuel de l’OP-Z (checkpoint)…');
  const bank0 = await device.readPatternBank();
  if (!bank0.ok) return err(new Error(`checkpoint impossible, rien n’a été écrit : ${bank0.error.message}`));
  let global0: Uint8Array | null = null;
  if (target.global) {
    step('Relecture du bloc global (session neuve, ~7 s)…');
    const g = await device.readGlobal(true);
    if (!g.ok) return err(new Error(`checkpoint du global impossible, rien n’a été écrit : ${g.error.message}`));
    global0 = g.value;
  }
  const checkpoint: Checkpoint = {
    id: `cp-${Date.now()}`,
    createdAt: new Date().toISOString(),
    label: options.label,
    address: bank0.value.address,
    transferId: bank0.value.transferId,
    bank: bank0.value.bank,
    global: global0,
  };
  const saved = await options.saveCheckpoint(checkpoint);
  if (!saved.ok) return err(new Error(`checkpoint non enregistré, rien n’a été écrit : ${saved.error.message}`));

  // 2. Contrôles avant écriture
  const project = projectOfAddress(bank0.value.address);
  if (options.expectedProject != null && options.expectedProject !== project) {
    const go = await options.confirm(
      `L’OP-Z est actuellement sur le projet ${project + 1}, alors que ce projet a été importé depuis le projet ${options.expectedProject + 1}.\n\n` +
      `Écrire quand même dans le projet ${project + 1} ? (son contenu actuel est sauvegardé dans un checkpoint)`,
    );
    if (!go) return ok({ status: 'cancelled' });
  }
  if (options.baselineBank && !bytesEqual(options.baselineBank, bank0.value.bank) && countDiff(options.baselineBank, bank0.value.bank) > (options.baselineTolerance ?? 0)) {
    const go = await options.confirm(
      `L’OP-Z a été modifié depuis l’import (${countDiff(options.baselineBank, bank0.value.bank)} octets différents).\n\n` +
      'Ces modifications faites sur l’appareil vont être remplacées par le projet de l’éditeur. Continuer ? (un checkpoint vient d’être enregistré)',
    );
    if (!go) return ok({ status: 'cancelled' });
  }

  // Le tampon de chaîne active reste celui de l'appareil.
  let targetGlobal: Uint8Array | null = null;
  if (target.global && global0) {
    targetGlobal = target.global.slice();
    targetGlobal.set(global0.subarray(GLOBAL.ACTIVE_CHAIN, GLOBAL.ACTIVE_CHAIN + GLOBAL.CHAIN_RECORD_SIZE), GLOBAL.ACTIVE_CHAIN);
  }
  const bankChanged = !bytesEqual(target.bank, bank0.value.bank);
  const globalChanged = targetGlobal !== null && global0 !== null && !globalStableEqual(targetGlobal, global0);
  if (!bankChanged && !globalChanged) return ok({ status: 'unchanged', checkpointId: checkpoint.id });

  let bankWritten = false;
  let globalWritten = false;
  const fail = async (reason: string): Promise<Result<PushOutcome, Error>> => {
    step('Échec : retour arrière vers le checkpoint…');
    const restored = await rollback(device, checkpoint, bankWritten, globalWritten);
    return err(new Error(`${reason}. ${restored}`));
  };

  // 3. Banque
  if (bankChanged) {
    step('Écriture des patterns…');
    bankWritten = true; // même un envoi partiel doit être défait
    const w = await device.writePatternBank(target.bank, bank0.value.address, bank0.value.transferId);
    if (!w.ok) return fail(`écriture des patterns interrompue : ${w.error.message}`);
    step('Relecture de vérification des patterns…');
    const check = await verifyBank(device, target.bank, step);
    if (!check.ok) return fail(check.error.message);
  }

  // 4. Global
  if (globalChanged && targetGlobal) {
    step('Écriture du tempo et des chaînes…');
    globalWritten = true;
    const w = await device.writeGlobal(targetGlobal);
    if (!w.ok) return fail(`écriture du global interrompue : ${w.error.message}`);
    step('Relecture de vérification du global (session neuve, ~7 s)…');
    const back = await device.readGlobal(true);
    if (!back.ok) return fail(`relecture du global impossible : ${back.error.message}`);
    if (!globalStableEqual(back.value, targetGlobal)) return fail('la relecture du global diffère de ce qui a été envoyé');
  }

  return ok({
    status: 'confirmed',
    checkpointId: checkpoint.id,
    project,
    bankBytes: bankChanged ? countDiff(target.bank, bank0.value.bank) : 0,
    globalBytes: globalChanged && targetGlobal && global0 ? countDiff(targetGlobal, global0) : 0,
  });
}

/**
 * Relit la banque et la compare à ce qui a été écrit. Un écart minime sur des octets que l'OP-Z
 * change tout seul (réglages tournés pendant l'écriture, âge des notes, octets internes) est
 * toléré et journalisé ; tout autre écart est une erreur. Une seconde relecture lève les doutes.
 */
async function verifyBank(device: DeviceWriter, expected: Uint8Array, step: (s: string) => void): Promise<Result<void, Error>> {
  let offsets: number[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 400));
    const back = await device.readPatternBank();
    if (!back.ok) return err(new Error(`relecture impossible : ${back.error.message}`));
    offsets = diffOffsetsOf(back.value.bank, expected);
    if (!offsets.length) return ok(undefined);
  }
  if (isMinorDiff(offsets)) {
    step(`Relecture : ${offsets.length} octet(s) changé(s) par l’OP-Z lui-même, tolérés (${explainDiff(offsets)}).`);
    return ok(undefined);
  }
  return err(new Error(`la relecture diffère de ce qui a été envoyé (${offsets.length} octets : ${explainDiff(offsets)})`));
}

/** Réécrit le checkpoint et vérifie par relecture. Renvoie un message lisible. */
export async function rollback(device: DeviceWriter, cp: Checkpoint, bank: boolean, global: boolean): Promise<string> {
  const problems: string[] = [];
  if (bank && cp.bank) {
    const w = await device.writePatternBank(cp.bank, cp.address, cp.transferId);
    const check = w.ok ? await verifyBank(device, cp.bank, () => undefined) : null;
    if (!w.ok) problems.push(`réécriture des patterns : ${w.error.message}`);
    else if (check && !check.ok) problems.push(`patterns remis : ${check.error.message}`);
  }
  if (global && cp.global) {
    const w = await device.writeGlobal(cp.global);
    const back = w.ok ? await device.readGlobal(true) : null;
    if (!w.ok) problems.push(`réécriture du global : ${w.error.message}`);
    else if (!back?.ok) problems.push(`relecture du global : ${back?.error.message}`);
    else if (!globalStableEqual(back.value, cp.global)) problems.push('le global relu ne correspond pas au checkpoint');
  }
  return problems.length
    ? `RETOUR ARRIÈRE INCOMPLET (${problems.join(' ; ')}). Utilisez « Restaurer » sur le checkpoint ${cp.id}.`
    : 'L’OP-Z a été remis dans son état d’avant (vérifié par relecture).';
}
