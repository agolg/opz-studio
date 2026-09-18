import { deflate, inflate } from 'pako';
import { ok, protocolError, type ProtocolError, type Result } from '../lib/result';

/**
 * zlib (RFC 1950) streams, as used by $09/$0A/$0C/$10/$53 payloads.
 *
 * pako is used instead of CompressionStream/DecompressionStream because:
 *  - it is synchronous (simpler state machines, deterministic tests);
 *  - its deflate output at the default level is byte-identical to CPython's
 *    zlib.compress, which the fixtures assert (tests/zlib.test.ts).
 * Port of opzsysex/sysex.py compress / decompress.
 */
export function compress(data: Uint8Array): Uint8Array {
  return deflate(data);
}

export function decompress(data: Uint8Array, maxSize?: number): Result<Uint8Array, ProtocolError> {
  let out: Uint8Array;
  try {
    out = inflate(data);
  } catch (e) {
    return protocolError(`invalid zlib stream: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (maxSize !== undefined && out.length > maxSize) return protocolError(`inflated payload exceeds ${maxSize} bytes`);
  return ok(out);
}
