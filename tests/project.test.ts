import { describe, expect, it } from 'vitest';
import { diffOffsets } from '../src/lib/bytes';
import { unwrap } from '../src/lib/result';
import { GLOBAL_SIZE, MIDI_CONFIG_SIZE, PATTERN_BANK_SIZE } from '../src/project/layout';
import { bytesToProject, newProject, parseProject, projectToBytes, serializeProject, type OpzProject } from '../src/project/opzProject';
import { PatternBankEditor } from '../src/project/patternBank';
import { blankBank, randomBytes, sha256 } from './helpers';

const deviceBytes = () => ({
  bank: randomBytes(PATTERN_BANK_SIZE, 21),
  global: randomBytes(GLOBAL_SIZE, 22),
  midiConfig: randomBytes(MIDI_CONFIG_SIZE, 23),
});
const clone = (p: OpzProject): OpzProject => JSON.parse(JSON.stringify(p)) as OpzProject;

describe('.opzproject — sans perte', () => {
  it('octets → projet → octets : identique (banque, global, config MIDI), même avec des données aléatoires', () => {
    const bytes = deviceBytes();
    const out = unwrap(projectToBytes(unwrap(bytesToProject(bytes, { name: 'test' }))));
    expect(sha256(out.bank)).toBe(sha256(bytes.bank));
    expect(sha256(out.global)).toBe(sha256(bytes.global));
    expect(sha256(out.midiConfig!)).toBe(sha256(bytes.midiConfig));
  });

  it('enregistrer → rouvrir → reconstruire : identique', () => {
    const bytes = deviceBytes();
    const text = serializeProject(unwrap(bytesToProject(bytes, { name: 'aller-retour' })));
    const reopened = unwrap(parseProject(text));
    expect(reopened.meta.name).toBe('aller-retour');
    expect(sha256(unwrap(projectToBytes(reopened)).bank)).toBe(sha256(bytes.bank));
  });

  it('projet vierge : valide et stable', () => {
    const p = newProject('vide');
    const bytes = unwrap(projectToBytes(p));
    expect(unwrap(projectToBytes(unwrap(bytesToProject(bytes, { name: 'x' })))).bank).toEqual(bytes.bank);
    expect(p.global.tempo).toBe(120);
    expect(p.patterns[0].tracks[0].steps).toEqual([]);
  });
});

describe('.opzproject — les modifications lisibles touchent exactement les bons octets', () => {
  const base = blankBank();
  const project = () => unwrap(bytesToProject({ bank: base, global: randomBytes(GLOBAL_SIZE, 5), midiConfig: null }, { name: 'e' }));

  it('ajouter une note = PatternBankEditor.setNotes', () => {
    const p = clone(project());
    p.patterns[2].tracks[5].steps.push({ index: 3, notes: [{ slot: 0, note: 60, velocity: 90, length: 6200, micro: -2, age: 0 }], components: {}, locks: {} });
    const ref = unwrap(PatternBankEditor.from(base));
    unwrap(ref.setNotes(2, 5, 3, [{ note: 60, velocity: 90, duration: 6200, microtimingTicks: -2 }]));
    expect(diffOffsets(ref.bytes(), unwrap(projectToBytes(p)).bank)).toEqual([]);
  });

  it('component + lock + son + mute = mêmes octets que les éditeurs de référence', () => {
    const p = clone(project());
    p.patterns[0].tracks[0].steps.push({ index: 0, notes: [], components: { pulse: 2, velocity: 5 }, locks: { filter: 90 } });
    p.patterns[0].tracks[0].sound.level = 110;
    p.patterns[0].tracks[3].muted = true;
    const ref = unwrap(PatternBankEditor.from(base));
    unwrap(ref.setComponent(0, 0, 0, 0, 2));
    unwrap(ref.setComponent(0, 0, 0, 3, 5));
    unwrap(ref.setParameterLock(0, 0, 0, 8, 90));
    unwrap(ref.setSoundParameter(0, 0, 11, 110));
    unwrap(ref.setMuted(0, 3, true));
    expect(diffOffsets(ref.bytes(), unwrap(projectToBytes(p)).bank)).toEqual([]);
  });

  it('supprimer un step = notes libérées, component désactivé, lock désactivé (valeurs conservées)', () => {
    const edited = unwrap(PatternBankEditor.from(base));
    unwrap(edited.setNotes(1, 6, 7, [{ note: 50 }, { note: 55 }]));
    unwrap(edited.setComponent(1, 6, 7, 8, 4));
    unwrap(edited.setParameterLock(1, 6, 7, 0, 33));
    const p = unwrap(bytesToProject({ bank: edited.bytes(), global: randomBytes(GLOBAL_SIZE, 5), midiConfig: null }, { name: 's' }));
    p.patterns[1].tracks[6].steps = [];
    const ref = unwrap(PatternBankEditor.from(edited.bytes()));
    unwrap(ref.setNotes(1, 6, 7, []));
    unwrap(ref.setComponent(1, 6, 7, 8, null));
    unwrap(ref.setParameterLock(1, 6, 7, 0, null));
    expect(diffOffsets(ref.bytes(), unwrap(projectToBytes(p)).bank)).toEqual([]);
  });

  it('tempo et chaînes → offsets 516 et chaînes du bloc global uniquement', () => {
    const p = clone(project());
    const before = unwrap(projectToBytes(p)).global;
    // Les projets sont immuables (projectToBytes met en cache par objet) : on en crée un nouveau.
    const chains = p.global.chains.slice();
    chains[4] = [0, 1, 1, 2];
    const q = { ...p, global: { ...p.global, tempo: 133, chains } };
    const changed = diffOffsets(before, unwrap(projectToBytes(q)).global).map(([o]) => o);
    expect(changed.every((o) => o === 516 || o === 517 || (o >= 128 && o < 160))).toBe(true);
    expect(changed).toContain(516);
  });
});

describe('.opzproject — fichiers invalides refusés', () => {
  const good = serializeProject(newProject());
  const mutate = (fn: (d: OpzProject) => void): string => {
    const d = JSON.parse(good) as OpzProject;
    fn(d);
    return JSON.stringify(d);
  };
  it.each([
    ['JSON cassé', '{'],
    ['mauvais format', mutate((d) => { (d as { format: string }).format = 'autre'; })],
    ['version future', mutate((d) => { (d as { version: number }).version = 2; })],
    ['tempo négatif', mutate((d) => { d.global.tempo = -1; })],
    ['note hors plage', mutate((d) => { d.patterns[0].tracks[0].steps = [{ index: 0, notes: [{ slot: 0, note: 300, velocity: 1, length: 1, age: 0 }], components: {}, locks: {} }]; })],
    ['slot au-delà de la capacité (kick = 2)', mutate((d) => { d.patterns[0].tracks[0].steps = [{ index: 0, notes: [{ slot: 2, note: 60, velocity: 1, length: 1, age: 0 }], components: {}, locks: {} }]; })],
    ['component inconnu', mutate((d) => { d.patterns[0].tracks[0].steps = [{ index: 0, notes: [], components: { foo: 1 }, locks: {} }]; })],
    ['lock inconnu', mutate((d) => { d.patterns[0].tracks[0].steps = [{ index: 0, notes: [], components: {}, locks: { cutoff: 1 } as OpzProject['patterns'][0]['tracks'][0]['steps'][0]['locks'] }]; })],
    ['raw corrompu', mutate((d) => { d.raw.bank = 'AAAA'; })],
  ])('%s', (_label, text) => {
    expect(parseProject(text).ok).toBe(false);
  });
});

describe('rebase après envoi', () => {
  it('changer la référence brute ne change pas les octets produits', async () => {
    const { rebaseProject } = await import('../src/project/opzProject');
    const { setSound } = await import('../src/project/edit');
    const p0 = unwrap(bytesToProject({ bank: blankBank(), global: randomBytes(GLOBAL_SIZE, 1), midiConfig: null }, { name: 'r' }));
    const p1 = unwrap(setSound(p0, 0, 0, 'filter', 12));
    const bytes = unwrap(projectToBytes(p1));
    const p2 = rebaseProject(p1, { bank: bytes.bank, global: bytes.global });
    expect(sha256(unwrap(projectToBytes(p2)).bank)).toBe(sha256(bytes.bank));
    expect(p2.raw.bank).not.toBe(p1.raw.bank);
  });
});
