import { afterEach, describe, expect, it } from 'vitest';
import { unwrap } from '../src/lib/result';
import { OpzSession } from '../src/midi/session';
import { GLOBAL_SIZE, MIDI_CONFIG_SIZE, PATTERN_BANK_SIZE } from '../src/project/layout';
import { decodeGlobal } from '../src/project/global';
import { FakeOpz, type FakeOpzOptions } from './fakeOpz';
import { randomBytes, sha256 } from './helpers';

const bank = randomBytes(PATTERN_BANK_SIZE, 3);
const global = randomBytes(GLOBAL_SIZE, 4);
global[516] = 124; global[517] = 0;
const midiConfig = new Uint8Array(MIDI_CONFIG_SIZE);

let session: OpzSession | null = null;
afterEach(() => session?.close());

function open(fault?: FakeOpzOptions['fault']) {
  const device = new FakeOpz({ bank, global, midiConfig, fault });
  session = new OpzSession(device, { timeoutMs: 300, settleMs: 20, heartbeatMs: 50, clientId: 0x1234 });
  return { device, session };
}

describe('OpzSession (against a simulated OP-Z)', () => {
  it('handshake: identity + $01 echoing our client id', async () => {
    const { session } = open();
    const ack = unwrap(await session.connect());
    expect(ack).toEqual({ deviceSessionId: 0x95f5, echoedClientId: 0x1234 });
    expect(session.identity?.strings).toContain('1.2.45');
  });

  it('reads the pattern bank with one $0B ACK per $09 and rebuilds it byte-exact', async () => {
    const { device, session } = open();
    unwrap(await session.connect());
    const received = unwrap(await session.readPatternBank());
    expect(sha256(received.bank)).toBe(sha256(bank));
    expect(received.transferId).toBe(0x0777);
    expect(device.acks).toEqual([...Array(received.packetCount - 1).keys()]);
  });

  it('serialises concurrent operations (never two exchanges at once)', async () => {
    const { session } = open();
    unwrap(await session.connect());
    const [a, b, c] = await Promise.all([session.readPatternBank(), session.readMidiConfig(), session.readPatternBank()]);
    expect(a.ok && b.ok && c.ok).toBe(true);
  });

  it('reads MIDI config and a fresh global snapshot', async () => {
    const { session } = open();
    unwrap(await session.connect());
    expect(unwrap(await session.readMidiConfig()).length).toBe(MIDI_CONFIG_SIZE);
    const g = unwrap(await session.readGlobal());
    expect(sha256(g)).toBe(sha256(global));
    expect(unwrap(decodeGlobal(g)).tempo).toBe(124);
  });

  it('fails closed on $08 rejection', async () => {
    const { session } = open('reject');
    unwrap(await session.connect());
    const r = await session.readPatternBank();
    expect(r.ok).toBe(false);
  });

  it('fails closed on a skipped packet', async () => {
    const { session } = open('skip-packet');
    unwrap(await session.connect());
    const r = await session.readPatternBank();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/out-of-order/);
  });

  it('fails closed on a malformed frame', async () => {
    const { session } = open('malformed');
    unwrap(await session.connect());
    expect((await session.readMidiConfig()).ok).toBe(false);
  });

  it('times out cleanly when the device is silent', async () => {
    const { session } = open('silent');
    expect((await session.connect()).ok).toBe(false);
  });
});
