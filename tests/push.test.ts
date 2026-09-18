import { afterEach, describe, expect, it } from 'vitest';
import { ok, unwrap } from '../src/lib/result';
import { pushToOpz, type Checkpoint } from '../src/device/pushToOpz';
import { OpzSession } from '../src/midi/session';
import { GLOBAL_SIZE, MIDI_CONFIG_SIZE } from '../src/project/layout';
import { FakeOpz, type FakeOpzOptions } from './fakeOpz';
import { blankBank, randomBytes, sha256 } from './helpers';

let session: OpzSession | null = null;
afterEach(() => session?.close());

async function rig(fault?: FakeOpzOptions['fault']) {
  const device = new FakeOpz({
    bank: blankBank(), global: randomBytes(GLOBAL_SIZE, 32), midiConfig: new Uint8Array(MIDI_CONFIG_SIZE),
    project: 3, sessionTimeoutMs: 120, fault,
  });
  session = new OpzSession(device, { timeoutMs: 400, settleMs: 15, heartbeatMs: 40, sessionExpireMs: 200 });
  unwrap(await session.connect());
  const checkpoints: Checkpoint[] = [];
  const options = {
    label: 'test',
    saveCheckpoint: async (cp: Checkpoint) => { checkpoints.push(cp); return ok(undefined); },
    confirm: async () => true,
  };
  return { device, session, checkpoints, options, original: { bank: device.bank.slice(), global: device.global.slice() } };
}

function edited(bank: Uint8Array): Uint8Array {
  const b = bank.slice();
  b[21_056] ^= 0x55; // un son
  b[7_232] ^= 0x01; // un composant
  return b;
}

describe('pushToOpz — transaction checkpoint / écriture / relecture / retour arrière', () => {
  it('écrit la banque, la relit et confirme', async () => {
    const { device, session, checkpoints, options, original } = await rig();
    const target = edited(original.bank);
    const r = unwrap(await pushToOpz(session, { bank: target, global: null }, options));
    expect(r).toMatchObject({ status: 'confirmed', project: 3, bankBytes: 2 });
    expect(sha256(device.bank)).toBe(sha256(target));
    expect(sha256(checkpoints[0].bank!)).toBe(sha256(original.bank));
  });

  it('écrit aussi le global (hors tampon de chaîne active) avec relecture en session neuve', async () => {
    const { device, session, options, original } = await rig();
    const g = original.global.slice();
    g[516] = 99; // tempo
    g[485] ^= 1; // tampon live : doit rester celui de l'appareil
    const r = unwrap(await pushToOpz(session, { bank: original.bank, global: g }, options));
    expect(r).toMatchObject({ status: 'confirmed', bankBytes: 0, globalBytes: 1 });
    expect(device.global[516]).toBe(99);
    expect(device.global[485]).toBe(original.global[485]);
  }, 10_000);

  it('rien à envoyer', async () => {
    const { session, options, original, device } = await rig();
    expect(unwrap(await pushToOpz(session, { bank: original.bank, global: null }, options)).status).toBe('unchanged');
    expect(device.writes).toBe(0);
  });

  it('relecture différente ⇒ retour arrière vérifié', async () => {
    const { device, session, options, original } = await rig('corrupt-write');
    const r = await pushToOpz(session, { bank: edited(original.bank), global: null }, options);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/relecture diffère.*remis dans son état d’avant/s);
    expect(sha256(device.bank)).toBe(sha256(original.bank));
  });

  it('rejet pendant l’upload ⇒ retour arrière', async () => {
    const { device, session, options, original } = await rig('reject-upload');
    const r = await pushToOpz(session, { bank: edited(original.bank), global: null }, options);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/interrompue/);
    // l'upload du checkpoint est aussi rejeté par ce faux appareil : le message doit le dire
    if (!r.ok) expect(r.error.message).toMatch(/RETOUR ARRIÈRE INCOMPLET|remis dans son état/);
    expect(sha256(device.bank)).toBe(sha256(original.bank)); // rien n'a été appliqué
  });

  it('checkpoint non enregistré ⇒ aucune écriture', async () => {
    const { device, session, options, original } = await rig();
    const r = await pushToOpz(session, { bank: edited(original.bank), global: null }, {
      ...options, saveCheckpoint: async () => ({ ok: false as const, error: new Error('disque plein') }),
    });
    expect(r.ok).toBe(false);
    expect(device.writes).toBe(0);
  });

  it('projet différent ou appareil modifié depuis l’import ⇒ demande de confirmation, refus = rien écrit', async () => {
    const { device, session, options, original } = await rig();
    const asked: string[] = [];
    const r = unwrap(await pushToOpz(session, { bank: edited(original.bank), global: null }, {
      ...options, expectedProject: 0, confirm: async (m) => { asked.push(m); return false; },
    }));
    expect(r.status).toBe('cancelled');
    expect(asked[0]).toMatch(/projet 4/);
    const baseline = original.bank.slice();
    baseline[5] ^= 1;
    const r2 = unwrap(await pushToOpz(session, { bank: edited(original.bank), global: null }, {
      ...options, baselineBank: baseline, confirm: async (m) => { asked.push(m); return false; },
    }));
    expect(r2.status).toBe('cancelled');
    expect(asked[1]).toMatch(/modifié depuis l’import \(1 octets/);
    expect(device.writes).toBe(0);
    // Petits écarts tolérés (réglages envoyés en direct) : pas de question.
    const before = asked.length;
    const r3 = unwrap(await pushToOpz(session, { bank: edited(original.bank), global: null }, {
      ...options, baselineBank: baseline, baselineTolerance: 10, confirm: async (m) => { asked.push(m); return false; },
    }));
    expect(asked.slice(before).some((m) => /modifié depuis/.test(m))).toBe(false);
    expect(r3.status).not.toBe('cancelled');
  });
});
