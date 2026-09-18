import { u16le, u32le, i32le, writeU16le, writeU32le } from '../lib/bytes';
import { ok, protocolError, type ProtocolError, type Result } from '../lib/result';
import {
  LOCK_ENABLED, MICRO_RAW_PER_TICK, NOTE_REC, NOTE_UNUSED, NOTES_PER_STEP, OFF, PATTERN_BANK_SIZE, PATTERN_COUNT,
  SOUND_PARAMS, STEP_COUNT, STEP_REC, TRACK_COUNT, TRACK_NAMES, TRACK_REC, noteRecordOffset, patternBase,
  soundOffset, stepRecordOffset, trackRecordOffset,
} from './layout';

/**
 * Typed, validated edits of a 342,272-byte pattern bank.
 * Faithful port of opzsysex/project.py PatternBankEditor: every method touches
 * only the bytes the reference touches (asserted byte-for-byte by tests/patternBank.test.ts).
 */
export interface NoteInput {
  readonly note: number;
  readonly velocity?: number; // default 100
  readonly duration?: number; // default 6200 (one step)
  readonly microtimingTicks?: number; // displayed ticks −12…+11, default 0
  readonly age?: number; // default 0
}

type R = Result<void, ProtocolError>;
const done: R = ok(undefined);

export class PatternBankEditor {
  private readonly data: Uint8Array;

  private constructor(data: Uint8Array) {
    this.data = data;
  }

  /** Copies the input; the source buffer is never mutated. */
  static from(bank: Uint8Array): Result<PatternBankEditor, ProtocolError> {
    if (bank.length !== PATTERN_BANK_SIZE) return protocolError(`pattern bank must be ${PATTERN_BANK_SIZE} bytes`);
    return ok(new PatternBankEditor(bank.slice()));
  }

  bytes(): Uint8Array {
    return this.data.slice();
  }

  setNotes(pattern: number, track: number, step: number, notes: readonly NoteInput[]): R {
    const v = validate(pattern, track, step);
    if (!v.ok) return v;
    const capacity = NOTES_PER_STEP[track];
    if (notes.length > capacity) return protocolError(`${TRACK_NAMES[track]} stores at most ${capacity} notes per step`);
    const resolved = notes.map((n) => ({ velocity: 100, duration: 6200, microtimingTicks: 0, age: 0, ...n }));
    for (const n of resolved) {
      if (!isInt(n.note, 0, 127) || !isInt(n.velocity, 1, 127) || !isInt(n.duration, 1, 0x7fffffff)) {
        return protocolError('note, velocity, or duration is outside the writable range');
      }
      if (!Number.isInteger(n.microtimingTicks) || !isInt(n.microtimingTicks * MICRO_RAW_PER_TICK, -96, 88)) {
        return protocolError('microtiming ticks must encode to raw -96..88');
      }
      if (!isInt(n.age, 0, 255)) return protocolError('note age must be 0..255');
    }
    for (let slot = 0; slot < capacity; slot++) {
      const offset = noteRecordOffset(pattern, track, step, slot);
      const n = resolved[slot];
      if (n) {
        writeNote(this.data, offset, { duration: n.duration, note: n.note, velocity: n.velocity, microRaw: n.microtimingTicks * MICRO_RAW_PER_TICK, age: n.age });
      } else {
        this.data[offset + NOTE_REC.NOTE] = NOTE_UNUSED;
      }
    }
    return done;
  }

  /** value = null clears the enable byte only and preserves the last value (reference behaviour). */
  setParameterLock(pattern: number, track: number, step: number, parameter: number, value: number | null): R {
    const v = validate(pattern, track, step);
    if (!v.ok) return v;
    if (!isInt(parameter, 0, SOUND_PARAMS.length - 1)) return protocolError('parameter must be 0..17');
    const offset = stepRecordOffset(pattern, track, step);
    if (value === null) {
      this.data[offset + STEP_REC.LOCK_ENABLED + parameter] = 0;
    } else if (isInt(value, 0, 255)) {
      this.data[offset + STEP_REC.LOCK_VALUES + parameter] = value;
      this.data[offset + STEP_REC.LOCK_ENABLED + parameter] = LOCK_ENABLED;
    } else {
      return protocolError('parameter-lock value must be 0..255');
    }
    return done;
  }

  /** value = null clears the mask bit only and preserves the value byte (reference behaviour). */
  setComponent(pattern: number, track: number, step: number, component: number, value: number | null): R {
    const v = validate(pattern, track, step);
    if (!v.ok) return v;
    if (!isInt(component, 0, 15)) return protocolError('component must be 0..15');
    const offset = stepRecordOffset(pattern, track, step);
    let mask = u16le(this.data, offset + STEP_REC.COMPONENT_MASK);
    if (value === null) {
      mask &= ~(1 << component);
    } else if (isInt(value, 0, 255)) {
      mask |= 1 << component;
      this.data[offset + STEP_REC.COMPONENT_VALUES + component] = value;
    } else {
      return protocolError('component value must be 0..255');
    }
    writeU16le(this.data, offset + STEP_REC.COMPONENT_MASK, mask & 0xffff);
    return done;
  }

  setSoundParameter(pattern: number, track: number, parameter: number, value: number): R {
    const v = validate(pattern, track);
    if (!v.ok) return v;
    if (!isInt(parameter, 0, 17) || !isInt(value, 0, 255)) return protocolError('sound parameter must be 0..17 and value 0..255');
    this.data[soundOffset(pattern, track, parameter)] = value;
    return done;
  }

  setActivePlug(pattern: number, track: number, plugId: number): R {
    const v = validate(pattern, track);
    if (!v.ok) return v;
    if (!isInt(plugId, 1, 0xffffffff)) return protocolError('plug id must be a nonzero UInt32');
    writeU32le(this.data, trackRecordOffset(pattern, track) + TRACK_REC.PLUG, plugId);
    return done;
  }

  setStepCount(pattern: number, track: number, count: number): R {
    const v = validate(pattern, track);
    if (!v.ok) return v;
    if (!isInt(count, 1, 16)) return protocolError('step count must be 1..16');
    this.data[trackRecordOffset(pattern, track) + TRACK_REC.STEP_COUNT] = count;
    return done;
  }

  /** Mutes the track in the pattern's *active* mute group. */
  setMuted(pattern: number, track: number, muted: boolean): R {
    const v = validate(pattern, track);
    if (!v.ok) return v;
    const base = patternBase(pattern);
    const group = Math.min(this.data[base + OFF.ACTIVE_MUTE_GROUP], OFF.MUTE_GROUP_COUNT - 1);
    const offset = base + OFF.MUTE_GROUPS + group * 4 + (track >> 2);
    const bit = 1 << ((track % 4) * 2 + 1);
    this.data[offset] = muted ? this.data[offset] | bit : this.data[offset] & ~bit;
    return done;
  }

  setRouting(pattern: number, routing: { tape?: number; master?: number }): R {
    const v = validate(pattern, 0);
    if (!v.ok) return v;
    const base = patternBase(pattern);
    for (const [value, offset] of [[routing.tape, OFF.TAPE_ROUTING], [routing.master, OFF.MASTER_ROUTING]] as const) {
      if (value === undefined) continue;
      if (!isInt(value, 0, 0xffff)) return protocolError('routing mask must fit UInt16');
      writeU16le(this.data, base + offset, value);
    }
    return done;
  }
}

// ---------------------------------------------------------------------------
// Lossless typed view of a bank (decode) and its inverse (encode onto a baseline)
// ---------------------------------------------------------------------------

/** Raw note record. `microRaw` is the stored signed byte (displayed ticks × 8). */
export interface NoteRecord {
  duration: number;
  note: number;
  velocity: number;
  microRaw: number;
  age: number;
}

export interface StepView {
  /** One entry per note slot of this track; null = slot unused (note byte FF). */
  slots: (NoteRecord | null)[];
  componentMask: number;
  componentValues: number[]; // 16
  lockValues: number[]; // 18
  lockEnabled: number[]; // 18, FF = locked
}

export interface TrackView {
  plug: number;
  stepCount: number;
  stepLength: number;
  quantize: number;
  noteStyle: number;
  noteLength: number;
  sound: number[]; // 18, SOUND_PARAMS order
  steps: StepView[]; // 16
}

export interface PatternView {
  tracks: TrackView[]; // 16
  muteGroups: number[]; // 40 raw bytes
  activeMuteGroup: number;
  tapeRouting: number;
  masterRouting: number;
}

export function decodeBank(bank: Uint8Array): Result<PatternView[], ProtocolError> {
  if (bank.length !== PATTERN_BANK_SIZE) return protocolError(`pattern bank must be ${PATTERN_BANK_SIZE} bytes`);
  const patterns: PatternView[] = [];
  for (let p = 0; p < PATTERN_COUNT; p++) patterns.push(decodePattern(bank, p));
  return ok(patterns);
}

function decodePattern(bank: Uint8Array, p: number): PatternView {
  const base = patternBase(p);
  const tracks: TrackView[] = [];
  for (let t = 0; t < TRACK_COUNT; t++) {
    const tr = trackRecordOffset(p, t);
    const steps: StepView[] = [];
    for (let s = 0; s < STEP_COUNT; s++) {
      const slots: (NoteRecord | null)[] = [];
      for (let slot = 0; slot < NOTES_PER_STEP[t]; slot++) {
        const o = noteRecordOffset(p, t, s, slot);
        slots.push(bank[o + NOTE_REC.NOTE] === NOTE_UNUSED ? null : readNote(bank, o));
      }
      const so = stepRecordOffset(p, t, s);
      steps.push({
        slots,
        componentMask: u16le(bank, so + STEP_REC.COMPONENT_MASK),
        componentValues: Array.from(bank.subarray(so + STEP_REC.COMPONENT_VALUES, so + STEP_REC.COMPONENT_VALUES + 16)),
        lockValues: Array.from(bank.subarray(so + STEP_REC.LOCK_VALUES, so + STEP_REC.LOCK_VALUES + 18)),
        lockEnabled: Array.from(bank.subarray(so + STEP_REC.LOCK_ENABLED, so + STEP_REC.LOCK_ENABLED + 18)),
      });
    }
    tracks.push({
      plug: u32le(bank, tr + TRACK_REC.PLUG),
      stepCount: bank[tr + TRACK_REC.STEP_COUNT],
      stepLength: bank[tr + TRACK_REC.STEP_LENGTH],
      quantize: bank[tr + TRACK_REC.QUANTIZE],
      noteStyle: bank[tr + TRACK_REC.NOTE_STYLE],
      noteLength: bank[tr + TRACK_REC.NOTE_LENGTH],
      sound: Array.from(bank.subarray(soundOffset(p, t, 0), soundOffset(p, t, 0) + SOUND_PARAMS.length)),
      steps,
    });
  }
  return {
    tracks,
    muteGroups: Array.from(bank.subarray(base + OFF.MUTE_GROUPS, base + OFF.MUTE_GROUPS + OFF.MUTE_GROUP_COUNT * 4)),
    activeMuteGroup: bank[base + OFF.ACTIVE_MUTE_GROUP],
    tapeRouting: u16le(bank, base + OFF.TAPE_ROUTING),
    masterRouting: u16le(bank, base + OFF.MASTER_ROUTING),
  };
}

/**
 * Writes every mapped field of `patterns` over a copy of `baseline`.
 * Unmapped bytes (see opaqueOffsets) are taken from the baseline untouched, so
 * encodeBank(decodeBank(b), b) === b. Values are written raw (no musical
 * validation) — validation belongs to the editor/UI layer.
 */
export function encodeBank(patterns: readonly PatternView[], baseline: Uint8Array): Result<Uint8Array, ProtocolError> {
  if (baseline.length !== PATTERN_BANK_SIZE) return protocolError(`baseline bank must be ${PATTERN_BANK_SIZE} bytes`);
  if (patterns.length !== PATTERN_COUNT) return protocolError(`expected ${PATTERN_COUNT} patterns, got ${patterns.length}`);
  const out = baseline.slice();
  for (let p = 0; p < PATTERN_COUNT; p++) {
    const pv = patterns[p];
    const base = patternBase(p);
    if (pv.tracks.length !== TRACK_COUNT || pv.muteGroups.length !== OFF.MUTE_GROUP_COUNT * 4) return protocolError(`pattern ${p}: malformed view`);
    for (let t = 0; t < TRACK_COUNT; t++) {
      const tv = pv.tracks[t];
      const tr = trackRecordOffset(p, t);
      if (tv.steps.length !== STEP_COUNT || tv.sound.length !== SOUND_PARAMS.length) return protocolError(`pattern ${p} track ${t}: malformed view`);
      const checks = [
        byteArr(tv.sound), isInt(tv.plug, 0, 0xffffffff),
        ...[tv.stepCount, tv.stepLength, tv.quantize, tv.noteStyle, tv.noteLength].map((b) => isInt(b, 0, 255)),
      ];
      if (checks.includes(false)) return protocolError(`pattern ${p} track ${t}: value out of byte range`);
      writeU32le(out, tr + TRACK_REC.PLUG, tv.plug);
      out[tr + TRACK_REC.STEP_COUNT] = tv.stepCount;
      out[tr + TRACK_REC.STEP_LENGTH] = tv.stepLength;
      out[tr + TRACK_REC.QUANTIZE] = tv.quantize;
      out[tr + TRACK_REC.NOTE_STYLE] = tv.noteStyle;
      out[tr + TRACK_REC.NOTE_LENGTH] = tv.noteLength;
      out.set(tv.sound, soundOffset(p, t, 0));
      for (let s = 0; s < STEP_COUNT; s++) {
        const sv = tv.steps[s];
        if (sv.slots.length !== NOTES_PER_STEP[t]) return protocolError(`pattern ${p} track ${t} step ${s}: expected ${NOTES_PER_STEP[t]} note slots`);
        if (!byteArr(sv.componentValues, 16) || !byteArr(sv.lockValues, 18) || !byteArr(sv.lockEnabled, 18) || !isInt(sv.componentMask, 0, 0xffff)) {
          return protocolError(`pattern ${p} track ${t} step ${s}: malformed step record`);
        }
        for (let slot = 0; slot < sv.slots.length; slot++) {
          const o = noteRecordOffset(p, t, s, slot);
          const n = sv.slots[slot];
          if (n === null) {
            out[o + NOTE_REC.NOTE] = NOTE_UNUSED;
          } else {
            if (!isInt(n.note, 0, 254) || !isInt(n.velocity, 0, 255) || !isInt(n.microRaw, -128, 127) || !isInt(n.age, 0, 255) || !isInt(n.duration, -0x80000000, 0x7fffffff)) {
              return protocolError(`pattern ${p} track ${t} step ${s} slot ${slot}: note out of range`);
            }
            writeNote(out, o, n);
          }
        }
        const so = stepRecordOffset(p, t, s);
        writeU16le(out, so + STEP_REC.COMPONENT_MASK, sv.componentMask);
        out.set(sv.componentValues, so + STEP_REC.COMPONENT_VALUES);
        out.set(sv.lockValues, so + STEP_REC.LOCK_VALUES);
        out.set(sv.lockEnabled, so + STEP_REC.LOCK_ENABLED);
      }
    }
    if (!byteArr(pv.muteGroups) || !isInt(pv.activeMuteGroup, 0, 255) || !isInt(pv.tapeRouting, 0, 0xffff) || !isInt(pv.masterRouting, 0, 0xffff)) {
      return protocolError(`pattern ${p}: malformed mute/routing`);
    }
    out.set(pv.muteGroups, base + OFF.MUTE_GROUPS);
    out[base + OFF.ACTIVE_MUTE_GROUP] = pv.activeMuteGroup;
    writeU16le(out, base + OFF.TAPE_ROUTING, pv.tapeRouting);
    writeU16le(out, base + OFF.MASTER_ROUTING, pv.masterRouting);
  }
  return ok(out);
}

/**
 * Byte offsets of one pattern (relative to its base) that the typed view does
 * NOT cover and that must always come from a device baseline: the two unknown
 * track-record fields and the 3-byte tail. (Unused note slots also keep bytes
 * 0–3 and 5–7 from the baseline.)
 */
export function opaquePatternOffsets(): number[] {
  const out: number[] = [];
  for (let t = 0; t < TRACK_COUNT; t++) {
    const tr = OFF.TRACKS + t * OFF.TRACK_RECORD_SIZE;
    out.push(tr + TRACK_REC.UNKNOWN1, tr + TRACK_REC.UNKNOWN2, tr + TRACK_REC.UNKNOWN2 + 1);
  }
  out.push(OFF.TAIL, OFF.TAIL + 1, OFF.TAIL + 2);
  return out;
}

// ---------------------------------------------------------------------------

function readNote(bank: Uint8Array, o: number): NoteRecord {
  const micro = bank[o + NOTE_REC.MICRO];
  return {
    duration: i32le(bank, o + NOTE_REC.DURATION),
    note: bank[o + NOTE_REC.NOTE],
    velocity: bank[o + NOTE_REC.VELOCITY],
    microRaw: micro > 127 ? micro - 256 : micro,
    age: bank[o + NOTE_REC.AGE],
  };
}

function writeNote(out: Uint8Array, o: number, n: NoteRecord): void {
  writeU32le(out, o + NOTE_REC.DURATION, n.duration >>> 0);
  out[o + NOTE_REC.NOTE] = n.note;
  out[o + NOTE_REC.VELOCITY] = n.velocity;
  out[o + NOTE_REC.MICRO] = n.microRaw & 0xff;
  out[o + NOTE_REC.AGE] = n.age;
}

function validate(pattern: number, track: number, step?: number): R {
  if (!isInt(pattern, 0, 15) || !isInt(track, 0, 15) || (step !== undefined && !isInt(step, 0, 15))) {
    return protocolError('pattern, track, or step is outside 0..15');
  }
  return done;
}

function isInt(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

function byteArr(values: readonly number[], length?: number): boolean {
  return (length === undefined || values.length === length) && values.every((v) => isInt(v, 0, 255));
}
