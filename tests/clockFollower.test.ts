import { describe, expect, it } from 'vitest';
import { ClockFollower } from '../src/sequencer/clockFollower';

describe('ClockFollower (l’OP-Z joue lui-même)', () => {
  it('départ, impulsions, arrêt', () => {
    let t = 0;
    const states: boolean[] = [];
    const f = new ClockFollower((r) => states.push(r), () => t);
    f.handle([0xfa]);
    for (let i = 0; i < 12; i++) { t += 20; f.handle([0xf8]); }
    expect(f.isRunning).toBe(true);
    expect(f.sixteenths()).toBeCloseTo(2, 5);
    f.handle([0xfc]);
    expect(states).toEqual([true, false]);
  });
  it('détecte une horloge sans départ, puis le silence', () => {
    let t = 0;
    const f = new ClockFollower(() => undefined, () => t);
    for (let i = 0; i < 12; i++) { t += 20; f.handle([0xf8]); }
    expect(f.isRunning).toBe(true);
    t += 1000;
    f.check();
    expect(f.isRunning).toBe(false);
  });
  it('ignore les autres messages', () => {
    const f = new ClockFollower(() => undefined, () => 0);
    f.handle([0x90, 60, 100]);
    f.handle([0xf0, 0, 0xf7]);
    expect(f.isRunning).toBe(false);
  });
});
