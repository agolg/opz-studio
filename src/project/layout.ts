/**
 * OP-Z project memory layout (firmware 1.2.45+).
 * Source: kmorrill/op-z-sysex docs/typed-pattern-editing.md "Pattern Layout",
 * opzsysex/project.py, and patriciogonzalezvivo/libopz include/libopz/opz_project.h.
 * All multibyte values are little-endian.
 */

export const PATTERN_COUNT = 16;
export const TRACK_COUNT = 16;
export const STEP_COUNT = 16;

/** One pattern = 21,392 bytes. The $09 bank holds all 16 patterns of the active project. */
export const PATTERN_SIZE = 21_392;
export const PATTERN_BANK_SIZE = PATTERN_SIZE * PATTERN_COUNT; // 342,272

/** Offsets inside one pattern. docs/typed-pattern-editing.md table */
export const OFF = {
  /** 16 track records × 12 bytes: plug u32, step_count, ?, step_length, quantize, note_style, note_length, ?, ? (libopz opz_track_parameter) */
  TRACKS: 0,
  TRACK_RECORD_SIZE: 12,
  /** 880 note records × 8 bytes, interleaved by step: 55 slots per step. */
  NOTES: 192,
  NOTE_RECORD_SIZE: 8,
  NOTE_SLOTS_PER_STEP: 55,
  /** 256 step records × 54 bytes, track-major: (track * 16 + step) * 54. */
  STEPS: 7_232,
  STEP_RECORD_SIZE: 54,
  /** 18 sound bytes × 16 tracks. */
  SOUND: 21_056,
  /** 10 mute groups × 4 bytes; 2 bits per track, bit (track%4)*2+1 = muted. */
  MUTE_GROUPS: 21_344,
  MUTE_GROUP_COUNT: 10,
  TAPE_ROUTING: 21_384,
  MASTER_ROUTING: 21_386,
  ACTIVE_MUTE_GROUP: 21_388,
  /** 3 unresolved bytes — preserve. */
  TAIL: 21_389,
} as const;

/** Inside a 12-byte track record. libopz opz_track_parameter */
export const TRACK_REC = {
  PLUG: 0,
  STEP_COUNT: 4,
  UNKNOWN1: 5,
  STEP_LENGTH: 6,
  QUANTIZE: 7,
  NOTE_STYLE: 8,
  NOTE_LENGTH: 9,
  UNKNOWN2: 10, // 2 bytes
} as const;

/** Inside a 54-byte step record. docs/typed-pattern-editing.md "Parameter Locks" */
export const STEP_REC = {
  COMPONENT_MASK: 0, // u16
  COMPONENT_VALUES: 2, // 16 bytes
  LOCK_VALUES: 18, // 18 bytes
  LOCK_ENABLED: 36, // 18 bytes, FF = locked
} as const;

/** Inside an 8-byte note record. docs/typed-pattern-editing.md "Notes and Chords" */
export const NOTE_REC = {
  DURATION: 0, // i32, 6,200 units per step
  NOTE: 4, // FF = unused slot
  VELOCITY: 5,
  MICRO: 6, // i8, raw = displayed ticks × 8, −96…+88
  AGE: 7,
} as const;

export const NOTE_UNUSED = 0xff;
export const LOCK_ENABLED = 0xff;
export const DURATION_UNITS_PER_STEP = 6_200;
export const MICRO_RAW_PER_TICK = 8;
export const MICRO_TICKS_MIN = -12;
export const MICRO_TICKS_MAX = 11;

export const TRACK_NAMES = [
  'kick', 'snare', 'perc', 'sample', 'bass', 'lead', 'arp', 'chord',
  'fx1', 'fx2', 'tape', 'master', 'perform', 'module', 'lights', 'motion',
] as const;
export type TrackName = (typeof TRACK_NAMES)[number];

/** Note slots per step for each track, and their offset inside the 55-slot step. */
export const NOTES_PER_STEP = [2, 2, 2, 2, 4, 4, 8, 4, 1, 1, 1, 4, 6, 6, 4, 4] as const;
export const NOTE_SLOT_OFFSETS = [0, 2, 4, 6, 8, 12, 16, 24, 28, 29, 30, 31, 35, 41, 47, 51] as const;

/** The 18 sound parameters, in storage / lock order. docs/typed-pattern-editing.md */
export const SOUND_PARAMS = [
  'param1', 'param2', 'attack', 'decay', 'sustain', 'release', 'fx1', 'fx2', 'filter',
  'resonance', 'pan', 'level', 'portamento', 'lfo_depth', 'lfo_speed', 'lfo_value', 'lfo_shape', 'note_style',
] as const;
export type SoundParam = (typeof SOUND_PARAMS)[number];

/** Project-global block ($0C). docs/project-global-format.md */
export const GLOBAL_SIZE = 568;
export const GLOBAL = {
  CHAINS: 0, // 15 saved chains × 32 bytes, FF-terminated
  CHAIN_RECORD_SIZE: 32,
  SAVED_CHAIN_COUNT: 15,
  ACTIVE_CHAIN: 480, // live buffer, 32 bytes
  DRUM_LEVEL: 512,
  SYNTH_LEVEL: 513,
  PUNCH_LEVEL: 514,
  MASTER_LEVEL: 515,
  TEMPO: 516, // u16 BPM, 40..200
  OPAQUE_A: 518, // 43 bytes — preserve
  SWING: 561,
  METRONOME_LEVEL: 562,
  METRONOME_SOUND: 563,
  SELECTED_CHAIN: 564, // signed, FF = none
  OPAQUE_B: 565, // 3 bytes — preserve
} as const;
export const MAX_CHAIN_LENGTH = 31;

export const MIDI_CONFIG_SIZE = 292;

export const patternBase = (pattern: number): number => pattern * PATTERN_SIZE;
export const trackRecordOffset = (pattern: number, track: number): number => patternBase(pattern) + OFF.TRACKS + track * OFF.TRACK_RECORD_SIZE;
export const stepRecordOffset = (pattern: number, track: number, step: number): number =>
  patternBase(pattern) + OFF.STEPS + (track * STEP_COUNT + step) * OFF.STEP_RECORD_SIZE;
export const noteRecordOffset = (pattern: number, track: number, step: number, slot: number): number =>
  patternBase(pattern) + OFF.NOTES + (step * OFF.NOTE_SLOTS_PER_STEP + NOTE_SLOT_OFFSETS[track] + slot) * OFF.NOTE_RECORD_SIZE;
export const soundOffset = (pattern: number, track: number, param: number): number =>
  patternBase(pattern) + OFF.SOUND + track * SOUND_PARAMS.length + param;
