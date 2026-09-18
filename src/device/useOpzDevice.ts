import { useCallback, useEffect, useRef, useState } from 'react';
import { sha256Hex } from '../lib/bytes';
import { err, ok, type Result } from '../lib/result';
import { OpzSession } from '../midi/session';
import { openOpzTransport, requestMidiAccess } from '../midi/transport';
import { createNoteOutput, type NoteOutput } from '../sequencer/noteOutput';
import { decodeChainTelemetry, type DevicePosition } from '../sequencer/telemetry';
import { createLiveOutput, type LiveOutput } from '../sequencer/liveControl';
import { MSG } from '../midi/constants';
import { ClockFollower } from '../sequencer/clockFollower';
import { decodeGlobal, type GlobalSummary } from '../project/global';
import { decodeMidiConfig, type MidiConfiguration } from '../project/midiConfig';
import { decodeBank, type PatternView } from '../project/patternBank';
import { FILE_ID } from '../midi/fileServer';
import { buildCatalog, type RawCatalog } from '../project/catalog';
import type { ProjectBytes } from '../project/opzProject';

/**
 * The only bridge between React and the MIDI layer (CLAUDE.md: components never
 * call MIDI directly). Écritures : uniquement via pushToOpz (voir CLAUDE.md).
 */
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';

export interface BankSnapshot {
  bytes: Uint8Array;
  sha256: string;
  transferId: number;
  packetCount: number;
  patterns: PatternView[];
  readAt: Date;
}

export interface ImportStep {
  label: string;
  /** Ce que cette étape rapporte, en clair. */
  detail: string;
  state: 'todo' | 'doing' | 'done' | 'failed';
  result?: string;
}

export interface FrameStat {
  id: number;
  count: number;
  lastLength: number;
}

export function useOpzDevice() {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [portName, setPortName] = useState<string | null>(null);
  const [identity, setIdentity] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  /** Détail de l'import en cours (affiché dans la fenêtre d'attente). */
  const [importSteps, setImportSteps] = useState<ImportStep[] | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [bank, setBank] = useState<BankSnapshot | null>(null);
  const [global, setGlobal] = useState<{ bytes: Uint8Array; summary: GlobalSummary } | null>(null);
  const [midiConfig, setMidiConfig] = useState<{ bytes: Uint8Array; config: MidiConfiguration } | null>(null);
  const [frames, setFrames] = useState<Map<number, FrameStat>>(new Map());
  const session = useRef<OpzSession | null>(null);
  const [noteOutput, setNoteOutput] = useState<NoteOutput | null>(null);
  const [liveOutput, setLiveOutput] = useState<LiveOutput | null>(null);
  /** Pattern/projet actifs sur l'OP-Z d'après la télémétrie $07 (lecture seule). */
  const [devicePos, setDevicePos] = useState<DevicePosition | null>(null);
  /** L'OP-Z joue-t-il lui-même ? (horloge MIDI qu'il envoie, lecture seule) */
  const [deviceRunning, setDeviceRunning] = useState(false);
  const clock = useRef<ClockFollower | null>(null);
  const clockCleanup = useRef<(() => void) | null>(null);
  const transportRef = useRef<{ close(): void } | null>(null);

  const append = useCallback((line: string) => {
    const stamped = `${new Date().toLocaleTimeString()}  ${line}`;
    setLog((l) => [...l.slice(-199), stamped]);
  }, []);

  const disconnect = useCallback(() => {
    session.current?.close();
    session.current = null;
    transportRef.current?.close();
    transportRef.current = null;
    setNoteOutput(null);
    setLiveOutput(null);
    setDevicePos(null);
    clockCleanup.current?.();
    clockCleanup.current = null;
    clock.current = null;
    setDeviceRunning(false);
    setStatus('idle');
    setPortName(null);
    append('Déconnecté.');
  }, [append]);

  useEffect(() => () => session.current?.close(), []);

  const connect = useCallback(async () => {
    setStatus('connecting');
    const access = await requestMidiAccess();
    if (!access.ok) {
      append(access.error.message);
      return setStatus('error');
    }
    const transport = openOpzTransport(access.value);
    if (!transport.ok) {
      append(transport.error.message);
      return setStatus('error');
    }
    const s = new OpzSession(transport.value, { log: append });
    s.onEvent((e) => {
      if (e.kind !== 'frame') return;
      if (e.frame.messageId === MSG.CHAIN_STATE) {
        const pl = e.frame.payload;
        if (pl.length >= 20) append(`OP-Z → $07 : longueur ${pl[16]}, adresse ${pl[17].toString(16).padStart(2, '0')}, suivant ${pl[18]}, projet ${pl[19]} (brut)`);
        const pos = decodeChainTelemetry(pl);
        if (pos) setDevicePos((prev) => (prev && prev.project === pos.project && prev.pattern === pos.pattern && prev.chainLength === pos.chainLength ? prev : pos));
      }
      setFrames((prev) => {
        const next = new Map(prev);
        const stat = next.get(e.frame.messageId);
        next.set(e.frame.messageId, { id: e.frame.messageId, count: (stat?.count ?? 0) + 1, lastLength: e.frame.payload.length });
        return next;
      });
    });
    session.current = s;
    setPortName(transport.value.name);
    const ack = await s.connect();
    if (!ack.ok) {
      s.close();
      transport.value.close();
      session.current = null;
      return setStatus('error');
    }
    setIdentity(s.identity?.strings ?? []);
    transportRef.current = transport.value;
    setNoteOutput(createNoteOutput(transport.value));
    setLiveOutput(createLiveOutput(transport.value));
    const follower = new ClockFollower((r) => {
      setDeviceRunning(r);
      append(r ? 'L’OP-Z joue (horloge MIDI reçue).' : 'L’OP-Z s’est arrêté.');
    });
    clock.current = follower;
    const unsub = transport.value.subscribe((d) => follower.handle(d));
    const timer = setInterval(() => follower.check(), 200);
    clockCleanup.current = () => { unsub(); clearInterval(timer); };
    append(`Session StateSync ouverte (OP-Z ${hex4(ack.value.deviceSessionId)} ↔ client ${hex4(ack.value.echoedClientId)}).`);
    setStatus('connected');
  }, [append]);

  const run = useCallback(async (label: string, job: (s: OpzSession) => Promise<void>) => {
    if (!session.current) return;
    setBusy(label);
    try {
      await job(session.current);
    } finally {
      setBusy(null);
    }
  }, []);

  const readBank = useCallback(() => run('Lecture de la banque…', async (s) => {
    const r = await s.readPatternBank();
    if (!r.ok) return;
    const patterns = decodeBank(r.value.bank);
    if (!patterns.ok) return append(`Décodage impossible : ${patterns.error.message}`);
    const snapshot: BankSnapshot = {
      bytes: r.value.bank,
      sha256: await sha256Hex(r.value.bank),
      transferId: r.value.transferId,
      packetCount: r.value.packetCount,
      patterns: patterns.value,
      readAt: new Date(),
    };
    setBank(snapshot);
    append(`Banque lue : ${r.value.bank.length} octets en ${r.value.packetCount} paquets, sha256 ${snapshot.sha256.slice(0, 12)}…`);
    console.log('[OP-Z] banque de patterns décodée', snapshot.patterns);
  }), [run, append]);

  const readGlobal = useCallback(() => run('Lecture du bloc global…', async (s) => {
    const r = await s.readGlobal();
    if (!r.ok) return;
    const summary = decodeGlobal(r.value);
    if (!summary.ok) return append(summary.error.message);
    setGlobal({ bytes: r.value, summary: summary.value });
    console.log('[OP-Z] bloc global', summary.value);
  }), [run, append]);

  const readMidiConfig = useCallback(() => run('Lecture de la config MIDI…', async (s) => {
    const r = await s.readMidiConfig();
    if (!r.ok) return;
    const config = decodeMidiConfig(r.value);
    if (!config.ok) return append(config.error.message);
    setMidiConfig({ bytes: r.value, config: config.value });
    console.log('[OP-Z] configuration MIDI', config.value);
  }), [run, append]);

  /**
   * Import complet pour un projet : banque + global + config MIDI, en LECTURE seule.
   * Les trois lectures passent l'une après l'autre dans la file de la session.
   */
  const importAll = useCallback(async (): Promise<Result<{ bytes: ProjectBytes; firmware?: string; address: number; catalog: RawCatalog | null; telemetry: { project: number | null; fresh: boolean } }, Error>> => {
    const s = session.current;
    if (!s) return err(new Error('OP-Z non connecté'));
    // Une nouvelle tentative par lecture : l'OP-Z envoie parfois une rafale d'état
    // spontanée qui fait échouer (proprement) la première requête.
    const steps: ImportStep[] = [
      { label: 'Les 16 patterns', detail: 'notes de chaque pas, son choisi par piste, réglages, muets', state: 'todo' },
      { label: 'Réglages du projet', detail: 'tempo, swing, volumes, chaînes de patterns', state: 'todo' },
      { label: 'Réglages MIDI', detail: 'canal de chaque piste, options (tempo + écran)', state: 'todo' },
      { label: 'Liste des sons de l’OP-Z', detail: 'noms des kits, moteurs et effets, et les 10 sons prêts de chaque piste (pas l’audio : il reste dans l’OP-Z)', state: 'todo' },
    ];
    const mark = (i: number, state: ImportStep['state'], result?: string) => {
      steps[i] = { ...steps[i], state, ...(result ? { result } : {}) };
      setImportSteps([...steps]);
    };
    setImportSteps([...steps]);
    const attempt = async <T,>(i: number, read: () => Promise<Result<T, Error>>): Promise<Result<T, Error>> => {
      mark(i, 'doing');
      setBusy(`Import depuis l’OP-Z (${i + 1}/4)`);
      const first = await read();
      if (first.ok) return first;
      append(`${steps[i].label} : ${first.error.message} — nouvelle tentative`);
      mark(i, 'doing', 'nouvelle tentative…');
      const second = await read();
      if (!second.ok) mark(i, 'failed', second.error.message);
      return second.ok ? second : err(new Error(`${steps[i].label} : ${second.error.message}`));
    };
    // Télémétrie $07 reçue AVANT l'import : on saura si l'OP-Z en a renvoyé une pendant.
    const chainBefore = s.latest.get(MSG.CHAIN_STATE);
    try {
      const bankRead = await attempt(0, () => s.readPatternBank());
      if (!bankRead.ok) return bankRead;
      const views = decodeBank(bankRead.value.bank);
      const used = views.ok ? views.value.filter((pt) => pt.tracks.some((t) => t.steps.some((st) => st.slots.some((n) => n !== null)))).length : null;
      mark(0, 'done', used === null ? `${Math.round(bankRead.value.bank.length / 1024)} ko lus` : `${used} pattern${used > 1 ? 's' : ''} avec des notes sur 16`);
      const globalRead = await attempt(1, () => s.readGlobal());
      if (!globalRead.ok) return globalRead;
      const g = decodeGlobal(globalRead.value);
      mark(1, 'done', g.ok ? `tempo ${g.value.tempo} BPM` : 'lus');
      const midiRead = await attempt(2, () => s.readMidiConfig());
      if (!midiRead.ok) append(`Config MIDI non lue (${midiRead.error.message}) : le projet sera créé sans.`);
      else mark(2, 'done', 'lus');
      mark(3, 'doing');
      setBusy('Import depuis l’OP-Z (4/4)');
      const catalog = await readCatalogWith(s);
      if (!catalog.ok) {
        append(`Catalogue des sons non lu (${catalog.error.message}) : les sons seront affichés par numéro.`);
        mark(3, 'failed', 'non lue : les sons seront affichés par numéro');
      } else {
        const built = buildCatalog(catalog.value);
        const ready = built ? [...built.slots.values()].reduce((n, l) => n + l.length, 0) : 0;
        mark(3, 'done', built ? `${built.plugs.size} sons, dont ${ready} prêts sur les pistes` : 'lue');
      }
      const firmware = s.identity?.strings.find((str) => /\d+\.\d+\.\d+/.test(str))?.match(/\d+\.\d+\.\d+\+?/)?.[0];
      const telemetry = { project: s.activeProject(), fresh: s.latest.get(MSG.CHAIN_STATE) !== chainBefore };
      append(`Projet d’après l’OP-Z : ${telemetry.project === null ? 'inconnu' : telemetry.project + 1}${telemetry.fresh ? ' (annonce reçue pendant l’import)' : ' (annonce ancienne)'} · d’après l’adresse de la banque : ${((bankRead.value.address >> 4) & 0x0f) + 1} (non vérifié)`);
      return ok({ bytes: { bank: bankRead.value.bank, global: globalRead.value, midiConfig: midiRead.ok ? midiRead.value : null }, firmware, address: bankRead.value.address, catalog: catalog.ok ? catalog.value : null, telemetry });
    } finally {
      setBusy(null);
      setImportSteps(null);
    }
  }, [append]);

  /** Lit seulement le catalogue des sons (plugs.json + slotConfiguration.json). */
  const readCatalog = useCallback(async (): Promise<Result<RawCatalog, Error>> => {
    const s = session.current;
    if (!s) return err(new Error('OP-Z non connecté'));
    setBusy('Lecture des sons de l’OP-Z…');
    try {
      return await readCatalogWith(s);
    } finally {
      setBusy(null);
    }
  }, []);

  /** Exécute une opération sur la session (affiche l'état « occupé »). */
  /** `quiet` : travail de fond (application automatique) — pas de voile d'attente. */
  const withDevice = useCallback(async <T,>(label: string, job: (s: OpzSession) => Promise<Result<T, Error>>, quiet = false): Promise<Result<T, Error>> => {
    const s = session.current;
    if (!s) return err(new Error('OP-Z non connecté'));
    if (!quiet) setBusy(label);
    try {
      return await job(s);
    } finally {
      if (!quiet) setBusy(null);
    }
  }, []);

  return { importSteps, log: append, importAll, readCatalog, withDevice, setBusy, noteOutput, liveOutput, devicePos, deviceRunning, clock, status, portName, identity, busy, logLines: log, bank, global, midiConfig, frames, connect, disconnect, readBank, readGlobal, readMidiConfig };
}

async function readCatalogWith(s: OpzSession): Promise<Result<RawCatalog, Error>> {
  const files = await s.readDeviceFiles([FILE_ID.SLOT_CONFIGURATION, FILE_ID.PLUGS]);
  if (!files.ok) return files;
  const text = (id: number) => {
    const b = files.value.get(id);
    return b ? new TextDecoder().decode(b) : null;
  };
  return ok({ plugs_json: text(FILE_ID.PLUGS), slots_json: text(FILE_ID.SLOT_CONFIGURATION), read_at: new Date().toISOString() });
}

const hex4 = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');
