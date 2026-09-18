import { NOTE_REC, OFF, PATTERN_SIZE, SOUND_PARAMS, TRACK_REC } from './layout';

/**
 * Décrit un octet de la banque de patterns, pour comprendre un écart de relecture.
 * « Volatil » = octet que l'OP-Z peut changer tout seul pendant qu'il tourne ou qu'on
 * tourne un bouton (réglages de son, âge des notes, octets internes non documentés).
 */
export interface OffsetInfo { pattern: number; where: string; volatile: boolean }

export function describeOffset(offset: number): OffsetInfo {
  const pattern = Math.floor(offset / PATTERN_SIZE);
  const o = offset % PATTERN_SIZE;
  if (o < OFF.NOTES) {
    const t = Math.floor(o / OFF.TRACK_RECORD_SIZE);
    const f = o % OFF.TRACK_RECORD_SIZE;
    const opaque = f === TRACK_REC.UNKNOWN1 || f === TRACK_REC.UNKNOWN2 || f === TRACK_REC.UNKNOWN2 + 1;
    return { pattern, where: `piste ${t + 1}, fiche octet ${f}`, volatile: opaque };
  }
  if (o < OFF.STEPS) {
    const rel = o - OFF.NOTES;
    const f = rel % OFF.NOTE_RECORD_SIZE;
    const slot = Math.floor(rel / OFF.NOTE_RECORD_SIZE);
    return { pattern, where: `note ${slot} (octet ${f}${f === NOTE_REC.AGE ? ', âge' : ''})`, volatile: f === NOTE_REC.AGE };
  }
  if (o < OFF.SOUND) {
    const rel = o - OFF.STEPS;
    const rec = Math.floor(rel / OFF.STEP_RECORD_SIZE);
    return { pattern, where: `pas ${(rec % 16) + 1} de la piste ${Math.floor(rec / 16) + 1}`, volatile: false };
  }
  if (o < OFF.MUTE_GROUPS) {
    const rel = o - OFF.SOUND;
    const t = Math.floor(rel / SOUND_PARAMS.length);
    return { pattern, where: `réglage ${SOUND_PARAMS[rel % SOUND_PARAMS.length]} de la piste ${t + 1}`, volatile: true };
  }
  if (o < OFF.TAPE_ROUTING) return { pattern, where: 'groupes de muets', volatile: false };
  if (o < OFF.ACTIVE_MUTE_GROUP) return { pattern, where: 'routage tape/master', volatile: false };
  if (o < OFF.TAIL) return { pattern, where: 'groupe de muets actif', volatile: true };
  return { pattern, where: 'octets internes de fin', volatile: true };
}

export function diffOffsetsOf(a: Uint8Array, b: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) out.push(i);
  return out;
}

/** Écart de relecture acceptable : peu d'octets, tous « volatils ». */
export const MINOR_DIFF_MAX = 32;
export function isMinorDiff(offsets: readonly number[]): boolean {
  return offsets.length > 0 && offsets.length <= MINOR_DIFF_MAX && offsets.every((o) => describeOffset(o).volatile);
}

export function explainDiff(offsets: readonly number[], max = 6): string {
  return offsets.slice(0, max).map((o) => { const d = describeOffset(o); return `pattern ${d.pattern + 1} : ${d.where}`; }).join(' ; ') + (offsets.length > max ? ` … (+${offsets.length - max})` : '');
}
