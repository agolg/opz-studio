import { ok, protocolError, type ProtocolError, type Result } from '../lib/result';
import { MSG, STATE_SYNC_PROTOCOL_VERSION } from './constants';
import { encodeFrame, type Frame } from './frame';
import { compress } from './zlib';

/**
 * StateSync client hello / heartbeat: app session id (BE16) + protocol version.
 * opzsysex/sysex.py state_sync_client_hello. Note: libopz's fixed heartbeat
 * `F0 00 20 76 01 00 01 4E 2E 06 F7` is exactly clientHello(0xCE2E).
 */
export function clientHello(clientId: number, protocolVersion = STATE_SYNC_PROTOCOL_VERSION): Result<Uint8Array, ProtocolError> {
  if (!Number.isInteger(clientId) || clientId < 0 || clientId > 0xffff) return protocolError('client id must fit UInt16');
  return encodeFrame(MSG.CLIENT_HELLO, Uint8Array.of(clientId >> 8, clientId & 0xff, protocolVersion & 0xff));
}

export interface SessionAck {
  readonly deviceSessionId: number;
  readonly echoedClientId: number;
}

/** $01: OP-Z session id (BE16) + echoed app session id (BE16). docs/native-state-sync-analysis.md */
export function decodeSessionAck(frame: Frame): Result<SessionAck, ProtocolError> {
  if (frame.messageId !== MSG.SESSION_ACK || frame.payload.length < 4) return protocolError('not a $01 session acknowledgement');
  const p = frame.payload;
  return ok({ deviceSessionId: (p[0] << 8) | p[1], echoedClientId: (p[2] << 8) | p[3] });
}

/**
 * $07 active chain: 16 bytes of nibble-packed patterns (low nibble first), then
 * length, first pattern, multi-entry flag, project. opzsysex/sysex.py active_chain
 */
export function activeChainFrame(patterns: readonly number[], project: number): Result<Uint8Array, ProtocolError> {
  if (patterns.length < 1 || patterns.length > 31 || patterns.some((v) => !Number.isInteger(v) || v < 0 || v > 15)) {
    return protocolError('active chain needs 1..31 pattern indexes in 0..15');
  }
  if (!Number.isInteger(project) || project < 0 || project > 15) return protocolError('project must be in 0..15');
  const payload = new Uint8Array(20);
  patterns.forEach((pattern, index) => {
    payload[index >> 1] |= pattern << (index % 2 ? 4 : 0);
  });
  payload.set([patterns.length, patterns[0], patterns.length > 1 ? 1 : 0, project], 16);
  return encodeFrame(MSG.CHAIN_STATE, payload);
}

/** $0C upload: exactly 568 bytes, zlib-compressed. opzsysex/sysex.py global_upload_frame */
export function globalUploadFrame(globalState: Uint8Array): Result<Uint8Array, ProtocolError> {
  if (globalState.length !== 568) return protocolError('project-global state must be exactly 568 bytes');
  return encodeFrame(MSG.GLOBAL_DATA, compress(globalState));
}

/** $10 write: exactly 292 bytes, zlib-compressed. opzsysex/midi_config.py write_frame */
export function midiConfigWriteFrame(config: Uint8Array): Result<Uint8Array, ProtocolError> {
  if (config.length !== 292) return protocolError('MIDI configuration must be exactly 292 bytes');
  return encodeFrame(MSG.MIDI_CONFIG, compress(config));
}

export interface DeviceIdentity {
  /** Printable ASCII runs found in the identity reply (serial, firmware version…). */
  readonly strings: string[];
  readonly raw: Uint8Array;
}

/**
 * Universal identity reply (F0 7E xx 06 02 …). The field layout is not fully
 * documented (docs/sysex-app-protocol.md: "extended identity response containing
 * … ASCII serial/version fields"), so we only extract printable runs.
 */
export function decodeIdentityReply(data: Uint8Array): Result<DeviceIdentity, ProtocolError> {
  if (data.length < 6 || data[0] !== 0xf0 || data[1] !== 0x7e || data[3] !== 0x06 || data[4] !== 0x02) {
    return protocolError('not a universal identity reply');
  }
  const strings: string[] = [];
  let run = '';
  for (const b of data.subarray(5, data.length - 1)) {
    if (b >= 0x20 && b < 0x7f) run += String.fromCharCode(b);
    else {
      if (run.length >= 3) strings.push(run);
      run = '';
    }
  }
  if (run.length >= 3) strings.push(run);
  return ok({ strings, raw: data });
}
