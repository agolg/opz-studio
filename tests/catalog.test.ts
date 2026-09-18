import { afterEach, describe, expect, it } from 'vitest';
import { unwrap } from '../src/lib/result';
import { FILE_ID, FileDownload } from '../src/midi/fileServer';
import { OpzSession } from '../src/midi/session';
import { compress } from '../src/midi/zlib';
import { buildCatalog, parsePlugs, parseSlots, plugName } from '../src/project/catalog';
import { MIDI_CONFIG_SIZE } from '../src/project/layout';
import { FakeOpz } from './fakeOpz';
import { blankBank, randomBytes } from './helpers';

const slotsJson = { tracks: [{ index: 4, packs: [{ id: 65, slot: 1 }, { id: 31, slot: 10 }] }, { index: 0, packs: [{ id: 1, slot: 1 }] }] };
const plugsJson = { plugs: [{ id: 65, name: 'Dimension', type: 'synth' }, { id: 31, name: 'Cluster', type: 'synth' }, { plugId: 1, path: 'samplepacks/1-kick/boom.aif' }], extra: { '60001': { title: 'Mon sample' } } };
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

describe('catalogue des sons', () => {
  it('format réel de plugs.json (lu sur un OP-Z) : kits nommés d’après le pack, moteurs d’après le guide TE', () => {
    const real = { engines: [{ memoryslot: 10, path: 'engines/sampleplayergain.engine', version: 1 }], plugs: [
      { engine: 'engines/sampleplayergain.engine', flags: 0, id: 130, samples: 'samplepacks/AlainKicks.aif', version: 1 },
      { engine: 'engines/sampleplayergain.engine', flags: 0, id: 122, samples: 'samplepacks/TeSnares.aif', version: 1 },
      { engine: 'engines/sampleplayergain.engine', flags: 0, id: 71, samples: 'samplepacks/zVinyl.aif', version: 1 },
      { engine: 'engines/sampleplayergain.engine', flags: 2, id: 3008872573, samples: 'samplepacks/user/user258790727.aif', version: 1 },
      { engine: 'engines/synthsampler.engine', flags: 0, id: 138, samples: 'samplepacks/CuckooC_keypawn.aif', version: 1 },
      { engine: 'engines/analoga.engine', flags: 20, id: 10, samples: '', version: 25 },
      { engine: 'engines/fdnreverb.engine', flags: 0, id: 43, samples: '', version: 7 },
      { engine: '', flags: 0, id: 147, samples: '', version: 1 },
    ] };
    const p = parsePlugs(real);
    expect(p.get(130)).toMatchObject({ name: 'Alain Kicks', kind: 'kit', description: 'grosses caisses' });
    expect(p.get(122)?.name).toBe('TE Snares');
    expect(p.get(71)?.name).toBe('Vinyl');
    expect(p.get(3008872573)?.name).toBe('Sample perso');
    expect(p.get(138)).toMatchObject({ name: 'Cuckoo C keypawn', kind: 'sample mélodique' });
    expect(p.get(10)).toMatchObject({ name: 'Analog', kind: 'moteur' });
    expect(p.get(43)?.name).toBe('Rymd');
    expect(p.get(147)?.named).toBe(false);
    expect(p.has(10)).toBe(true);
  });

  it('lit les emplacements (format connu)', () => {
    const s = parseSlots(slotsJson);
    expect(s.get(4)).toEqual([{ slot: 1, id: 65 }, { slot: 10, id: 31 }]);
    expect(parseSlots({ nope: 1 }).size).toBe(0);
  });
  it('lit les sons de façon tolérante (id/plugId/clé, name/title/chemin)', () => {
    const p = parsePlugs(plugsJson);
    expect(p.get(65)).toEqual({ id: 65, name: 'Dimension', kind: 'synth', engine: null, named: true });
    expect(p.get(1)?.name).toBe('Boom');
    expect(p.get(60001)?.name).toBe('Mon sample');
    const c = buildCatalog({ plugs_json: JSON.stringify(plugsJson), slots_json: 'pas du json', read_at: '' });
    expect(plugName(c, 31)).toBe('Cluster');
    expect(plugName(c, 999)).toBe('Son n° 999');
    expect(c?.slots.size).toBe(0);
  });
  it('nom lisible : le pack avant le moteur', () => {
    const p = parsePlugs([{ id: 3, engine: 'engines/sampleplayergain.engine', pack: 'samplepacks/1-kick/03-boom_kit' }, { id: 4, engine: 'engines/sampleplayergain.engine' }]);
    expect(p.get(3)).toMatchObject({ name: 'Boom kit', engine: 'sampleplayergain' });
    expect(p.get(4)?.named).toBe(false);
    expect(plugName({ plugs: p, slots: new Map() }, 4, 'Kit')).toBe('Kit n° 4');
  });
  it('compatibilité par famille de pistes', async () => {
    const { soundsForTrack } = await import('../src/project/catalog');
    const c = { plugs: parsePlugs([{ id: 1, name: 'A', engine: 'sp' }, { id: 2, name: 'B', engine: 'sp' }, { id: 3, name: 'Syn', engine: 'fm' }, { id: 4, name: 'Libre', engine: 'sp' }]),
      slots: parseSlots({ tracks: [{ index: 0, packs: [{ id: 1, slot: 1 }] }, { index: 1, packs: [{ id: 2, slot: 1 }] }, { index: 4, packs: [{ id: 3, slot: 1 }] }] }) };
    const forKick = Object.fromEntries(soundsForTrack(c, 0).map((s) => [s.name, s.compatible]));
    expect(forKick).toEqual({ A: true, B: true, Syn: false, Libre: true });
  });
});

describe('serveur de fichiers (lecture)', () => {
  let session: OpzSession | null = null;
  afterEach(() => session?.close());

  it('lit plugs.json et slotConfiguration.json puis reprend la session', async () => {
    const big = enc({ ...plugsJson, padding: 'x'.repeat(1500) });
    const device = new FakeOpz({
      bank: blankBank(), global: randomBytes(568, 1), midiConfig: new Uint8Array(MIDI_CONFIG_SIZE),
      files: new Map([[FILE_ID.SLOT_CONFIGURATION, enc(slotsJson)], [FILE_ID.PLUGS, big]]),
    });
    session = new OpzSession(device, { timeoutMs: 400, settleMs: 15, heartbeatMs: 40 });
    unwrap(await session.connect());
    const files = unwrap(await session.readDeviceFiles([FILE_ID.SLOT_CONFIGURATION, FILE_ID.PLUGS]));
    expect(new TextDecoder().decode(files.get(FILE_ID.PLUGS))).toBe(new TextDecoder().decode(big));
    expect(JSON.parse(new TextDecoder().decode(files.get(0)))).toEqual(slotsJson);
    // la session StateSync fonctionne encore après
    expect((await session.readPatternBank()).ok).toBe(true);
  });

  it('parties en désordre : doublon ignoré, trou ⇒ renvoi demandé', () => {
    const part = (n: number, last = false) => {
      const head = Uint8Array.of(7, 0, 1, 0, 0, 0, n, 0, last ? 1 : 0);
      const body = compress(Uint8Array.of(65 + n));
      const payload = new Uint8Array(head.length + body.length);
      payload.set(head);
      payload.set(body, head.length);
      return { messageId: 0x53, payload };
    };
    const d = new FileDownload(1, 7);
    expect(unwrap(d.accept(part(0))).kind).toBe('progress');
    expect(unwrap(d.accept(part(0))).kind).toBe('ignore');
    expect(unwrap(d.accept(part(2)))).toEqual({ kind: 'resend', fromPart: 1 });
    expect(unwrap(d.accept(part(1, true)))).toEqual({ kind: 'done', data: Uint8Array.of(65, 66) });
  });
});
