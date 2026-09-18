import type { CompiledPattern } from './compile';
import type { NoteOutput } from './noteOutput';

/**
 * Lecteur temps réel : planifie les notes un peu en avance (lookahead) avec
 * les horodatages de Web MIDI (`output.send(data, timestamp)`), ce qui rend
 * le rythme indépendant des saccades de l'interface.
 *
 * `nextPattern()` est rappelée à chaque fin de pattern : les modifications
 * faites pendant la lecture sont entendues au tour suivant.
 */
export interface PlayerOptions {
  now?: () => number;
  lookaheadMs?: number;
  intervalMs?: number;
  /** Délai avant la première note, pour laisser le temps à la planification. */
  startDelayMs?: number;
  /** Appelé dès qu'un pattern est planifié, avec l'heure (performance.now) où il commence. */
  onSegment?: (patternId: number, startAt: number) => void;
}

export interface PlayerPosition {
  patternId: number;
  /** Index dans la séquence jouée (chaîne). */
  sequenceIndex: number;
  elapsedMs: number;
  sixteenthMs: number;
}

interface Segment {
  compiled: CompiledPattern;
  sequenceIndex: number;
  startAt: number;
  nextEvent: number;
}

export class Player {
  private readonly out: NoteOutput;
  private readonly now: () => number;
  private readonly lookaheadMs: number;
  private readonly intervalMs: number;
  private readonly startDelayMs: number;
  private readonly onSegment: (patternId: number, startAt: number) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private segments: Segment[] = [];
  private nextPattern: ((sequenceIndex: number) => { compiled: CompiledPattern; sequenceIndex: number } | null) | null = null;
  /** Notes dont le Note On est planifié et le Note Off pas encore passé : clé canal/note → heure du Note Off. */
  private readonly sounding = new Map<string, { channel: number; note: number; onAt: number; offAt: number }>();

  constructor(out: NoteOutput, options: PlayerOptions = {}) {
    this.out = out;
    this.now = options.now ?? (() => performance.now());
    this.lookaheadMs = options.lookaheadMs ?? 120;
    this.intervalMs = options.intervalMs ?? 25;
    this.startDelayMs = options.startDelayMs ?? 60;
    this.onSegment = options.onSegment ?? (() => undefined);
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  start(next: (sequenceIndex: number) => { compiled: CompiledPattern; sequenceIndex: number } | null): void {
    this.stop();
    this.nextPattern = next;
    const first = next(-1);
    if (!first) return;
    this.segments = [{ ...first, startAt: this.now() + this.startDelayMs, nextEvent: 0 }];
    this.onSegment(first.compiled.patternId, this.segments[0].startAt);
    this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.segments = [];
    this.nextPattern = null;
    // Coupe tout de suite les notes en cours ; celles déjà planifiées dans le futur
    // sont coupées 1 ms après leur Note On (on ne peut pas annuler un envoi horodaté).
    const now = this.now();
    for (const { channel, note, onAt } of this.sounding.values()) this.out.noteOff(channel, note, onAt > now ? onAt + 1 : now);
    this.sounding.clear();
  }

  position(): PlayerPosition | null {
    const t = this.now();
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const s = this.segments[i];
      if (t >= s.startAt) {
        return { patternId: s.compiled.patternId, sequenceIndex: s.sequenceIndex, elapsedMs: t - s.startAt, sixteenthMs: s.compiled.sixteenthMs };
      }
    }
    const first = this.segments[0];
    return first ? { patternId: first.compiled.patternId, sequenceIndex: first.sequenceIndex, elapsedMs: 0, sixteenthMs: first.compiled.sixteenthMs } : null;
  }

  /**
   * Modification en cours de lecture : remplace les notes pas encore planifiées par celles
   * du pattern recompilé (les notes déjà envoyées à l'OP-Z, horodatées, ne peuvent plus changer).
   */
  refresh(recompile: (patternId: number) => CompiledPattern | null): void {
    const now = this.now();
    for (const seg of this.segments) {
      if (seg.startAt + seg.compiled.lengthMs <= now) continue;
      const c = recompile(seg.compiled.patternId);
      if (!c) continue;
      seg.compiled = c;
      const i = c.events.findIndex((e) => seg.startAt + e.startMs >= this.planned);
      seg.nextEvent = i < 0 ? c.events.length : i;
    }
  }

  /** Heure jusqu'à laquelle tout est déjà planifié. */
  private planned = 0;

  /** Planifie tout ce qui tombe avant `now + lookahead`. Public pour les tests. */
  tick(): void {
    const horizon = this.now() + this.lookaheadMs;
    this.planned = horizon;
    for (const [key, s] of this.sounding) if (s.offAt < this.now()) this.sounding.delete(key);
    while (this.segments.length) {
      const seg = this.segments[this.segments.length - 1];
      const events = seg.compiled.events;
      while (seg.nextEvent < events.length && seg.startAt + events[seg.nextEvent].startMs < horizon) {
        const e = events[seg.nextEvent++];
        const on = seg.startAt + e.startMs;
        const off = on + e.durationMs;
        this.out.noteOn(e.channel, e.note, e.velocity, on);
        this.out.noteOff(e.channel, e.note, off);
        this.sounding.set(`${e.channel}/${e.note}/${on}`, { channel: e.channel, note: e.note, onAt: on, offAt: off });
      }
      const end = seg.startAt + seg.compiled.lengthMs;
      if (end >= horizon || !this.nextPattern) break;
      const next = this.nextPattern(seg.sequenceIndex);
      if (!next) break;
      this.segments.push({ ...next, startAt: end, nextEvent: 0 });
      this.onSegment(next.compiled.patternId, end);
      if (this.segments.length > 3) this.segments.shift();
    }
  }
}
