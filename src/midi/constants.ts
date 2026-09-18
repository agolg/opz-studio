/**
 * OP-Z SysEx protocol constants.
 * Every value cites its source. "op-z-sysex" = github.com/kmorrill/op-z-sysex.
 */

/** F0 + Teenage Engineering manufacturer ID 00 20 76 + protocol version 01. op-z-sysex opzsysex/sysex.py TE_HEADER */
export const TE_HEADER = Uint8Array.of(0xf0, 0x00, 0x20, 0x76, 0x01);
export const SYSEX_START = 0xf0;
export const SYSEX_END = 0xf7;

/** Universal device inquiry. op-z-sysex docs/sysex-app-protocol.md "Live Handshake Capture" */
export const IDENTITY_INQUIRY = Uint8Array.of(0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7);

/** StateSync protocol version sent in the client hello. op-z-sysex docs/native-state-sync-analysis.md "Session Ownership" */
export const STATE_SYNC_PROTOCOL_VERSION = 6;

/** Message IDs. op-z-sysex docs/sysex-app-protocol.md "Message Map" */
export const MSG = {
  /** App → OP-Z client hello / heartbeat, ~1 per second. */
  CLIENT_HELLO: 0x00,
  /** OP-Z → app session acknowledgement: OP-Z session id (BE16) + echoed app session id (BE16). */
  SESSION_ACK: 0x01,
  /** OP-Z → app ordered pattern delta (telemetry only; host writes are ignored). */
  PATTERN_DELTA: 0x02,
  KEYBOARD_SETTING: 0x03,
  INPUT_LEVEL_STATE: 0x04,
  UI_STATE: 0x06,
  /** Pattern-chain / live sequencer state, 20 bytes. docs/live-position-and-chain-state.md */
  CHAIN_STATE: 0x07,
  /** Empty = pattern query; inbound FF FF FF FF = upload rejection. */
  PATTERN_QUERY: 0x08,
  PATTERN_PACKET: 0x09,
  PATTERN_TERMINATOR: 0x0a,
  /** Pattern packet ACK: 09 00 00 00, transfer id LE16, packet index LE16. */
  PATTERN_ACK: 0x0b,
  /** Project-global block, zlib → 568 bytes. docs/project-global-format.md */
  GLOBAL_DATA: 0x0c,
  SOUND_STATE: 0x0e,
  MIDI_CONFIG_QUERY: 0x0f,
  /** zlib → 292 bytes. docs/midi-configuration-sysex.md */
  MIDI_CONFIG: 0x10,
  SERIAL_VERSION: 0x11,
  MIXER_STATE: 0x12,
  PATTERN_STATE: 0x13,
  MODULE_INFO: 0x14,
  FILE_CLIENT_STATUS: 0x33,
  FILE_CLIENT_HELLO: 0x34,
  FILE_REQUEST: 0x35,
  FILE_SERVER_ADVERTISE: 0x51,
  FILE_SERVER_HEARTBEAT: 0x52,
  FILE_DATA: 0x53,
  FILE_SERVER_CLOSE: 0x55,
} as const;

/** Decoded payload of a $08 upload rejection. docs/sysex-app-protocol.md "$0B" row */
export const PATTERN_REJECTION = Uint8Array.of(0xff, 0xff, 0xff, 0xff);

/** Compressed pattern-bank chunk size per $09/$0A packet. opzsysex/sysex.py pattern_upload_frames (178) */
export const PATTERN_CHUNK_SIZE = 178;

/** Heartbeat period expected by the OP-Z. docs/sysex-app-protocol.md "$00 … roughly once per second" */
export const HEARTBEAT_INTERVAL_MS = 1000;
