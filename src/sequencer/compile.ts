import type { MidiConfiguration } from '../project/midiConfig';
import { DURATION_UNITS_PER_STEP, TRACK_COUNT } from '../project/layout';
import type { OpzProject, ProjectPattern } from '../project/opzProject';

/**
 * Transforme un pattern du projet en évènements de notes datés (ms depuis le début du pattern).
 * Fonction pure : testable sans navigateur ni OP-Z.
 *
 * Temps (op-z-sysex docs/live-position-and-chain-state.md « Beat Inside a Pattern ») :
 *  - 6 clocks MIDI = une double-croche ; un step de piste dure `step_length × 6` clocks,
 *    donc `step_length` double-croches (0 traité comme 1) ;
 *  - chaque piste boucle sur ses `step_count` steps (polymétrie) ;
 *  - durée d'une note : 6 200 unités = 1 step de la piste ;
 *  - micro-timing : ticks −12…+11, pris comme 1/24 de step (hypothèse à confirmer à l'oreille).
 * Longueur du pattern (hypothèse) : la piste la plus longue, en double-croches.
 */
export interface NoteEvent {
  track: number;
  channel: number; // 0..15
  note: number;
  velocity: number;
  startMs: number;
  durationMs: number;
}

export interface CompiledPattern {
  patternId: number;
  lengthMs: number;
  sixteenthMs: number;
  events: NoteEvent[];
}

export interface PlayOptions {
  /** Pistes jouées (0..15). */
  tracks: ReadonlySet<number>;
  /** Canal MIDI (0..15) de chaque piste. */
  channels: readonly number[];
}

export const MICRO_TICKS_PER_STEP = 24;

export function trackTiming(t: { step_count: number; step_length: number }, sixteenthMs: number) {
  const count = Math.min(16, Math.max(1, t.step_count));
  const stepMs = Math.max(1, t.step_length) * sixteenthMs;
  return { count, stepMs, cycleMs: count * stepMs };
}

export function patternLengthSixteenths(pattern: ProjectPattern): number {
  return Math.max(16, ...pattern.tracks.map((t) => Math.min(16, Math.max(1, t.step_count)) * Math.max(1, t.step_length)));
}

export function compilePattern(pattern: ProjectPattern, tempo: number, options: PlayOptions): CompiledPattern {
  const sixteenthMs = 60_000 / Math.max(1, tempo) / 4;
  const lengthMs = patternLengthSixteenths(pattern) * sixteenthMs;
  const events: NoteEvent[] = [];
  for (const t of pattern.tracks) {
    if (t.muted || !options.tracks.has(t.id)) continue;
    const { count, stepMs, cycleMs } = trackTiming(t, sixteenthMs);
    const steps = t.steps.filter((s) => s.index < count && s.notes.length);
    for (let cycle = 0; cycle * cycleMs < lengthMs - 0.001; cycle++) {
      for (const s of steps) {
        for (const n of s.notes) {
          const micro = n.micro ?? (n.micro_raw ?? 0) / 8;
          const startMs = cycle * cycleMs + s.index * stepMs + (micro / MICRO_TICKS_PER_STEP) * stepMs;
          if (startMs >= lengthMs) continue;
          events.push({
            track: t.id,
            channel: options.channels[t.id] ?? t.id,
            note: Math.min(127, Math.max(0, n.note)),
            velocity: Math.min(127, Math.max(1, n.velocity)),
            startMs: Math.max(0, startMs),
            durationMs: n.length > 0 ? Math.max(5, (n.length / DURATION_UNITS_PER_STEP) * stepMs - 2) : stepMs,
          });
        }
      }
    }
  }
  events.sort((a, b) => a.startMs - b.startMs || a.track - b.track);
  return { patternId: pattern.id, lengthMs, sixteenthMs, events };
}

/** Canaux à utiliser : ceux de la config MIDI lue sur l'OP-Z, sinon piste n → canal n. */
export function channelsFor(project: OpzProject): number[] {
  const c = project.midi_config?.trackChannels;
  return Array.from({ length: TRACK_COUNT }, (_, t) => c?.[t] ?? t);
}

/** Points de la config MIDI de l'OP-Z qui empêcheraient la lecture d'être entendue correctement. */
export function midiWarnings(config: MidiConfiguration | null, tracks: ReadonlySet<number>): string[] {
  if (!config) return ['Ce projet ne contient pas la config MIDI de l’OP-Z (projet vierge, ou config non lue à l’import) : canaux 1 à 16 supposés. Réimportez pour la récupérer.'];
  const out: string[] = [];
  if (!(config.settings & (1 << 1))) out.push('L’entrée MIDI de l’OP-Z est désactivée (réglage « incoming MIDI ») : aucune note ne sera jouée.');
  if (config.settings & (1 << 0)) out.push('Réglage « canal 1 → piste active » activé sur l’OP-Z : les notes du Kick (canal 1) sont jouées par la piste sélectionnée sur l’appareil, avec son son. C’est pour ça que couper une piste semble en couper une autre. Sur l’OP-Z : maintenir tempo + écran, appuyer sur la touche 1 (elle s’éteint), relâcher — puis réimporter.');
  const disabled = [...tracks].filter((t) => config.trackEnabled[t] === 0).map((t) => t + 1);
  if (disabled.length) out.push(`MIDI désactivé sur l’OP-Z pour les pistes ${disabled.join(', ')}.`);
  return out;
}
