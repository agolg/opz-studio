import { describe, expect, it } from 'vitest';
import { concat, diffOffsets, toHex } from '../src/lib/bytes';
import { unwrap } from '../src/lib/result';
import { decodeFrame } from '../src/midi/frame';
import { PatternBankAssembler, patternAckFrame, patternUploadFrames } from '../src/midi/patternTransfer';
import { decompress } from '../src/midi/zlib';
import { NOTE_SLOT_OFFSETS, NOTES_PER_STEP, PATTERN_BANK_SIZE, PATTERN_COUNT, PATTERN_SIZE, TRACK_NAMES } from '../src/project/layout';
import { decodeBank, encodeBank, opaquePatternOffsets, PatternBankEditor, type NoteInput } from '../src/project/patternBank';
import { blankBank, fixture, hex, randomBytes, sha256, summarisePatternFrames } from './helpers';

type Op = [string, ...unknown[]];
interface PatternFixture {
  layout: { pattern_size: number; bank_size: number; notes_per_step: number[]; note_offsets: number[]; track_names: string[] };
  blank_bank_sha256: string;
  ops: { op: Op; diff: [number, number][]; sha256: string }[];
  invalid_ops: { op: Op; rejected: boolean }[];
  final_bank_sha256: string;
  final_bank_zlib: string;
  upload_full: { address: number; transfer_id: number; frames: string[] };
  upload_prefix: { address: number; transfer_id: number; frames: string[] };
}
const fx = fixture<PatternFixture>('pattern');

function apply(editor: PatternBankEditor, op: Op) {
  const [kind, ...a] = op as [string, ...number[]];
  const args = a as unknown[];
  switch (kind) {
    case 'notes': {
      const notes = (args[3] as number[][]).map(([note, velocity, duration, microtimingTicks, age]): NoteInput => ({ note, velocity, duration, microtimingTicks, age }));
      return editor.setNotes(a[0], a[1], a[2], notes);
    }
    case 'lock': return editor.setParameterLock(a[0], a[1], a[2], a[3], args[4] as number | null);
    case 'component': return editor.setComponent(a[0], a[1], a[2], a[3], args[4] as number | null);
    case 'sound': return editor.setSoundParameter(a[0], a[1], a[2], a[3]);
    case 'plug': return editor.setActivePlug(a[0], a[1], a[2]);
    case 'step_count': return editor.setStepCount(a[0], a[1], a[2]);
    case 'muted': return editor.setMuted(a[0], a[1], args[2] as boolean);
    case 'routing': return editor.setRouting(a[0], { tape: (args[1] as number | null) ?? undefined, master: (args[2] as number | null) ?? undefined });
    default: throw new Error(`unknown op ${kind}`);
  }
}

describe('layout matches the reference', () => {
  it('sizes, note slots and track names', () => {
    expect(PATTERN_SIZE).toBe(fx.layout.pattern_size);
    expect(PATTERN_BANK_SIZE).toBe(fx.layout.bank_size);
    expect([...NOTES_PER_STEP]).toEqual(fx.layout.notes_per_step);
    expect([...NOTE_SLOT_OFFSETS]).toEqual(fx.layout.note_offsets);
    expect(TRACK_NAMES.length).toBe(fx.layout.track_names.length);
    expect(sha256(blankBank())).toBe(fx.blank_bank_sha256);
  });
});

describe('PatternBankEditor (byte-for-byte vs opzsysex.project.PatternBankEditor)', () => {
  const editor = unwrap(PatternBankEditor.from(blankBank()));
  let previous = editor.bytes();
  it.each(fx.ops.map((o, i) => [i, o.op[0], o] as const))('op #%i %s touches exactly the reference bytes', (_i, _k, o) => {
    unwrap(apply(editor, o.op));
    const current = editor.bytes();
    expect(diffOffsets(previous, current).map(([off, , after]) => [off, after])).toEqual(o.diff);
    expect(sha256(current)).toBe(o.sha256);
    previous = current;
  });
  it('final bank hash and compressed form match', () => {
    expect(sha256(editor.bytes())).toBe(fx.final_bank_sha256);
    expect(toHex(unwrap(decompress(hex(fx.final_bank_zlib))))).toBe(toHex(editor.bytes()));
  });
  it.each(fx.invalid_ops.map((o, i) => [i, o] as const))('invalid op #%i is rejected like Python', (_i, o) => {
    const e = unwrap(PatternBankEditor.from(blankBank()));
    expect(apply(e, o.op).ok).toBe(!o.rejected);
    expect(sha256(e.bytes())).toBe(fx.blank_bank_sha256); // nothing written on failure
  });
  it('never mutates the source buffer', () => {
    const source = blankBank();
    const e = unwrap(PatternBankEditor.from(source));
    unwrap(e.setSoundParameter(0, 0, 0, 1));
    expect(sha256(source)).toBe(fx.blank_bank_sha256);
  });
});

describe('pattern transfer', () => {
  const finalBank = unwrap(decompress(hex(fx.final_bank_zlib)));
  it.each([
    ['full bank', fx.upload_full, PATTERN_BANK_SIZE],
    ['one-pattern prefix', fx.upload_prefix, PATTERN_SIZE],
  ] as const)('%s upload frames: same structure and same inflated bytes as pattern_upload_frames', (_label, ref, size) => {
    const ours = summarisePatternFrames(unwrap(patternUploadFrames(finalBank.subarray(0, size), ref.address, ref.transfer_id)));
    const theirs = summarisePatternFrames(ref.frames.map((f) => hex(f)));
    expect(sha256(ours.content)).toBe(sha256(theirs.content));
    expect(ours.content.length).toBe(size);
    // $09 … $09 $0A with [address, 0, id, index] headers and 178-byte chunks
    ours.ids.forEach((id, i) => expect(id).toBe(i === ours.ids.length - 1 ? 0x0a : 0x09));
    ours.headers.forEach((h, i) => expect(h).toBe(theirs.headers[0].slice(0, 8) + [i & 0xff, i >> 8].map((b) => b.toString(16).padStart(2, '0')).join('')));
    ours.chunkSizes.slice(0, -1).forEach((n) => expect(n).toBe(178));
    expect(theirs.chunkSizes.slice(0, -1).every((n) => n === 178)).toBe(true);
  });
  it('assembler rebuilds the exact bank and ACKs every $09', () => {
    const asm = new PatternBankAssembler();
    const acks: string[] = [];
    let bank: Uint8Array | null = null;
    fx.upload_full.frames.forEach((f, index) => {
      const step = unwrap(asm.accept(unwrap(decodeFrame(hex(f)))));
      if (step.kind === 'packet') acks.push(toHex(step.ack ?? new Uint8Array()));
      else bank = step.received.bank;
      if (index < fx.upload_full.frames.length - 1) expect(step.kind).toBe('packet');
    });
    expect(bank).not.toBeNull();
    expect(sha256(bank!)).toBe(fx.final_bank_sha256);
    expect(acks[1]).toBe(toHex(unwrap(patternAckFrame(fx.upload_full.transfer_id, 1))));
    expect(toHex(unwrap(decodeFrame(hex(acks[1]))).payload)).toBe('0900000034120100');
  });
  it('assembler fails closed on out-of-order, id change, or wrong size', () => {
    const frames = fx.upload_full.frames.map((f) => unwrap(decodeFrame(hex(f))));
    const skip = new PatternBankAssembler();
    unwrap(skip.accept(frames[0]));
    expect(skip.accept(frames[2]).ok).toBe(false);
    expect(new PatternBankAssembler().accept(frames[1]).ok).toBe(false);
    const other = unwrap(patternUploadFrames(finalBank, 0x2f, 0x9999)).map((f) => unwrap(decodeFrame(f)));
    const idChange = new PatternBankAssembler();
    unwrap(idChange.accept(frames[0]));
    expect(idChange.accept(other[1]).ok).toBe(false);
    const prefix = unwrap(patternUploadFrames(finalBank.subarray(0, PATTERN_SIZE), 0x20, 1)).map((f) => unwrap(decodeFrame(f)));
    expect(new PatternBankAssembler().accept(prefix[0]).ok).toBe(false); // 21,392 bytes ≠ bank size
  });
});

describe('typed view (decode / encode)', () => {
  const finalBank = unwrap(decompress(hex(fx.final_bank_zlib)));
  it('encode(decode(b), b) === b on the fixture bank', () => {
    const view = unwrap(decodeBank(finalBank));
    expect(sha256(unwrap(encodeBank(view, finalBank)))).toBe(fx.final_bank_sha256);
  });
  it('encode(decode(b), b) === b on random bytes', () => {
    const random = randomBytes(PATTERN_BANK_SIZE, 7);
    expect(sha256(unwrap(encodeBank(unwrap(decodeBank(random)), random)))).toBe(sha256(random));
  });
  it('decoded fields reflect the edits', () => {
    const view = unwrap(decodeBank(finalBank));
    const kick = view[0].tracks[0];
    expect(kick.plug).toBe(1);
    expect(kick.steps[0].slots[0]).toEqual({ duration: 6200, note: 48, velocity: 100, microRaw: 0, age: 0 });
    expect(kick.steps[0].componentMask).toBe((1 << 0) | (1 << 13));
    expect(kick.sound[8]).toBe(127);
    const arp = view[15].tracks[6].steps[15];
    expect(arp.slots.map((s) => s?.note)).toEqual([40, 41, 42, 43, 44, 45, 46, 47]);
    expect(arp.slots[0]?.microRaw).toBe(-96);
    expect(view[0].tapeRouting).toBe(0xa55a);
    expect(view[15].masterRouting).toBe(0x5aa5);
  });
  it('the typed view covers every byte except the documented opaque ones', () => {
    const random = randomBytes(PATTERN_BANK_SIZE, 11);
    const rebuilt = unwrap(encodeBank(unwrap(decodeBank(random)), new Uint8Array(PATTERN_BANK_SIZE)));
    const opaque = new Set(opaquePatternOffsets());
    const unused = new Set<number>();
    // unused note slots keep bytes 0-3 and 5-7 from the baseline
    for (let p = 0; p < PATTERN_COUNT; p++) {
      for (let i = 0; i < 880; i++) {
        const o = p * PATTERN_SIZE + 192 + i * 8;
        if (random[o + 4] === 0xff) for (const k of [0, 1, 2, 3, 5, 6, 7]) unused.add(o + k);
      }
    }
    const unexpected = diffOffsets(random, rebuilt).filter(([off]) => !opaque.has(off % PATTERN_SIZE) && !unused.has(off));
    expect(unexpected).toEqual([]);
  });
  it('rejects malformed views', () => {
    const view = unwrap(decodeBank(finalBank));
    view[0].tracks[0].sound[0] = 256;
    expect(encodeBank(view, finalBank).ok).toBe(false);
    expect(encodeBank(view.slice(0, 3), finalBank).ok).toBe(false);
  });
  it('concat helper sanity', () => {
    expect(concat([Uint8Array.of(1), Uint8Array.of(2, 3)])).toEqual(Uint8Array.of(1, 2, 3));
  });
});
