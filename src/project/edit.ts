import { err, ok, type Result } from '../lib/result';
import { DURATION_UNITS_PER_STEP, MICRO_TICKS_MAX, MICRO_TICKS_MIN, NOTES_PER_STEP, SOUND_PARAMS, STEP_COUNT, TRACK_COUNT, type SoundParam } from './layout';
import type { OpzProject, ProjectPattern, ProjectNote, ProjectStep, ProjectTrack } from './opzProject';
import { COMPONENT_TRACK_LIMIT, STEP_COMPONENTS } from './stepComponents';

/**
 * Modifications immuables du projet (chaque fonction renvoie un NOUVEL objet).
 * Validées ici : l'UI ne peut pas produire un projet que projectToBytes refuserait.
 * Rien de tout ceci n'est envoyé à l'OP-Z.
 */
type R = Result<OpzProject, Error>;

const isInt = (v: number, min: number, max: number) => Number.isInteger(v) && v >= min && v <= max;

function locate(project: OpzProject, pattern: number, track: number): Result<{ pi: number; ti: number }, Error> {
  const pi = project.patterns.findIndex((p) => p.id === pattern);
  if (pi === -1) return err(new Error(`pattern ${pattern + 1} absent du projet`));
  const ti = project.patterns[pi].tracks.findIndex((t) => t.id === track);
  if (ti === -1) return err(new Error(`piste ${track + 1} absente du pattern ${pattern + 1}`));
  return ok({ pi, ti });
}

export function updateTrack(project: OpzProject, pattern: number, track: number, fn: (t: ProjectTrack) => Result<ProjectTrack, Error>): R {
  const at = locate(project, pattern, track);
  if (!at.ok) return at;
  const { pi, ti } = at.value;
  const next = fn(project.patterns[pi].tracks[ti]);
  if (!next.ok) return next;
  const patterns = project.patterns.slice();
  const tracks = patterns[pi].tracks.slice();
  tracks[ti] = next.value;
  patterns[pi] = { ...patterns[pi], tracks };
  return ok({ ...project, patterns });
}

const emptyStep = (index: number): ProjectStep => ({ index, notes: [], components: {}, locks: {} });
const isEmpty = (s: ProjectStep) => !s.notes.length && !Object.keys(s.components).length && !Object.keys(s.locks).length;

/** Remplace un step ; un step vide est retiré de la liste, les steps restent triés. */
export function updateStep(project: OpzProject, pattern: number, track: number, step: number, fn: (s: ProjectStep) => Result<ProjectStep, Error>): R {
  if (!isInt(step, 0, STEP_COUNT - 1)) return err(new Error('step hors plage 1..16'));
  return updateTrack(project, pattern, track, (t) => {
    const current = t.steps.find((s) => s.index === step) ?? emptyStep(step);
    const next = fn(current);
    if (!next.ok) return next;
    const others = t.steps.filter((s) => s.index !== step);
    const steps = isEmpty(next.value) ? others : [...others, next.value].sort((a, b) => a.index - b.index);
    return ok({ ...t, steps });
  });
}

export interface NoteInput {
  note: number;
  velocity?: number;
  /** Durée en steps (1 = un step). */
  lengthSteps?: number;
  micro?: number;
}

/** Remplace toutes les notes du step (emplacements réattribués 0..n-1). */
export function setStepNotes(project: OpzProject, pattern: number, track: number, step: number, notes: readonly NoteInput[]): R {
  if (!isInt(track, 0, TRACK_COUNT - 1)) return err(new Error('piste hors plage'));
  const capacity = NOTES_PER_STEP[track];
  if (notes.length > capacity) return err(new Error(`cette piste accepte ${capacity} note(s) par step au maximum`));
  const built: ProjectNote[] = [];
  for (const [slot, n] of notes.entries()) {
    const velocity = n.velocity ?? 100;
    const length = Math.round((n.lengthSteps ?? 1) * DURATION_UNITS_PER_STEP);
    const micro = n.micro ?? 0;
    if (!isInt(n.note, 0, 127)) return err(new Error('note hors plage 0..127'));
    if (!isInt(velocity, 1, 127)) return err(new Error('vélocité hors plage 1..127'));
    if (!isInt(length, 1, 0x7fffffff)) return err(new Error('durée invalide'));
    if (!isInt(micro, MICRO_TICKS_MIN, MICRO_TICKS_MAX)) return err(new Error(`micro-timing hors plage ${MICRO_TICKS_MIN}..${MICRO_TICKS_MAX}`));
    built.push({ slot, note: n.note, velocity, length, micro, age: 0 });
  }
  return updateStep(project, pattern, track, step, (s) => ok({ ...s, notes: built }));
}

/** Lecture des notes d'un step sous forme éditable. */
export function stepNotes(s: ProjectStep | undefined): Required<NoteInput>[] {
  return (s?.notes ?? [])
    .slice()
    .sort((a, b) => a.slot - b.slot)
    .map((n) => ({
      note: n.note,
      velocity: n.velocity,
      lengthSteps: n.length / DURATION_UNITS_PER_STEP,
      micro: n.micro ?? Math.trunc((n.micro_raw ?? 0) / 8),
    }));
}

/** Clic dans la grille : un step avec notes est vidé de ses notes, sinon on pose `defaultNote`. */
export function toggleStep(project: OpzProject, pattern: number, track: number, step: number, defaultNote: number): R {
  const t = findTrack(project, pattern, track);
  const current = t?.steps.find((s) => s.index === step);
  if (current?.notes.length) return updateStep(project, pattern, track, step, (s) => ok({ ...s, notes: [] }));
  return setStepNotes(project, pattern, track, step, [{ note: defaultNote }]);
}

export function setComponent(project: OpzProject, pattern: number, track: number, step: number, id: string, value: number | null): R {
  const def = STEP_COMPONENTS.find((c) => c.id === id);
  if (!def || def.reserved) return err(new Error(`step component inconnu : ${id}`));
  if (track >= COMPONENT_TRACK_LIMIT) return err(new Error('les step components ne concernent que les pistes 1 à 8'));
  if (value !== null && !isInt(value, 1, 10)) return err(new Error('valeur de step component : 1..10'));
  return updateStep(project, pattern, track, step, (s) => {
    const components = { ...s.components };
    if (value === null) delete components[id];
    else components[id] = value;
    return ok({ ...s, components });
  });
}

export function setLock(project: OpzProject, pattern: number, track: number, step: number, param: SoundParam, value: number | null): R {
  if (!SOUND_PARAMS.includes(param)) return err(new Error(`paramètre inconnu : ${param}`));
  if (value !== null && !isInt(value, 0, 255)) return err(new Error('valeur de lock : 0..255'));
  return updateStep(project, pattern, track, step, (s) => {
    const locks = { ...s.locks };
    if (value === null) delete locks[param];
    else locks[param] = value;
    return ok({ ...s, locks });
  });
}

export interface TrackSettings { muted?: boolean; step_count?: number; step_length?: number; note_length?: number; quantize?: number; note_style?: number }

export function setTrackSettings(project: OpzProject, pattern: number, track: number, settings: TrackSettings): R {
  if (settings.step_count !== undefined && !isInt(settings.step_count, 1, 16)) return err(new Error('nombre de pas : 1..16'));
  if (settings.step_length !== undefined && !isInt(settings.step_length, 1, 255)) return err(new Error('longueur de pas invalide'));
  for (const k of ['note_length', 'quantize', 'note_style'] as const) {
    const v = settings[k];
    if (v !== undefined && !isInt(v, 0, 255)) return err(new Error(`${k} : 0..255`));
  }
  return updateTrack(project, pattern, track, (t) => ok({ ...t, ...settings }));
}

export function setSound(project: OpzProject, pattern: number, track: number, param: SoundParam, value: number): R {
  if (!SOUND_PARAMS.includes(param)) return err(new Error(`paramètre inconnu : ${param}`));
  if (!isInt(value, 0, 255)) return err(new Error('valeur de son : 0..255'));
  return updateTrack(project, pattern, track, (t) => ok({ ...t, sound: { ...t.sound, [param]: value } }));
}

/** Moteur / kit de la piste (identifiant de plug OP-Z, entier non nul). */
export function setPlug(project: OpzProject, pattern: number, track: number, plug: number): R {
  if (!isInt(plug, 1, 0xffffffff)) return err(new Error('identifiant de plug invalide'));
  return updateTrack(project, pattern, track, (t) => ok({ ...t, plug }));
}

/** Copie le plug et les 18 paramètres de son d'une piste vers ce même numéro de piste dans les 16 patterns. */
export function copySoundToAllPatterns(project: OpzProject, pattern: number, track: number): R {
  const source = findTrack(project, pattern, track);
  if (!source) return err(new Error('piste introuvable'));
  let next: OpzProject = project;
  for (const p of project.patterns) {
    if (p.id === pattern) continue;
    const r = updateTrack(next, p.id, track, (t) => ok({ ...t, plug: source.plug, sound: { ...source.sound } }));
    if (!r.ok) return r;
    next = r.value;
  }
  return ok(next);
}

/** Enregistre le catalogue lu sur l'OP-Z dans le projet. */
export function setDeviceCatalog(project: OpzProject, catalog: { plugs_json: string | null; slots_json: string | null; read_at: string }): R {
  return ok({ ...project, device_catalog: catalog });
}

export function setTempo(project: OpzProject, tempo: number): R {
  if (!isInt(tempo, 40, 200)) return err(new Error('tempo : 40..200 BPM'));
  return ok({ ...project, global: { ...project.global, tempo } });
}

/** Nom d'un pattern (propre à l'éditeur ; n'est pas envoyé à l'OP-Z). */
export function setPatternName(project: OpzProject, pattern: number, name: string): R {
  if (!isInt(pattern, 0, 15)) return err(new Error('pattern : 0..15'));
  const clean = name.trim().slice(0, 60);
  const names = Array.from({ length: 16 }, (_, i) => project.meta.pattern_names?.[i] ?? '');
  names[pattern] = clean;
  return ok({ ...project, meta: { ...project.meta, pattern_names: names } });
}

/** Chaîne de lecture composée dans l'éditeur (n'est pas envoyée à l'OP-Z). */
export function setPlayChain(project: OpzProject, chain: number[]): R {
  if (chain.length > 32 || chain.some((n) => !isInt(n, 0, 15))) return err(new Error('chaîne : 32 patterns (1..16) max'));
  return ok({ ...project, meta: { ...project.meta, play_chain: [...chain] } });
}

/** Colle une piste copiée (notes, réglages, son, muet) dans une piste de même numéro d'un pattern. */
export function pasteTrack(project: OpzProject, pattern: number, source: ProjectTrack): R {
  const copy = structuredClone(source);
  return updateTrack(project, pattern, source.id, (t) => ok({ ...copy, id: t.id }));
}

/** Colle un pattern copié (toutes ses pistes, groupe de muets et routages) dans un autre pattern. */
export function pastePattern(project: OpzProject, pattern: number, source: ProjectPattern): R {
  if (!isInt(pattern, 0, 15)) return err(new Error('pattern : 0..15'));
  const pi = project.patterns.findIndex((p) => p.id === pattern);
  if (pi < 0) return err(new Error(`pattern ${pattern} absent`));
  const patterns = project.patterns.slice();
  patterns[pi] = { ...structuredClone(source), id: pattern };
  return ok({ ...project, patterns });
}

export function findTrack(project: OpzProject, pattern: number, track: number): ProjectTrack | undefined {
  return project.patterns.find((p) => p.id === pattern)?.tracks.find((t) => t.id === track);
}

/** Note proposée pour un nouveau step : la plus utilisée sur cette piste dans tout le projet, sinon 60 (C4). */
export function defaultNoteFor(project: OpzProject, track: number): number {
  const counts = new Map<number, number>();
  for (const p of project.patterns) {
    const t = p.tracks.find((x) => x.id === track);
    for (const s of t?.steps ?? []) for (const n of s.notes) counts.set(n.note, (counts.get(n.note) ?? 0) + 1);
  }
  let best = 60;
  let max = 0;
  for (const [note, c] of counts) if (c > max) [best, max] = [note, c];
  return best;
}
