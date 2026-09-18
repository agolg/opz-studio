import { u16le, writeU16le } from '../lib/bytes';
import { ok, protocolError, type ProtocolError, type Result } from '../lib/result';
import { GLOBAL, GLOBAL_SIZE, MAX_CHAIN_LENGTH } from './layout';

/** Decoded view of the 568-byte $0C block. opzsysex/project.py decode_global */
export interface GlobalSummary {
  drumLevel: number;
  synthLevel: number;
  punchLevel: number;
  masterLevel: number;
  tempo: number;
  swing: number;
  metronomeLevel: number;
  metronomeSound: number;
  /** 15 saved chains (pattern indexes 0..15), FF-terminated on device. */
  chains: number[][];
  activeChain: number[];
  /** Signed zero-based selected saved-chain slot; 0xFF = none. */
  selectedChainRaw: number;
}

function readChain(data: Uint8Array, offset: number): number[] {
  const record = data.subarray(offset, offset + GLOBAL.CHAIN_RECORD_SIZE);
  const end = record.indexOf(0xff);
  return Array.from(end === -1 ? record : record.subarray(0, end));
}

export function decodeGlobal(data: Uint8Array): Result<GlobalSummary, ProtocolError> {
  if (data.length !== GLOBAL_SIZE) return protocolError(`project-global block must be ${GLOBAL_SIZE} bytes`);
  const chains: number[][] = [];
  for (let i = 0; i < GLOBAL.SAVED_CHAIN_COUNT; i++) chains.push(readChain(data, i * GLOBAL.CHAIN_RECORD_SIZE));
  return ok({
    drumLevel: data[GLOBAL.DRUM_LEVEL],
    synthLevel: data[GLOBAL.SYNTH_LEVEL],
    punchLevel: data[GLOBAL.PUNCH_LEVEL],
    masterLevel: data[GLOBAL.MASTER_LEVEL],
    tempo: u16le(data, GLOBAL.TEMPO),
    swing: data[GLOBAL.SWING],
    metronomeLevel: data[GLOBAL.METRONOME_LEVEL],
    metronomeSound: data[GLOBAL.METRONOME_SOUND],
    chains,
    activeChain: readChain(data, GLOBAL.ACTIVE_CHAIN),
    selectedChainRaw: data[GLOBAL.SELECTED_CHAIN],
  });
}

export type LevelGroup = 'drum' | 'synth' | 'punch' | 'master';
const LEVEL_OFFSETS: Record<LevelGroup, number> = {
  drum: GLOBAL.DRUM_LEVEL,
  synth: GLOBAL.SYNTH_LEVEL,
  punch: GLOBAL.PUNCH_LEVEL,
  master: GLOBAL.MASTER_LEVEL,
};

/** Edits only mapped offsets; the 46 opaque bytes are always preserved. opzsysex/project.py GlobalEditor */
export class GlobalEditor {
  private readonly data: Uint8Array;

  private constructor(data: Uint8Array) {
    this.data = data;
  }

  static from(data: Uint8Array): Result<GlobalEditor, ProtocolError> {
    if (data.length !== GLOBAL_SIZE) return protocolError(`project-global block must be ${GLOBAL_SIZE} bytes`);
    return ok(new GlobalEditor(data.slice()));
  }

  bytes(): Uint8Array {
    return this.data.slice();
  }

  setTempo(tempo: number): Result<void, ProtocolError> {
    if (!Number.isInteger(tempo) || tempo < 40 || tempo > 200) return protocolError('tempo must be 40..200 BPM');
    writeU16le(this.data, GLOBAL.TEMPO, tempo);
    return ok(undefined);
  }

  setLevel(group: LevelGroup, value: number): Result<void, ProtocolError> {
    if (!(group in LEVEL_OFFSETS) || !Number.isInteger(value) || value < 0 || value > 255) {
      return protocolError('level group must be drum/synth/punch/master and value 0..255');
    }
    this.data[LEVEL_OFFSETS[group]] = value;
    return ok(undefined);
  }

  setChain(slot: number, patterns: readonly number[]): Result<void, ProtocolError> {
    if (!Number.isInteger(slot) || slot < 0 || slot >= GLOBAL.SAVED_CHAIN_COUNT || patterns.length > MAX_CHAIN_LENGTH || patterns.some((v) => !Number.isInteger(v) || v < 0 || v > 15)) {
      return protocolError('saved chain needs slot 0..14 and up to 31 patterns in 0..15');
    }
    const offset = slot * GLOBAL.CHAIN_RECORD_SIZE;
    this.data.fill(0xff, offset, offset + GLOBAL.CHAIN_RECORD_SIZE);
    this.data.set(patterns, offset);
    return ok(undefined);
  }
}
