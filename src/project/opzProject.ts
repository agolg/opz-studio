import { toBase64, fromBase64 } from '../lib/base64';
import { writeU16le } from '../lib/bytes';
import { err, ok, type Result } from '../lib/result';
import { compress, decompress } from '../midi/zlib';
import { decodeGlobal } from './global';
import {
  GLOBAL, GLOBAL_SIZE, LOCK_ENABLED, MICRO_RAW_PER_TICK, MIDI_CONFIG_SIZE, NOTE_REC, NOTES_PER_STEP, OFF,
  PATTERN_BANK_SIZE, PATTERN_COUNT, PATTERN_SIZE, SOUND_PARAMS, STEP_COUNT, TRACK_COUNT, TRACK_NAMES, TRACK_REC,
  type SoundParam, type TrackName,
} from './layout';
import { decodeMidiConfig, encodeMidiConfig, type MidiConfiguration } from './midiConfig';
import { decodeBank, encodeBank, type PatternView, type StepView } from './patternBank';
import { STEP_COMPONENTS } from './stepComponents';

/**
 * Fichier projet `.opzproject` (JSON, version 1).
 *
 * Deux couches :
 *  - des champs lisibles (patterns, pistes, notes, sons, chaînes…) que l'éditeur modifie ;
 *  - `raw` : les octets bruts de référence (banque, global, config MIDI), zlib + base64.
 *
 * Reconstruction = on décode `raw`, on applique par-dessus les champs lisibles,
 * on ré-encode. Les octets que le modèle ne connaît pas viennent donc toujours
 * de `raw` : rien n'est perdu (test : projectToBytes(bankToProject(b)) === b).
 *
 * Ce fichier n'est JAMAIS envoyé à l'OP-Z : l'éditeur n'écrit rien dans l'appareil.
 */
export const PROJECT_FORMAT = 'opzproject';
export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = '.opzproject';

export interface ProjectNote {
  /** Position dans les emplacements de notes du step (0..capacité-1). */
  slot: number;
  note: number;
  velocity: number;
  /** Durée en unités OP-Z : 6 200 = 1 step. */
  length: number;
  /** Micro-timing en ticks (−12…+11). Absent si `micro_raw` est utilisé. */
  micro?: number;
  /** Valeur brute si elle n'est pas un multiple de 8 (données inhabituelles). */
  micro_raw?: number;
  age: number;
}

export interface ProjectStep {
  index: number;
  notes: ProjectNote[];
  /** Step components actifs : id (voir step-components-map.json) → valeur brute 1..10. */
  components: Record<string, number>;
  /** Parameter locks actifs : nom du paramètre → valeur 0..255. */
  locks: Partial<Record<SoundParam, number>>;
}

export interface ProjectTrack {
  id: number;
  name: TrackName;
  plug: number;
  step_count: number;
  step_length: number;
  quantize: number;
  note_style: number;
  note_length: number;
  /** Muet dans le groupe de mute actif du pattern. */
  muted: boolean;
  sound: Record<SoundParam, number>;
  /** Seulement les steps non vides (notes, components ou locks). */
  steps: ProjectStep[];
}

export interface ProjectPattern {
  id: number;
  tracks: ProjectTrack[];
  active_mute_group: number;
  tape_routing: number;
  master_routing: number;
}

export interface ProjectGlobal {
  tempo: number;
  swing: number;
  drum_level: number;
  synth_level: number;
  punch_level: number;
  master_level: number;
  metronome_level: number;
  metronome_sound: number;
  /** 15 chaînes sauvées, patterns numérotés 0..15. */
  chains: number[][];
  active_chain: number[];
  selected_chain: number | null;
}

export interface OpzProject {
  format: typeof PROJECT_FORMAT;
  version: typeof PROJECT_VERSION;
  meta: {
    name: string;
    created: string;
    modified: string;
    /** Origine : import depuis l'OP-Z ou projet vierge. */
    source: 'opz-import' | 'new';
    firmware?: string;
    imported_at?: string;
    /** Projet de l'OP-Z (0..15) d'où vient l'import, d'après l'adresse $09. */
    opz_project?: number;
    /** Projet actif de l'OP-Z (0..9) au moment de l'import, d'après sa télémétrie $07. */
    device_project?: number;
    /** Noms des 16 patterns (propres à l'éditeur, l'OP-Z n'en a pas). */
    pattern_names?: string[];
    /** Chaîne composée dans l'éditeur pour la lecture (patterns 0..15, 32 max). */
    play_chain?: number[];
  };
  global: ProjectGlobal;
  patterns: ProjectPattern[];
  midi_config: MidiConfiguration | null;
  /** Fichiers de réglages de l'OP-Z (catalogue des sons, emplacements), texte brut. Optionnel. */
  device_catalog?: { plugs_json: string | null; slots_json: string | null; read_at: string } | null;
  /** Octets de référence (zlib + base64). Ne pas éditer à la main. */
  raw: { bank: string; global: string; midi_config: string | null };
}

export interface ProjectBytes {
  bank: Uint8Array;
  global: Uint8Array;
  midiConfig: Uint8Array | null;
}

// ---------------------------------------------------------------------------
// Octets → projet
// ---------------------------------------------------------------------------

export function bytesToProject(bytes: ProjectBytes, meta: Partial<OpzProject['meta']> & { name: string }): Result<OpzProject, Error> {
  const view = decodeBank(bytes.bank);
  if (!view.ok) return view;
  const global = decodeGlobal(bytes.global);
  if (!global.ok) return global;
  let midiConfig: MidiConfiguration | null = null;
  if (bytes.midiConfig) {
    const decoded = decodeMidiConfig(bytes.midiConfig);
    if (!decoded.ok) return decoded;
    midiConfig = decoded.value;
  }
  const now = new Date().toISOString();
  const g = global.value;
  return ok({
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    meta: { created: now, modified: now, source: 'opz-import', ...meta },
    global: {
      tempo: g.tempo,
      swing: g.swing,
      drum_level: g.drumLevel,
      synth_level: g.synthLevel,
      punch_level: g.punchLevel,
      master_level: g.masterLevel,
      metronome_level: g.metronomeLevel,
      metronome_sound: g.metronomeSound,
      chains: g.chains,
      active_chain: g.activeChain,
      selected_chain: g.selectedChainRaw === 0xff ? null : g.selectedChainRaw,
    },
    patterns: view.value.map(patternToProject),
    midi_config: midiConfig,
    raw: {
      bank: toBase64(compress(bytes.bank)),
      global: toBase64(compress(bytes.global)),
      midi_config: bytes.midiConfig ? toBase64(compress(bytes.midiConfig)) : null,
    },
  });
}

function patternToProject(pv: PatternView, id: number): ProjectPattern {
  const group = Math.min(pv.activeMuteGroup, OFF.MUTE_GROUP_COUNT - 1);
  return {
    id,
    active_mute_group: pv.activeMuteGroup,
    tape_routing: pv.tapeRouting,
    master_routing: pv.masterRouting,
    tracks: pv.tracks.map((tv, t) => ({
      id: t,
      name: TRACK_NAMES[t],
      plug: tv.plug,
      step_count: tv.stepCount,
      step_length: tv.stepLength,
      quantize: tv.quantize,
      note_style: tv.noteStyle,
      note_length: tv.noteLength,
      muted: (pv.muteGroups[group * 4 + (t >> 2)] & muteBit(t)) !== 0,
      sound: Object.fromEntries(SOUND_PARAMS.map((p, i) => [p, tv.sound[i]])) as Record<SoundParam, number>,
      steps: tv.steps.map((sv, s) => stepToProject(sv, s)).filter((s): s is ProjectStep => s !== null),
    })),
  };
}

function stepToProject(sv: StepView, index: number): ProjectStep | null {
  const notes: ProjectNote[] = [];
  sv.slots.forEach((n, slot) => {
    if (!n) return;
    const note: ProjectNote = { slot, note: n.note, velocity: n.velocity, length: n.duration, age: n.age };
    if (n.microRaw % MICRO_RAW_PER_TICK === 0) note.micro = n.microRaw / MICRO_RAW_PER_TICK;
    else note.micro_raw = n.microRaw;
    notes.push(note);
  });
  const components: Record<string, number> = {};
  for (const c of STEP_COMPONENTS) if (sv.componentMask & (1 << c.index)) components[c.id] = sv.componentValues[c.index];
  const locks: Partial<Record<SoundParam, number>> = {};
  SOUND_PARAMS.forEach((p, i) => {
    if (sv.lockEnabled[i] !== 0) locks[p] = sv.lockValues[i];
  });
  if (!notes.length && !Object.keys(components).length && !Object.keys(locks).length) return null;
  return { index, notes, components, locks };
}

// ---------------------------------------------------------------------------
// Projet → octets (champs lisibles appliqués sur la référence brute)
// ---------------------------------------------------------------------------

export function projectToBytes(project: OpzProject): Result<ProjectBytes, Error> {
  let r = bytesCache.get(project);
  if (!r) {
    r = projectToBytesNow(project);
    bytesCache.set(project, r);
  }
  return copyBytes(r);
}

function projectToBytesNow(project: OpzProject): Result<ProjectBytes, Error> {
  const valid = validateProject(project);
  if (!valid.ok) return valid;
  const raw = decodeRaw(project.raw);
  if (!raw.ok) return raw;
  const view = decodeBank(raw.value.bank);
  if (!view.ok) return view;
  for (const pp of project.patterns) applyPattern(view.value[pp.id], pp);
  const bank = encodeBank(view.value, raw.value.bank);
  if (!bank.ok) return bank;

  const global = raw.value.global.slice();
  const g = project.global;
  writeU16le(global, GLOBAL.TEMPO, g.tempo);
  global[GLOBAL.SWING] = g.swing;
  global[GLOBAL.DRUM_LEVEL] = g.drum_level;
  global[GLOBAL.SYNTH_LEVEL] = g.synth_level;
  global[GLOBAL.PUNCH_LEVEL] = g.punch_level;
  global[GLOBAL.MASTER_LEVEL] = g.master_level;
  global[GLOBAL.METRONOME_LEVEL] = g.metronome_level;
  global[GLOBAL.METRONOME_SOUND] = g.metronome_sound;
  g.chains.forEach((chain, i) => writeChain(global, i * GLOBAL.CHAIN_RECORD_SIZE, chain));
  writeChain(global, GLOBAL.ACTIVE_CHAIN, g.active_chain);
  global[GLOBAL.SELECTED_CHAIN] = g.selected_chain ?? 0xff;

  let midiConfig = raw.value.midiConfig;
  const rawConfig = midiConfig ? decodeMidiConfig(midiConfig) : null;
  const unchanged = rawConfig?.ok && JSON.stringify(rawConfig.value) === JSON.stringify(project.midi_config);
  if (project.midi_config && !unchanged) {
    const encoded = encodeMidiConfig(project.midi_config);
    if (!encoded.ok) return encoded;
    midiConfig = encoded.value;
  }
  return ok({ bank: bank.value, global, midiConfig });
}

/** Réécrit une chaîne en ne touchant que les octets nécessaires (le reste de l'enregistrement est préservé s'il est déjà cohérent). */
function writeChain(data: Uint8Array, offset: number, chain: number[]): void {
  const record = data.subarray(offset, offset + GLOBAL.CHAIN_RECORD_SIZE);
  const end = record.indexOf(0xff);
  const current = Array.from(end === -1 ? record : record.subarray(0, end));
  if (current.length === chain.length && current.every((v, i) => v === chain[i])) return; // inchangée : octets d'origine conservés
  record.fill(0xff);
  record.set(chain);
}

function applyPattern(pv: PatternView, pp: ProjectPattern): void {
  pv.activeMuteGroup = pp.active_mute_group;
  pv.tapeRouting = pp.tape_routing;
  pv.masterRouting = pp.master_routing;
  const group = Math.min(pp.active_mute_group, OFF.MUTE_GROUP_COUNT - 1);
  for (const pt of pp.tracks) {
    const tv = pv.tracks[pt.id];
    tv.plug = pt.plug;
    tv.stepCount = pt.step_count;
    tv.stepLength = pt.step_length;
    tv.quantize = pt.quantize;
    tv.noteStyle = pt.note_style;
    tv.noteLength = pt.note_length;
    tv.sound = SOUND_PARAMS.map((p) => pt.sound[p]);
    const mi = group * 4 + (pt.id >> 2);
    pv.muteGroups[mi] = pt.muted ? pv.muteGroups[mi] | muteBit(pt.id) : pv.muteGroups[mi] & ~muteBit(pt.id);

    const byIndex = new Map(pt.steps.map((s) => [s.index, s]));
    tv.steps.forEach((sv, s) => {
      const ps = byIndex.get(s);
      // Notes : emplacements listés = occupés, les autres = libres (octets restants préservés).
      const bySlot = new Map((ps?.notes ?? []).map((n) => [n.slot, n]));
      sv.slots = sv.slots.map((_old, slot) => {
        const n = bySlot.get(slot);
        if (!n) return null;
        return { duration: n.length, note: n.note, velocity: n.velocity, microRaw: n.micro_raw ?? (n.micro ?? 0) * MICRO_RAW_PER_TICK, age: n.age };
      });
      // Components : bit actif ⇔ présent ; les valeurs des bits inactifs restent celles de la référence.
      let mask = 0;
      for (const c of STEP_COMPONENTS) {
        const value = ps?.components[c.id];
        if (value === undefined) continue;
        mask |= 1 << c.index;
        sv.componentValues[c.index] = value;
      }
      sv.componentMask = mask;
      // Locks : actif ⇔ présent ; octet d'activation d'origine conservé s'il était déjà non nul.
      SOUND_PARAMS.forEach((p, i) => {
        const value = ps?.locks[p];
        if (value === undefined) {
          sv.lockEnabled[i] = 0;
        } else {
          sv.lockValues[i] = value;
          if (sv.lockEnabled[i] === 0) sv.lockEnabled[i] = LOCK_ENABLED;
        }
      });
    });
  }
}

const muteBit = (track: number): number => 1 << ((track % 4) * 2 + 1);

/** Octets de référence du projet (banque/global/config tels que lus à l'import ou après le dernier envoi). */
export function projectRawBytes(project: OpzProject): Result<ProjectBytes, Error> {
  return decodeRaw(project.raw);
}

/** Remplace la référence brute (après un envoi confirmé vers l'OP-Z). Les champs lisibles ne changent pas. */
export function rebaseProject(project: OpzProject, bytes: { bank: Uint8Array; global?: Uint8Array | null }): OpzProject {
  return {
    ...project,
    raw: {
      ...project.raw,
      bank: toBase64(compress(bytes.bank)),
      global: bytes.global ? toBase64(compress(bytes.global)) : project.raw.global,
    },
  };
}

/**
 * Caches (performances) : décompresser 342 ko de référence et réencoder la banque à chaque
 * mouvement de curseur coûtait cher. La référence brute et le projet sont immuables : on met en
 * cache par objet, et on rend toujours des COPIES (les appelants peuvent les modifier sans risque).
 */
const rawCache = new WeakMap<OpzProject['raw'], Result<ProjectBytes, Error>>();
const bytesCache = new WeakMap<OpzProject, Result<ProjectBytes, Error>>();
const copyBytes = (r: Result<ProjectBytes, Error>): Result<ProjectBytes, Error> =>
  r.ok ? ok({ bank: r.value.bank.slice(), global: r.value.global.slice(), midiConfig: r.value.midiConfig?.slice() ?? null }) : r;

function decodeRaw(raw: OpzProject['raw']): Result<ProjectBytes, Error> {
  let r = rawCache.get(raw);
  if (!r) {
    r = decodeRawNow(raw);
    rawCache.set(raw, r);
  }
  return copyBytes(r);
}

function decodeRawNow(raw: OpzProject['raw']): Result<ProjectBytes, Error> {
  const unpack = (text: string, size: number, label: string): Result<Uint8Array, Error> => {
    let packed: Uint8Array;
    try {
      packed = fromBase64(text);
    } catch {
      return err(new Error(`raw.${label} : base64 invalide`));
    }
    const data = decompress(packed, size);
    if (!data.ok) return err(new Error(`raw.${label} : ${data.error.message}`));
    if (data.value.length !== size) return err(new Error(`raw.${label} : ${data.value.length} octets, attendu ${size}`));
    return data;
  };
  const bank = unpack(raw.bank, PATTERN_BANK_SIZE, 'bank');
  if (!bank.ok) return bank;
  const global = unpack(raw.global, GLOBAL_SIZE, 'global');
  if (!global.ok) return global;
  let midiConfig: Uint8Array | null = null;
  if (raw.midi_config) {
    const m = unpack(raw.midi_config, MIDI_CONFIG_SIZE, 'midi_config');
    if (!m.ok) return m;
    midiConfig = m.value;
  }
  return ok({ bank: bank.value, global: global.value, midiConfig });
}

// ---------------------------------------------------------------------------
// Projet vierge
// ---------------------------------------------------------------------------

/**
 * Banque de départ d'un projet créé sans OP-Z : tout à zéro, emplacements de
 * notes libres (FF), 16 steps par piste. Valeurs provisoires — un projet
 * importé depuis l'OP-Z a de vraies valeurs de plug et de son.
 */
export function blankBankBytes(): Uint8Array {
  const data = new Uint8Array(PATTERN_BANK_SIZE);
  for (let p = 0; p < PATTERN_COUNT; p++) {
    const base = p * PATTERN_SIZE;
    for (let i = 0; i < STEP_COUNT * OFF.NOTE_SLOTS_PER_STEP; i++) data[base + OFF.NOTES + i * OFF.NOTE_RECORD_SIZE + NOTE_REC.NOTE] = 0xff;
    for (let t = 0; t < TRACK_COUNT; t++) {
      data[base + t * OFF.TRACK_RECORD_SIZE + TRACK_REC.STEP_COUNT] = 16;
      const sound = base + OFF.SOUND + t * SOUND_PARAMS.length;
      data[sound + SOUND_PARAMS.indexOf('filter')] = 255;
      data[sound + SOUND_PARAMS.indexOf('pan')] = 128;
      data[sound + SOUND_PARAMS.indexOf('level')] = 200;
    }
  }
  return data;
}

/** Valeurs du constructeur GlobalData (op-z-sysex docs/project-global-format.md "Constructor Defaults"). */
export function blankGlobalBytes(): Uint8Array {
  const data = new Uint8Array(GLOBAL_SIZE);
  data.fill(0xff, 0, 512);
  data[GLOBAL.DRUM_LEVEL] = 0x80;
  data[GLOBAL.SYNTH_LEVEL] = 0x80;
  writeU16le(data, GLOBAL.TEMPO, 120);
  data[GLOBAL.SWING] = 0x7f;
  data[GLOBAL.METRONOME_LEVEL] = 0x64;
  data[GLOBAL.SELECTED_CHAIN] = 0xff;
  return data;
}

export function newProject(name = 'Nouveau morceau'): OpzProject {
  const project = bytesToProject({ bank: blankBankBytes(), global: blankGlobalBytes(), midiConfig: null }, { name, source: 'new' });
  if (!project.ok) throw project.error; // impossible : entrées générées localement
  return project.value;
}

// ---------------------------------------------------------------------------
// Sérialisation et validation
// ---------------------------------------------------------------------------

export function serializeProject(project: OpzProject): string {
  return JSON.stringify({ ...project, meta: { ...project.meta, modified: new Date().toISOString() } }, null, 1);
}

export function parseProject(text: string): Result<OpzProject, Error> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return err(new Error(`JSON invalide : ${e instanceof Error ? e.message : String(e)}`));
  }
  const valid = validateProject(data);
  if (!valid.ok) return valid;
  // Vérifie aussi que la référence brute se décode et que tout se reconstruit.
  const bytes = projectToBytes(valid.value);
  if (!bytes.ok) return bytes;
  return valid;
}

/** Validation structurelle stricte : on refuse un fichier douteux plutôt que de l'interpréter. */
export function validateProject(data: unknown): Result<OpzProject, Error> {
  const problems: string[] = [];
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const int = (v: unknown, min: number, max: number, path: string): void => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) problems.push(`${path} doit être un entier ${min}..${max}`);
  };
  if (!isObj(data)) return err(new Error('le fichier ne contient pas un objet JSON'));
  if (data.format !== PROJECT_FORMAT) return err(new Error(`format « ${String(data.format)} » inconnu (attendu ${PROJECT_FORMAT})`));
  if (data.version !== PROJECT_VERSION) return err(new Error(`version ${String(data.version)} non prise en charge (attendu ${PROJECT_VERSION})`));
  if (!isObj(data.meta) || typeof data.meta.name !== 'string') problems.push('meta.name manquant');
  else {
    if (data.meta.device_project !== undefined) int(data.meta.device_project, 0, 15, 'meta.device_project');
    const names = data.meta.pattern_names;
    const chain = data.meta.play_chain;
    if (chain !== undefined && (!Array.isArray(chain) || chain.length > 32 || chain.some((n) => !Number.isInteger(n) || n < 0 || n > 15))) problems.push('meta.play_chain doit être une liste de 32 patterns (0..15) max');
    if (names !== undefined && (!Array.isArray(names) || names.length > 16 || names.some((n) => typeof n !== 'string' || n.length > 60))) problems.push('meta.pattern_names doit être une liste de 16 noms');
  }
  if (!isObj(data.raw) || typeof data.raw.bank !== 'string' || typeof data.raw.global !== 'string') problems.push('raw.bank / raw.global manquants');

  const g = data.global;
  if (!isObj(g)) problems.push('global manquant');
  else {
    int(g.tempo, 0, 0xffff, 'global.tempo');
    for (const k of ['swing', 'drum_level', 'synth_level', 'punch_level', 'master_level', 'metronome_level', 'metronome_sound']) int(g[k], 0, 255, `global.${k}`);
    const chainOk = (c: unknown, path: string) => {
      if (!Array.isArray(c) || c.length > 32) return problems.push(`${path} doit être une liste de 32 patterns max`);
      c.forEach((v, i) => int(v, 0, 254, `${path}[${i}]`));
    };
    if (!Array.isArray(g.chains) || g.chains.length !== GLOBAL.SAVED_CHAIN_COUNT) problems.push('global.chains doit contenir 15 chaînes');
    else g.chains.forEach((c, i) => chainOk(c, `global.chains[${i}]`));
    chainOk(g.active_chain, 'global.active_chain');
    if (g.selected_chain !== null) int(g.selected_chain, 0, 254, 'global.selected_chain');
  }

  if (!Array.isArray(data.patterns)) problems.push('patterns manquant');
  else {
    const seen = new Set<number>();
    data.patterns.forEach((p, pi) => {
      const path = `patterns[${pi}]`;
      if (!isObj(p)) return problems.push(`${path} invalide`);
      int(p.id, 0, PATTERN_COUNT - 1, `${path}.id`);
      if (seen.has(p.id as number)) problems.push(`${path}.id en double`);
      seen.add(p.id as number);
      int(p.active_mute_group, 0, 255, `${path}.active_mute_group`);
      int(p.tape_routing, 0, 0xffff, `${path}.tape_routing`);
      int(p.master_routing, 0, 0xffff, `${path}.master_routing`);
      if (!Array.isArray(p.tracks)) return problems.push(`${path}.tracks manquant`);
      const seenTracks = new Set<number>();
      p.tracks.forEach((t, ti) => {
        const tp = `${path}.tracks[${ti}]`;
        if (!isObj(t)) return problems.push(`${tp} invalide`);
        int(t.id, 0, TRACK_COUNT - 1, `${tp}.id`);
        if (seenTracks.has(t.id as number)) problems.push(`${tp}.id en double`);
        seenTracks.add(t.id as number);
        int(t.plug, 0, 0xffffffff, `${tp}.plug`);
        for (const k of ['step_count', 'step_length', 'quantize', 'note_style', 'note_length']) int(t[k], 0, 255, `${tp}.${k}`);
        if (typeof t.muted !== 'boolean') problems.push(`${tp}.muted doit être true/false`);
        if (!isObj(t.sound)) problems.push(`${tp}.sound manquant`);
        else for (const sp of SOUND_PARAMS) int(t.sound[sp], 0, 255, `${tp}.sound.${sp}`);
        if (!Array.isArray(t.steps)) return problems.push(`${tp}.steps manquant`);
        const capacity = typeof t.id === 'number' ? (NOTES_PER_STEP[t.id] ?? 0) : 0;
        const seenSteps = new Set<number>();
        t.steps.forEach((s, si) => {
          const sp = `${tp}.steps[${si}]`;
          if (!isObj(s)) return problems.push(`${sp} invalide`);
          int(s.index, 0, STEP_COUNT - 1, `${sp}.index`);
          if (seenSteps.has(s.index as number)) problems.push(`${sp}.index en double`);
          seenSteps.add(s.index as number);
          if (!Array.isArray(s.notes)) problems.push(`${sp}.notes manquant`);
          else {
            const slots = new Set<number>();
            s.notes.forEach((n, ni) => {
              const np = `${sp}.notes[${ni}]`;
              if (!isObj(n)) return problems.push(`${np} invalide`);
              int(n.slot, 0, capacity - 1, `${np}.slot`);
              if (slots.has(n.slot as number)) problems.push(`${np}.slot en double`);
              slots.add(n.slot as number);
              int(n.note, 0, 254, `${np}.note`);
              int(n.velocity, 0, 255, `${np}.velocity`);
              int(n.length, -0x80000000, 0x7fffffff, `${np}.length`);
              int(n.age, 0, 255, `${np}.age`);
              if (n.micro_raw !== undefined) int(n.micro_raw, -128, 127, `${np}.micro_raw`);
              else if (n.micro !== undefined) int(n.micro, -16, 15, `${np}.micro`);
            });
          }
          if (!isObj(s.components)) problems.push(`${sp}.components manquant`);
          else for (const [id, v] of Object.entries(s.components)) {
            if (!STEP_COMPONENTS.some((c) => c.id === id)) problems.push(`${sp}.components.${id} : composant inconnu`);
            int(v, 0, 255, `${sp}.components.${id}`);
          }
          if (!isObj(s.locks)) problems.push(`${sp}.locks manquant`);
          else for (const [name, v] of Object.entries(s.locks)) {
            if (!(SOUND_PARAMS as readonly string[]).includes(name)) problems.push(`${sp}.locks.${name} : paramètre inconnu`);
            int(v, 0, 255, `${sp}.locks.${name}`);
          }
        });
      });
    });
  }
  if (data.midi_config !== null && data.midi_config !== undefined && !isObj(data.midi_config)) problems.push('midi_config invalide');
  if (data.device_catalog !== undefined && data.device_catalog !== null) {
    const c = data.device_catalog;
    if (!isObj(c) || (c.plugs_json !== null && typeof c.plugs_json !== 'string') || (c.slots_json !== null && typeof c.slots_json !== 'string')) problems.push('device_catalog invalide');
  }
  if (problems.length) {
    const shown = problems.slice(0, 8).join(' ; ');
    return err(new Error(`fichier projet invalide : ${shown}${problems.length > 8 ? ` (+${problems.length - 8} autres)` : ''}`));
  }
  return ok(data as unknown as OpzProject);
}

/** Raisons d'interdire l'envoi vers l'OP-Z (sécurité). Liste vide = envoi possible. */
export function deviceWriteProblems(project: OpzProject): string[] {
  const problems: string[] = [];
  if (project.meta.source !== 'opz-import') {
    problems.push('ce projet n’a pas été importé depuis l’OP-Z : ses sons et octets internes ne viennent pas d’un vrai appareil. Importez d’abord depuis l’OP-Z, puis modifiez.');
  }
  return problems;
}
