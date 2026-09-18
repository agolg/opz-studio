/**
 * Suit l'horloge MIDI envoyée par l'OP-Z quand il joue lui-même (réglage « midi clock out »,
 * touche 5 des réglages MIDI). Messages temps réel standard : F8 horloge (24 par noire),
 * FA départ, FB reprise, FC arrêt. Lecture seule : rien n'est envoyé.
 */
export const CLOCK = 0xf8;
export const START = 0xfa;
export const CONTINUE = 0xfb;
export const STOP = 0xfc;
/** 24 impulsions par noire = 6 par double-croche. */
export const TICKS_PER_SIXTEENTH = 6;
/** Sans impulsion depuis ce délai, on considère que l'OP-Z ne joue plus. */
const SILENCE_MS = 500;

export class ClockFollower {
  private ticks = 0;
  private running = false;
  private lastTickAt = 0;
  private readonly tickTimes: number[] = [];

  constructor(private readonly onRunning: (running: boolean) => void, private readonly now: () => number = () => performance.now()) {}

  /** À appeler pour chaque message MIDI entrant. */
  handle(data: ArrayLike<number>): void {
    if (data.length !== 1) return;
    const b = data[0];
    const t = this.now();
    if (b === START) {
      this.ticks = 0;
      this.tickTimes.length = 0;
      this.setRunning(true);
      this.lastTickAt = t;
    } else if (b === CONTINUE) {
      this.setRunning(true);
      this.lastTickAt = t;
    } else if (b === STOP) {
      this.setRunning(false);
    } else if (b === CLOCK) {
      if (this.running) this.ticks++;
      this.lastTickAt = t;
      this.tickTimes.push(t);
      if (this.tickTimes.length > 48) this.tickTimes.shift();
      // Horloge qui arrive sans « départ » (éditeur ouvert pendant que l'OP-Z joue).
      if (!this.running && this.tickTimes.length >= 12 && this.tickTimes[this.tickTimes.length - 1] - this.tickTimes[this.tickTimes.length - 12] < 11 * 125) {
        this.ticks = 0;
        this.setRunning(true);
      }
    }
  }

  /** Vérifie le silence (à appeler régulièrement). */
  check(): void {
    if (this.running && this.now() - this.lastTickAt > SILENCE_MS) this.setRunning(false);
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Durée d'une impulsion mesurée (ms), ou null. */
  tickMs(): number | null {
    const n = this.tickTimes.length;
    return n >= 2 ? (this.tickTimes[n - 1] - this.tickTimes[0]) / (n - 1) : null;
  }

  /** Doubles-croches écoulées depuis le départ (avec interpolation entre deux impulsions). */
  sixteenths(): number {
    const ms = this.tickMs();
    const frac = ms ? Math.min(1, (this.now() - this.lastTickAt) / ms) : 0;
    return (this.ticks + frac) / TICKS_PER_SIXTEENTH;
  }

  private setRunning(r: boolean): void {
    if (r === this.running) return;
    this.running = r;
    this.onRunning(r);
  }
}
