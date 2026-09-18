import { describe, expect, it } from 'vitest';
import { toHex } from '../src/lib/bytes';
import { unwrap } from '../src/lib/result';
import { IDENTITY_INQUIRY, TE_HEADER } from '../src/midi/constants';
import { decodeFrame, encodeFrame } from '../src/midi/frame';
import { activeChainFrame, clientHello } from '../src/midi/messages';
import { pack7, unpack7 } from '../src/midi/pack7';
import { MidiStreamParser } from '../src/midi/streamParser';
import { compress, decompress } from '../src/midi/zlib';
import { fixture, hex, randomBytes } from './helpers';

interface SysexFixture {
  constants: Record<string, string>;
  pack7: { input: string; packed: string }[];
  zlib: { input: string; compressed: string }[];
  frames: { id: number; payload: string; frame: string }[];
  client_hello: { client_id: number; frame: string }[];
  active_chain: { patterns: number[]; project: number; frame: string }[];
  stream_parser: { input: string; events: [string, number | string][] };
}
const fx = fixture<SysexFixture>('sysex');

describe('constants (vs Python reference)', () => {
  it('TE header and identity inquiry', () => {
    expect(toHex(TE_HEADER)).toBe(fx.constants.te_header);
    expect(toHex(IDENTITY_INQUIRY)).toBe(fx.constants.identity_inquiry);
  });
  it('queries', () => {
    expect(toHex(unwrap(encodeFrame(0x08)))).toBe(fx.constants.pattern_query);
    expect(toHex(unwrap(encodeFrame(0x0f)))).toBe(fx.constants.midi_configuration_query);
  });
  it("libopz's fixed heartbeat is clientHello(0xCE2E)", () => {
    expect(toHex(unwrap(clientHello(0xce2e)))).toBe(fx.constants.heartbeat_4e2e);
  });
});

describe('pack7', () => {
  it.each(fx.pack7.map((c) => [c.input.length / 2, c] as const))('%i bytes: byte-exact with Python', (_n, c) => {
    const packed = pack7(hex(c.input));
    expect(toHex(packed)).toBe(c.packed);
    expect(toHex(unwrap(unpack7(packed)))).toBe(c.input);
  });
  it('round-trips random data and keeps every byte 7-bit', () => {
    const data = randomBytes(4096);
    const packed = pack7(data);
    expect(packed.every((b) => b < 0x80)).toBe(true);
    expect(unwrap(unpack7(packed))).toEqual(data);
  });
  it('fails closed on 8-bit input', () => {
    expect(unpack7(Uint8Array.of(0x00, 0x80)).ok).toBe(false);
  });
});

describe('zlib', () => {
  it.each(fx.zlib.map((c) => [c.input.length / 2, c] as const))('%i bytes: interoperates with CPython zlib both ways', (_n, c) => {
    // Python-compressed → pako inflate
    expect(toHex(unwrap(decompress(hex(c.compressed))))).toBe(c.input);
    // pako-compressed → round trip (compressed bytes may legitimately differ from CPython's)
    expect(toHex(unwrap(decompress(compress(hex(c.input)))))).toBe(c.input);
    expect(toHex(compress(hex(c.input))).slice(0, 4)).toBe('789c'); // zlib header, default level
  });
  it('enforces max size and rejects garbage', () => {
    expect(decompress(compress(new Uint8Array(1000)), 999).ok).toBe(false);
    expect(decompress(Uint8Array.of(1, 2, 3)).ok).toBe(false);
  });
});

describe('frames', () => {
  it.each(fx.frames.map((c) => [c.id, c] as const))('message $%s', (_id, c) => {
    const frame = unwrap(encodeFrame(c.id, hex(c.payload)));
    expect(toHex(frame)).toBe(c.frame);
    const decoded = unwrap(decodeFrame(frame));
    expect(decoded.messageId).toBe(c.id);
    expect(toHex(decoded.payload)).toBe(c.payload);
  });
  it('rejects bad ids and malformed frames', () => {
    expect(encodeFrame(0x80).ok).toBe(false);
    expect(decodeFrame(Uint8Array.of(0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7)).ok).toBe(false);
    expect(decodeFrame(Uint8Array.of(0xf0, 0x00, 0x20, 0x76, 0x01, 0x07, 0x00)).ok).toBe(false);
  });
  it.each(fx.client_hello.map((c) => [c.client_id, c] as const))('client hello %i', (_id, c) => {
    expect(toHex(unwrap(clientHello(c.client_id)))).toBe(c.frame);
  });
  it.each(fx.active_chain.map((c, i) => [i, c] as const))('active chain #%i', (_i, c) => {
    expect(toHex(unwrap(activeChainFrame(c.patterns, c.project)))).toBe(c.frame);
  });
  it('active chain validation', () => {
    expect(activeChainFrame([], 0).ok).toBe(false);
    expect(activeChainFrame(new Array(32).fill(0), 0).ok).toBe(false);
    expect(activeChainFrame([16], 0).ok).toBe(false);
    expect(activeChainFrame([1], 16).ok).toBe(false);
  });
});

describe('MIDI stream parser', () => {
  it('matches the Python parser event-for-event (realtime inside SysEx)', () => {
    const events = new MidiStreamParser().feed(hex(fx.stream_parser.input));
    const normalised = events.map((e) => (e.kind === 'realtime' ? ['realtime', e.byte] : ['sysex', toHex(e.data)]));
    expect(normalised).toEqual(fx.stream_parser.events);
  });
});
