import { describe, expect, it } from 'vitest';
import { unwrap } from '../src/lib/result';
import { setStepNotes, setTrackSettings } from '../src/project/edit';
import { newProject } from '../src/project/opzProject';
import { compilePattern, midiWarnings, patternLengthSixteenths } from '../src/sequencer/compile';
import { createNoteOutput, isNoteMessage } from '../src/sequencer/noteOutput';
import { Player } from '../src/sequencer/player';
import type { MidiTransport } from '../src/midi/transport';

const ALL = new Set([0, 1, 2, 3, 4, 5, 6, 7]);
const CH = Array.from({ length: 16 }, (_, i) => i);

function fourOnTheFloor() {
  let p = newProject('t');
  for (const s of [0, 4, 8, 12]) p = unwrap(setStepNotes(p, 0, 0, s, [{ note: 53, velocity: 100 }]));
  return p;
}

describe('compilePattern', () => {
  it('120 BPM : double-croche = 125 ms, 4 temps = 4 notes', () => {
    const c = compilePattern(fourOnTheFloor().patterns[0], 120, { tracks: ALL, channels: CH });
    expect(c.sixteenthMs).toBe(125);
    expect(c.lengthMs).toBe(2000);
    expect(c.events.map((e) => e.startMs)).toEqual([0, 500, 1000, 1500]);
    expect(c.events[0]).toMatchObject({ track: 0, channel: 0, note: 53, velocity: 100 });
    expect(c.events[0].durationMs).toBeCloseTo(123);
  });

  it('polymétrie : une piste de 3 steps boucle dans le pattern de 16', () => {
    let p = unwrap(setStepNotes(newProject('t'), 0, 4, 0, [{ note: 40 }]));
    p = unwrap(setTrackSettings(p, 0, 4, { step_count: 3 }));
    const starts = compilePattern(p.patterns[0], 120, { tracks: ALL, channels: CH }).events.map((e) => e.startMs);
    expect(starts).toEqual([0, 375, 750, 1125, 1500, 1875]);
  });

  it('step_length allonge les steps et le pattern', () => {
    let p = unwrap(setStepNotes(newProject('t'), 0, 5, 1, [{ note: 60 }]));
    p = unwrap(setTrackSettings(p, 0, 5, { step_length: 2 }));
    expect(patternLengthSixteenths(p.patterns[0])).toBe(32);
    const c = compilePattern(p.patterns[0], 120, { tracks: ALL, channels: CH });
    expect(c.events.map((e) => e.startMs)).toEqual([250]);
  });

  it('muet, piste non jouée, canal personnalisé, micro-timing', () => {
    let p = fourOnTheFloor();
    p = unwrap(setStepNotes(p, 0, 1, 4, [{ note: 50, micro: 6 }]));
    const channels = CH.slice();
    channels[1] = 9;
    const c = compilePattern(p.patterns[0], 120, { tracks: new Set([1]), channels });
    expect(c.events).toHaveLength(1);
    expect(c.events[0].channel).toBe(9);
    expect(c.events[0].startMs).toBeCloseTo(500 + (6 / 24) * 125);
    p = unwrap(setTrackSettings(p, 0, 1, { muted: true }));
    expect(compilePattern(p.patterns[0], 120, { tracks: new Set([1]), channels }).events).toHaveLength(0);
  });

  it('avertissements de config MIDI', () => {
    const base = { trackEnabled: new Array(16).fill(1), trackChannels: CH, parameterCcs: new Array(256).fill(0), settings: 0b10, padding: [0, 0, 0] };
    expect(midiWarnings(base, ALL)).toEqual([]);
    expect(midiWarnings({ ...base, settings: 0 }, ALL)[0]).toMatch(/désactivée/);
    expect(midiWarnings({ ...base, settings: 0b11 }, ALL)[0]).toMatch(/canal 1 → piste active/);
  });
});

describe('sortie restreinte aux notes (règle n° 1)', () => {
  it('ne laisse passer que Note On / Note Off', () => {
    expect(isNoteMessage([0x90, 60, 100])).toBe(true);
    expect(isNoteMessage([0x8f, 60, 0])).toBe(true);
    for (const bad of [[0xb0, 1, 64], [0xf0, 0x00, 0xf7], [0xfa], [0xf8], [0xc0, 1], [0x90, 200, 1]]) expect(isNoteMessage(bad)).toBe(false);
  });
});

describe('Player', () => {
  function rig() {
    let t = 1000;
    const sent: { data: number[]; at: number }[] = [];
    const transport: MidiTransport = {
      name: 'test',
      send: (d) => sent.push({ data: [...d], at: t }),
      sendAt: (d, at) => sent.push({ data: [...d], at }),
      subscribe: () => () => undefined,
      close: () => undefined,
    };
    const player = new Player(createNoteOutput(transport), { now: () => t, lookaheadMs: 100, startDelayMs: 0 });
    return { player, sent, advance: (ms: number) => { t += ms; player.tick(); } };
  }

  it('boucle le pattern avec des horodatages exacts', () => {
    const { player, sent, advance } = rig();
    const compiled = compilePattern(fourOnTheFloor().patterns[0], 120, { tracks: ALL, channels: CH });
    player.start((i) => ({ compiled, sequenceIndex: i + 1 }));
    for (let i = 0; i < 90; i++) advance(25); // 2,25 s
    player.stop();
    const ons = sent.filter((m) => m.data[0] === 0x90).map((m) => m.at);
    expect(ons.slice(0, 5)).toEqual([1000, 1500, 2000, 2500, 3000]);
    // chaque Note On a son Note Off
    expect(sent.filter((m) => m.data[0] === 0x80).length).toBeGreaterThanOrEqual(ons.length);
    expect(sent.every((m) => isNoteMessage(m.data))).toBe(true);
  });

  it('une modification en cours de lecture s’entend tout de suite (refresh)', () => {
    const { player, sent, advance } = rig();
    const p = fourOnTheFloor();
    const a = compilePattern(p.patterns[0], 120, { tracks: ALL, channels: CH });
    let current = a;
    player.start((i) => ({ compiled: current, sequenceIndex: i + 1 }));
    advance(200); // 1er temps planifié (1000), la suite non
    // on retire tout : les notes non encore planifiées disparaissent dès maintenant
    current = { ...a, events: [] };
    player.refresh(() => current);
    advance(1500);
    player.stop();
    const ons = sent.filter((m) => m.data[0] === 0x90).map((m) => m.at);
    expect(ons).toEqual([1000]);
  });

  it('enchaîne une séquence de patterns (chaîne)', () => {
    const { player, advance } = rig();
    const p = fourOnTheFloor();
    const a = compilePattern(p.patterns[0], 120, { tracks: ALL, channels: CH });
    const b = { ...compilePattern(p.patterns[1], 120, { tracks: ALL, channels: CH }), patternId: 1 };
    const seq = [a, b];
    player.start((i) => ({ compiled: seq[(i + 1) % 2], sequenceIndex: (i + 1) % 2 }));
    advance(2100);
    advance(25);
    expect(player.position()).toMatchObject({ patternId: 1, sequenceIndex: 1 });
    player.stop();
    expect(player.playing).toBe(false);
  });

  it('stop coupe les notes en cours immédiatement', () => {
    const { player, sent, advance } = rig();
    let p = newProject('t');
    p = unwrap(setStepNotes(p, 0, 5, 0, [{ note: 60, lengthSteps: 8 }]));
    const compiled = compilePattern(p.patterns[0], 120, { tracks: ALL, channels: CH });
    player.start((i) => ({ compiled, sequenceIndex: i + 1 }));
    advance(200);
    player.stop();
    const offs = sent.filter((m) => m.data[0] === 0x85 && m.at === 1200);
    expect(offs.length).toBe(1);
  });
});
