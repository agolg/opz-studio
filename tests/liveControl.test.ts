import { describe, expect, it } from 'vitest';
import { decodeChainTelemetry } from '../src/sequencer/telemetry';
import { ccFor, createLiveOutput, isAllowedLive, liveDiff, patternSelectMsg } from '../src/sequencer/liveControl';
import type { MidiTransport } from '../src/midi/transport';
import type { ProjectPattern } from '../src/project/opzProject';

const sink = () => {
  const sent: number[][] = [];
  const t = { send: (d: Uint8Array) => sent.push([...d]), subscribe: () => () => undefined, close: () => undefined, name: 'x' } as unknown as MidiTransport;
  return { sent, t };
};

describe('télémétrie $07', () => {
  it('décode la télémétrie $07', () => {
    const p = new Uint8Array(20);
    p.set([1, 4, 0, 2], 16);
    expect(decodeChainTelemetry(p)).toEqual({ project: 2, pattern: 4, chainLength: 1 });
    expect(decodeChainTelemetry(new Uint8Array(5))).toBeNull();
  });
});

describe('contrôle en direct', () => {
  it('CC 103 : canal = projet, valeur = pattern', () => {
    expect(patternSelectMsg(1, 7)).toEqual({ channel: 1, cc: 103, value: 7 });
    expect(patternSelectMsg(10, 0)).toBeNull();
  });
  it('la sortie refuse tout ce qui n’est pas autorisé', () => {
    const { sent, t } = sink();
    const out = createLiveOutput(t);
    out.cc({ channel: 2, cc: 3, value: 64 });
    out.program(0, 5);
    expect(sent).toEqual([[0xb2, 3, 64], [0xc0, 5]]);
    expect(() => out.cc({ channel: 0, cc: 120, value: 0 })).toThrow();
    expect(isAllowedLive([0xfa])).toBe(false);
    expect(isAllowedLive([0xf0, 0x7e, 0x7f])).toBe(false);
  });
  it('ordre des CC du guide et diff des paramètres / muets', () => {
    expect(ccFor(null, 0, 'filter')).toBe(3);
    expect(ccFor(null, 0, 'level')).toBe(16);
    expect(ccFor(null, 0, 'note_style')).toBe(18);
    const sound = { param1: 0, param2: 0, attack: 0, decay: 0, sustain: 0, release: 0, fx1: 0, fx2: 0, filter: 128, resonance: 0, pan: 127, level: 128, portamento: 0, lfo_depth: 0, lfo_speed: 0, lfo_value: 0, lfo_shape: 0, note_style: 0 };
    const track = { id: 8, name: 'fx1', plug: 1, step_count: 16, step_length: 1, quantize: 0, note_style: 0, note_length: 0, muted: false, sound, steps: [] };
    const a = { id: 0, active_mute_group: 0, tape_routing: 0, master_routing: 0, tracks: [track] } as unknown as ProjectPattern;
    const b = { ...a, tracks: [{ ...track, muted: true, sound: { ...sound, filter: 40, fx1: 255 } }] } as unknown as ProjectPattern;
    const ch = Array.from({ length: 16 }, (_, i) => i);
    expect(liveDiff(a, b, null, ch)).toEqual([{ channel: 8, cc: 3, value: 20 }, { channel: 8, cc: 13, value: 127 }, { channel: 8, cc: 53, value: 1 }]);
  });
});

describe('méthodes de changement de pattern / projet', () => {
  it('construisent des messages autorisés', async () => {
    const { SWITCH_METHODS } = await import('../src/sequencer/liveControl');
    for (const m of SWITCH_METHODS) {
      const steps = m.build(9, 15);
      expect(steps).not.toBeNull();
      for (const s of steps!) {
        const bytes = s.kind === 'cc' ? [0xb0 | s.msg.channel, s.msg.cc, s.msg.value] : [0xc0 | s.channel, s.program];
        expect(isAllowedLive(bytes)).toBe(true);
      }
      expect(m.build(10, 0)).toBeNull();
    }
    const pc16 = SWITCH_METHODS.find((m) => m.id === 'pc16')!;
    expect(pc16.build(1, 0)).toEqual([{ kind: 'cc', msg: { channel: 15, cc: 0, value: 0 } }, { kind: 'pc', channel: 15, program: 16 }]);
    expect(pc16.build(8, 2)).toEqual([{ kind: 'cc', msg: { channel: 15, cc: 0, value: 1 } }, { kind: 'pc', channel: 15, program: 2 }]);
  });
});
