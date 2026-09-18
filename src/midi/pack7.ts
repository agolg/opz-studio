import { protocolError, ok, type Result, type ProtocolError } from '../lib/result';

/**
 * TE 7-bit packing: each group of up to 7 data bytes is preceded by one byte
 * holding their high bits (bit N = high bit of byte N).
 * Port of opzsysex/sysex.py pack7 / unpack7 (docs/sysex-app-protocol.md "7-Bit Packing").
 */
export function pack7(source: Uint8Array): Uint8Array {
  const out = new Uint8Array(source.length + Math.ceil(source.length / 7));
  let o = 0;
  for (let start = 0; start < source.length; start += 7) {
    const end = Math.min(start + 7, source.length);
    let mask = 0;
    for (let i = start; i < end; i++) mask |= ((source[i] >> 7) & 1) << (i - start);
    out[o++] = mask;
    for (let i = start; i < end; i++) out[o++] = source[i] & 0x7f;
  }
  return out;
}

export function unpack7(source: Uint8Array): Result<Uint8Array, ProtocolError> {
  for (const byte of source) if (byte > 0x7f) return protocolError('packed SysEx data contains an 8-bit byte');
  const out: number[] = [];
  for (let start = 0; start < source.length; start += 8) {
    const mask = source[start];
    const end = Math.min(start + 8, source.length);
    for (let i = start + 1; i < end; i++) out.push(source[i] | (((mask >> (i - start - 1)) & 1) << 7));
  }
  return ok(Uint8Array.from(out));
}
