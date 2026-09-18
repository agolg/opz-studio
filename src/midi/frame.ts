import { bytesEqual, concat } from '../lib/bytes';
import { ok, protocolError, type ProtocolError, type Result } from '../lib/result';
import { SYSEX_END, TE_HEADER } from './constants';
import { pack7, unpack7 } from './pack7';

export interface Frame {
  readonly messageId: number;
  /** Unpacked (8-bit) payload. */
  readonly payload: Uint8Array;
}

/** F0 00 20 76 01 <id> <pack7(payload)> F7 — opzsysex/sysex.py frame */
export function encodeFrame(messageId: number, payload: Uint8Array = new Uint8Array()): Result<Uint8Array, ProtocolError> {
  if (!Number.isInteger(messageId) || messageId < 0 || messageId > 0x7f) return protocolError('message id must be a 7-bit MIDI data byte');
  return ok(concat([TE_HEADER, Uint8Array.of(messageId), pack7(payload), Uint8Array.of(SYSEX_END)]));
}

/** opzsysex/sysex.py decode_frame — fails closed on anything that is not a TE frame. */
export function decodeFrame(data: Uint8Array): Result<Frame, ProtocolError> {
  if (data.length < 7 || !bytesEqual(data.subarray(0, TE_HEADER.length), TE_HEADER) || data[data.length - 1] !== SYSEX_END) {
    return protocolError('invalid OP-Z SysEx frame');
  }
  const payload = unpack7(data.subarray(6, data.length - 1));
  if (!payload.ok) return payload;
  return ok({ messageId: data[5], payload: payload.value });
}

export function isTeFrame(data: Uint8Array): boolean {
  return data.length >= 7 && bytesEqual(data.subarray(0, TE_HEADER.length), TE_HEADER) && data[data.length - 1] === SYSEX_END;
}
