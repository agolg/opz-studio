import { concat, u16le, writeU16le } from '../lib/bytes';
import { ok, protocolError, type ProtocolError, type Result } from '../lib/result';
import { PATTERN_BANK_SIZE } from '../project/layout';
import { MSG, PATTERN_CHUNK_SIZE, PATTERN_REJECTION } from './constants';
import { encodeFrame, type Frame } from './frame';
import { compress, decompress } from './zlib';

/**
 * Pattern-bank transfer over $08/$09/$0A/$0B.
 * docs/sysex-app-protocol.md "Verified Full-Bank Write" and "Live project-prefix writes".
 *
 * Decoded $09/$0A payload: [address, 0, id_lo, id_hi, packet_lo, packet_hi, …zlib chunk]
 */
const PACKET_HEADER = 6;

export interface PacketIdentity {
  readonly address: number;
  readonly transferId: number;
  readonly packetIndex: number;
}

export function packetIdentity(frame: Frame): PacketIdentity | null {
  if ((frame.messageId !== MSG.PATTERN_PACKET && frame.messageId !== MSG.PATTERN_TERMINATOR) || frame.payload.length < PACKET_HEADER) return null;
  return { address: frame.payload[0], transferId: u16le(frame.payload, 2), packetIndex: u16le(frame.payload, 4) };
}

/**
 * Host → OP-Z upload frames. `prefix` may be the full 342,272-byte bank or a
 * contiguous prefix (Pattern 1..N). The low nibble of `address` does NOT select
 * the destination pattern. opzsysex/sysex.py pattern_upload_frames
 */
export function patternUploadFrames(prefix: Uint8Array, address: number, transferId: number): Result<Uint8Array[], ProtocolError> {
  if (prefix.length === 0 || prefix.length > PATTERN_BANK_SIZE) return protocolError(`pattern prefix must be 1..${PATTERN_BANK_SIZE} bytes`);
  if (address < 0 || address > 0xff || transferId < 0 || transferId > 0xffff) return protocolError('address must fit a byte and transfer id UInt16');
  const compressed = compress(prefix);
  const chunkCount = Math.ceil(compressed.length / PATTERN_CHUNK_SIZE);
  const frames: Uint8Array[] = [];
  for (let index = 0; index < chunkCount; index++) {
    const chunk = compressed.subarray(index * PATTERN_CHUNK_SIZE, (index + 1) * PATTERN_CHUNK_SIZE);
    const header = new Uint8Array(PACKET_HEADER);
    header[0] = address;
    writeU16le(header, 2, transferId);
    writeU16le(header, 4, index);
    const frame = encodeFrame(index === chunkCount - 1 ? MSG.PATTERN_TERMINATOR : MSG.PATTERN_PACKET, concat([header, chunk]));
    if (!frame.ok) return frame;
    frames.push(frame.value);
  }
  return ok(frames);
}

/** $0B ACK for one received $09 packet: 09 00 00 00, transfer id LE16, packet index LE16. */
export function patternAckFrame(transferId: number, packetIndex: number): Result<Uint8Array, ProtocolError> {
  const payload = Uint8Array.of(0x09, 0, 0, 0, 0, 0, 0, 0);
  writeU16le(payload, 4, transferId);
  writeU16le(payload, 6, packetIndex);
  return encodeFrame(MSG.PATTERN_ACK, payload);
}

export function isPatternRejection(frame: Frame): boolean {
  return frame.messageId === MSG.PATTERN_QUERY && frame.payload.length === 4 && frame.payload.every((b, i) => b === PATTERN_REJECTION[i]);
}

export interface ReceivedBank {
  readonly address: number;
  readonly transferId: number;
  readonly packetCount: number;
  readonly bank: Uint8Array;
}

export type AssemblerStep =
  | { readonly kind: 'packet'; readonly identity: PacketIdentity; readonly ack: Uint8Array | null }
  | { readonly kind: 'complete'; readonly received: ReceivedBank };

/**
 * OP-Z → host bank download state machine. Strict: packets must start at 0,
 * keep one transfer id and arrive in order. Anything else fails closed.
 * libopz src/opz_device.cpp cases 0x09 / 0x0a (reassembly + $0B confirmation).
 */
export class PatternBankAssembler {
  private chunks: Uint8Array[] = [];
  private identity: { address: number; transferId: number } | null = null;
  private nextIndex = 0;

  get inProgress(): boolean {
    return this.identity !== null;
  }

  reset(): void {
    this.chunks = [];
    this.identity = null;
    this.nextIndex = 0;
  }

  accept(frame: Frame): Result<AssemblerStep, ProtocolError> {
    const id = packetIdentity(frame);
    if (id === null) return this.fail('not a pattern packet');
    if (this.identity === null) {
      if (id.packetIndex !== 0) return this.fail(`bank download must start at packet 0, got ${id.packetIndex}`);
      this.identity = { address: id.address, transferId: id.transferId };
    } else if (id.transferId !== this.identity.transferId) {
      return this.fail(`transfer id changed mid-download (${this.identity.transferId} → ${id.transferId})`);
    }
    if (id.packetIndex !== this.nextIndex) return this.fail(`out-of-order packet ${id.packetIndex}, expected ${this.nextIndex}`);
    this.chunks.push(frame.payload.subarray(PACKET_HEADER));
    this.nextIndex++;

    if (frame.messageId === MSG.PATTERN_PACKET) {
      const ack = patternAckFrame(id.transferId, id.packetIndex);
      if (!ack.ok) return this.fail(ack.error.message);
      return ok({ kind: 'packet', identity: id, ack: ack.value });
    }

    const inflated = decompress(concat(this.chunks), PATTERN_BANK_SIZE);
    if (!inflated.ok) return this.fail(inflated.error.message);
    if (inflated.value.length !== PATTERN_BANK_SIZE) {
      return this.fail(`unexpected bank size ${inflated.value.length}, expected ${PATTERN_BANK_SIZE}`);
    }
    const received: ReceivedBank = { ...this.identity, packetCount: this.nextIndex, bank: inflated.value };
    this.reset();
    return ok({ kind: 'complete', received });
  }

  private fail(message: string): Result<never, ProtocolError> {
    this.reset();
    return protocolError(message);
  }
}
