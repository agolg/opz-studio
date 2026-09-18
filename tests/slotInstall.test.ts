import { afterEach, describe, expect, it } from 'vitest';
import { ok, unwrap } from '../src/lib/result';
import type { Checkpoint } from '../src/device/pushToOpz';
import { editSlotMap, installInSlot } from '../src/device/slotInstall';
import { FILE_ID, UploadServer } from '../src/midi/fileServer';
import { fileId } from '../src/midi/fileId';
import { OpzSession } from '../src/midi/session';
import { MIDI_CONFIG_SIZE } from '../src/project/layout';
import { FakeOpz, type FakeOpzOptions } from './fakeOpz';
import { blankBank, randomBytes } from './helpers';

const slots = { tracks: [{ index: 0, packs: [{ id: 1, slot: 1 }, { id: 5, slot: 2 }] }, { index: 4, packs: [{ id: 65, slot: 1 }] }] };
const text = (o: unknown) => JSON.stringify(o, null, 2);
const enc = (s: string) => new TextEncoder().encode(s);

describe('editSlotMap (même règle que opz-slot-map-edit.py)', () => {
  it('remplace un emplacement occupé, ajoute un emplacement vide, trie', () => {
    const a = unwrap(editSlotMap(text(slots), 0, 2, 7));
    expect(a.previous).toBe(5);
    expect(JSON.parse(a.text).tracks[0].packs).toEqual([{ id: 1, slot: 1 }, { id: 7, slot: 2 }]);
    const b = unwrap(editSlotMap(text(slots), 4, 3, 66));
    expect(b.previous).toBeNull();
    expect(JSON.parse(b.text).tracks[1].packs).toEqual([{ id: 65, slot: 1 }, { id: 66, slot: 3 }]);
  });
  it('refuse les entrées invalides', () => {
    expect(editSlotMap(text(slots), 9, 1, 1).ok).toBe(false);
    expect(editSlotMap(text(slots), 0, 11, 1).ok).toBe(false);
    expect(editSlotMap('pas du json', 0, 1, 1).ok).toBe(false);
  });
});

describe('UploadServer', () => {
  it('manifeste identique à opzsysex (clés triées, JSON compact)', () => {
    const server = new UploadServer([{ path: 'settings/slotConfiguration.json', data: enc('abc') }]);
    expect(new TextDecoder().decode(server.syncJob)).toBe(`{"files":[{"crc":891568578,"fileId":${fileId('settings/slotConfiguration.json')},"path":"settings/slotConfiguration.json","size":3}]}`);
  });
});

describe('installInSlot — sauvegarde, envoi, relecture, retour arrière', () => {
  let session: OpzSession | null = null;
  afterEach(() => session?.close());

  async function rig(fault?: FakeOpzOptions['fault']) {
    const files = new Map([[FILE_ID.SLOT_CONFIGURATION, enc(text(slots))], [FILE_ID.PLUGS, enc('{"plugs":[]}')]]);
    const device = new FakeOpz({ bank: blankBank(), global: randomBytes(568, 1), midiConfig: new Uint8Array(MIDI_CONFIG_SIZE), files, fault });
    session = new OpzSession(device, { timeoutMs: 400, settleMs: 15, heartbeatMs: 40 });
    unwrap(await session.connect());
    const saved: Checkpoint[] = [];
    return { device, files, saved, options: { saveCheckpoint: async (cp: Checkpoint) => { saved.push(cp); return ok(undefined); } } };
  }

  it('installe et vérifie', async () => {
    const { files, saved, options } = await rig();
    const r = unwrap(await installInSlot(session!, { track: 0, slot: 2, plugId: 42, label: 't' }, options));
    expect(r.status).toBe('confirmed');
    expect(r.previous).toBe(5);
    expect(JSON.parse(new TextDecoder().decode(files.get(0))).tracks[0].packs[1]).toEqual({ id: 42, slot: 2 });
    expect(new TextDecoder().decode(saved[0].slotConfiguration!)).toBe(text(slots));
    expect((await session!.readPatternBank()).ok).toBe(true); // StateSync repris
  }, 10_000);

  it('relecture différente ⇒ remise de l’original vérifiée', async () => {
    const { files, options } = await rig('corrupt-file');
    const r = await installInSlot(session!, { track: 0, slot: 2, plugId: 42, label: 't' }, options);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/remis \(vérifié/);
    expect(new TextDecoder().decode(files.get(0))).toBe(text(slots));
  }, 10_000);

  it('l’OP-Z ne demande pas le fichier ⇒ échec propre, original intact', async () => {
    const { files, options } = await rig('stall-file');
    const r = await installInSlot(session!, { track: 0, slot: 2, plugId: 42, label: 't' }, options);
    expect(r.ok).toBe(false);
    expect(new TextDecoder().decode(files.get(0))).toBe(text(slots));
  }, 30_000);
});
