import { bytesEqual } from '../lib/bytes';
import { err, ok, type Result } from '../lib/result';
import { FILE_ID, type HostedFile } from '../midi/fileServer';
import type { Checkpoint } from './pushToOpz';

/**
 * Installer un son dans un emplacement d'une piste = modifier
 * settings/slotConfiguration.json sur l'OP-Z (op-z-sysex docs/clean-room-file-transport.md,
 * tools/opz-slot-map-edit.py). Même garde-fou que pushToOpz :
 * lecture + sauvegarde → envoi → relecture exacte → sinon, remise de l'original et relecture.
 */
export interface FileDevice {
  readDeviceFiles(fileIds: readonly number[]): Promise<Result<Map<number, Uint8Array>, Error>>;
  uploadDeviceFiles(files: HostedFile[]): Promise<Result<void, Error>>;
}

export const SLOT_MAP_PATH = 'settings/slotConfiguration.json';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (!isObj(v)) return v;
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
}

/** Même règle que opz-slot-map-edit.py : remplace (ou ajoute) le pack de l'emplacement, tri par emplacement. */
export function editSlotMap(text: string, track: number, slot: number, plugId: number): Result<{ text: string; previous: number | null }, Error> {
  if (!Number.isInteger(track) || track < 0 || track > 15) return err(new Error('piste 0..15'));
  if (!Number.isInteger(slot) || slot < 1 || slot > 10) return err(new Error('emplacement 1..10'));
  if (!Number.isInteger(plugId) || plugId < 1 || plugId > 0xffffffff) return err(new Error('identifiant de son invalide'));
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return err(new Error('slotConfiguration.json illisible'));
  }
  if (!isObj(doc) || !Array.isArray(doc.tracks)) return err(new Error('slotConfiguration.json sans liste de pistes'));
  const t = doc.tracks.find((x) => isObj(x) && x.index === track);
  if (!isObj(t) || !Array.isArray(t.packs)) return err(new Error(`slotConfiguration.json sans piste ${track}`));
  const packs = t.packs as Record<string, unknown>[];
  const prior = packs.find((p) => isObj(p) && p.slot === slot);
  const previous = prior && typeof prior.id === 'number' ? prior.id : null;
  if (prior) prior.id = plugId;
  else packs.push({ id: plugId, slot });
  packs.sort((a, b) => Number(a.slot) - Number(b.slot));
  return ok({ text: `${JSON.stringify(sortKeys(doc), null, 2)}\n`, previous });
}

export interface InstallRequest { track: number; slot: number; plugId: number; label: string }
export interface InstallOptions {
  saveCheckpoint: (cp: Checkpoint) => Promise<Result<void, Error>>;
  progress?: (step: string) => void;
  /** Projet OP-Z (pour l'étiquette du checkpoint). */
  project?: number | null;
}
export type InstallOutcome = { status: 'unchanged' | 'confirmed'; previous: number | null; slotsJson: string; plugsJson: string | null };

const decode = (b: Uint8Array | undefined) => (b ? new TextDecoder().decode(b) : null);

export async function installInSlot(device: FileDevice, req: InstallRequest, options: InstallOptions): Promise<Result<InstallOutcome, Error>> {
  const step = options.progress ?? (() => undefined);
  step('Lecture et sauvegarde des emplacements de l’OP-Z…');
  const before = await device.readDeviceFiles([FILE_ID.SLOT_CONFIGURATION, FILE_ID.PLUGS]);
  if (!before.ok) return err(new Error(`lecture impossible, rien n’a été modifié : ${before.error.message}`));
  const original = before.value.get(FILE_ID.SLOT_CONFIGURATION);
  if (!original) return err(new Error('l’OP-Z n’a pas fourni ses emplacements : rien n’a été modifié'));
  const edited = editSlotMap(new TextDecoder().decode(original), req.track, req.slot, req.plugId);
  if (!edited.ok) return edited;
  const target = new TextEncoder().encode(edited.value.text);
  const saved = await options.saveCheckpoint({
    id: `cp-${Date.now()}`, createdAt: new Date().toISOString(), label: req.label,
    address: ((options.project ?? 0) & 0x0f) << 4, transferId: 0, bank: null, global: null, slotConfiguration: original,
  });
  if (!saved.ok) return err(new Error(`sauvegarde impossible, rien n’a été modifié : ${saved.error.message}`));
  if (edited.value.previous === req.plugId) {
    return ok({ status: 'unchanged', previous: edited.value.previous, slotsJson: decode(original)!, plugsJson: decode(before.value.get(FILE_ID.PLUGS)) });
  }

  step('Installation du son dans l’emplacement…');
  const sent = await device.uploadDeviceFiles([{ path: SLOT_MAP_PATH, data: target }]);
  if (!sent.ok) return restore(device, original, `envoi interrompu : ${sent.error.message}`);
  step('Relecture de vérification…');
  const after = await device.readDeviceFiles([FILE_ID.SLOT_CONFIGURATION, FILE_ID.PLUGS]);
  if (!after.ok) return restore(device, original, `relecture impossible : ${after.error.message}`);
  const readBack = after.value.get(FILE_ID.SLOT_CONFIGURATION);
  if (!readBack || !bytesEqual(readBack, target)) return restore(device, original, 'la relecture ne correspond pas à ce qui a été envoyé');
  return ok({ status: 'confirmed', previous: edited.value.previous, slotsJson: edited.value.text, plugsJson: decode(after.value.get(FILE_ID.PLUGS)) });
}

/** Remet la configuration d'origine et vérifie par relecture. */
export async function restoreSlotMap(device: FileDevice, original: Uint8Array): Promise<Result<void, Error>> {
  const sent = await device.uploadDeviceFiles([{ path: SLOT_MAP_PATH, data: original }]);
  if (!sent.ok) return err(new Error(`remise impossible : ${sent.error.message}`));
  const back = await device.readDeviceFiles([FILE_ID.SLOT_CONFIGURATION]);
  if (!back.ok) return err(new Error(`relecture impossible : ${back.error.message}`));
  const data = back.value.get(FILE_ID.SLOT_CONFIGURATION);
  if (!data || !bytesEqual(data, original)) return err(new Error('la relecture ne correspond pas à la sauvegarde'));
  return ok(undefined);
}

async function restore(device: FileDevice, original: Uint8Array, reason: string): Promise<Result<never, Error>> {
  const r = await restoreSlotMap(device, original);
  return err(new Error(r.ok
    ? `${reason}. Les emplacements d’origine ont été remis (vérifié par relecture).`
    : `${reason}. RETOUR ARRIÈRE INCOMPLET (${r.error.message}) : utilisez « Restaurer » sur la dernière sauvegarde.`));
}
