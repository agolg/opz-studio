import { describe, expect, it } from 'vitest';
import { diffOffsets } from '../src/lib/bytes';
import { unwrap } from '../src/lib/result';
import { defaultNoteFor, setComponent, setLock, setStepNotes, setTempo, setTrackSettings, stepNotes, toggleStep } from '../src/project/edit';
import { bytesToProject, projectToBytes, type OpzProject } from '../src/project/opzProject';
import { PatternBankEditor } from '../src/project/patternBank';
import { blankBank, randomBytes } from './helpers';

const base = blankBank();
const start = (): OpzProject => unwrap(bytesToProject({ bank: base, global: randomBytes(568, 9), midiConfig: null }, { name: 'e' }));
const bank = (p: OpzProject) => unwrap(projectToBytes(p)).bank;

describe('modifications du projet = mêmes octets que les éditeurs de référence', () => {
  it('toggleStep pose puis retire une note', () => {
    const p0 = start();
    const p1 = unwrap(toggleStep(p0, 3, 2, 5, 55));
    const ref = unwrap(PatternBankEditor.from(base));
    unwrap(ref.setNotes(3, 2, 5, [{ note: 55, velocity: 100, duration: 6200 }]));
    expect(diffOffsets(ref.bytes(), bank(p1))).toEqual([]);
    const p2 = unwrap(toggleStep(p1, 3, 2, 5, 55));
    expect(p2.patterns[3].tracks[2].steps).toEqual([]);
    expect(p0.patterns[3].tracks[2].steps).toEqual([]); // immuable
  });

  it('accord, composant, lock, réglages de piste', () => {
    let p = start();
    p = unwrap(setStepNotes(p, 0, 7, 2, [{ note: 60 }, { note: 64, velocity: 80, lengthSteps: 2, micro: -3 }, { note: 67 }]));
    p = unwrap(setComponent(p, 0, 7, 2, 'multiply', 4));
    p = unwrap(setLock(p, 0, 7, 2, 'filter', 180));
    p = unwrap(setTrackSettings(p, 0, 7, { step_count: 12, muted: true }));
    const ref = unwrap(PatternBankEditor.from(base));
    unwrap(ref.setNotes(0, 7, 2, [{ note: 60 }, { note: 64, velocity: 80, duration: 12400, microtimingTicks: -3 }, { note: 67 }]));
    unwrap(ref.setComponent(0, 7, 2, 8, 4));
    unwrap(ref.setParameterLock(0, 7, 2, 8, 180));
    unwrap(ref.setStepCount(0, 7, 12));
    unwrap(ref.setMuted(0, 7, true));
    expect(diffOffsets(ref.bytes(), bank(p))).toEqual([]);
    expect(stepNotes(p.patterns[0].tracks[7].steps[0])[1]).toEqual({ note: 64, velocity: 80, lengthSteps: 2, micro: -3 });
  });

  it('retirer composant et lock vide le step', () => {
    let p = unwrap(setComponent(start(), 0, 0, 0, 'pulse', 2));
    p = unwrap(setLock(p, 0, 0, 0, 'level', 10));
    p = unwrap(setComponent(p, 0, 0, 0, 'pulse', null));
    p = unwrap(setLock(p, 0, 0, 0, 'level', null));
    expect(p.patterns[0].tracks[0].steps).toEqual([]);
  });

  it('refuse les valeurs invalides', () => {
    const p = start();
    expect(setStepNotes(p, 0, 0, 0, [{ note: 1 }, { note: 2 }, { note: 3 }]).ok).toBe(false); // kick = 2 max
    expect(setStepNotes(p, 0, 6, 0, new Array(8).fill({ note: 60 })).ok).toBe(true); // arp = 8
    expect(setStepNotes(p, 0, 0, 0, [{ note: 128 }]).ok).toBe(false);
    expect(setStepNotes(p, 0, 0, 0, [{ note: 60, micro: 12 }]).ok).toBe(false);
    expect(setComponent(p, 0, 9, 0, 'pulse', 1).ok).toBe(false); // piste fx2
    expect(setComponent(p, 0, 0, 0, 'reserved_14', 1).ok).toBe(false);
    expect(setComponent(p, 0, 0, 0, 'pulse', 11).ok).toBe(false);
    expect(setTrackSettings(p, 0, 0, { step_count: 0 }).ok).toBe(false);
    expect(setTempo(p, 201).ok).toBe(false);
    expect(unwrap(setTempo(p, 90)).global.tempo).toBe(90);
  });

  it('note par défaut = la plus utilisée sur la piste', () => {
    let p = start();
    expect(defaultNoteFor(p, 0)).toBe(60);
    p = unwrap(setStepNotes(p, 0, 0, 0, [{ note: 53 }]));
    p = unwrap(setStepNotes(p, 1, 0, 4, [{ note: 53 }]));
    p = unwrap(setStepNotes(p, 1, 0, 8, [{ note: 55 }]));
    expect(defaultNoteFor(p, 0)).toBe(53);
  });
});

describe('noms de patterns (propres à l’éditeur)', () => {
  it('ne touchent aucun octet et survivent à la validation', async () => {
    const { validateProject, serializeProject } = await import('../src/project/opzProject');
    const { setPatternName } = await import('../src/project/edit');
    const p0 = start();
    const p1 = unwrap(setPatternName(p0, 2, '  Refrain '));
    expect(p1.meta.pattern_names?.[2]).toBe('Refrain');
    expect(p1.meta.pattern_names).toHaveLength(16);
    expect(diffOffsets(bank(p0), bank(p1))).toEqual([]);
    const back = unwrap(validateProject(JSON.parse(serializeProject(p1))));
    expect(back.meta.pattern_names?.[2]).toBe('Refrain');
    expect(validateProject({ ...JSON.parse(serializeProject(p1)), meta: { ...p1.meta, pattern_names: [1] } }).ok).toBe(false);
  });
});

describe('copier / coller entre patterns', () => {
  it('piste et pattern : mêmes octets que la source, sans toucher aux autres patterns', async () => {
    const { pasteTrack, pastePattern, setStepNotes } = await import('../src/project/edit');
    let p = start();
    p = unwrap(setStepNotes(p, 0, 0, 3, [{ note: 60, velocity: 90 }]));
    p = unwrap(setStepNotes(p, 0, 5, 7, [{ note: 64, velocity: 80 }]));
    const src = p.patterns.find((x) => x.id === 0)!;
    const q = unwrap(pasteTrack(p, 4, src.tracks[0]));
    expect(q.patterns[4].tracks[0].steps).toEqual(src.tracks[0].steps);
    expect(q.patterns[4].tracks[5].steps).toEqual([]);
    const r = unwrap(pastePattern(p, 9, src));
    expect(r.patterns[9].id).toBe(9);
    expect({ ...r.patterns[9], id: 0 }).toEqual(src);
    // octets : le pattern 10 devient identique au pattern 1
    const b = bank(r);
    const size = 21392;
    expect(diffOffsets(b.subarray(0, size), b.subarray(9 * size, 10 * size))).toEqual([]);
  });
});
