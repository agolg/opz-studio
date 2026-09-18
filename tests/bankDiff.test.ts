import { describe, expect, it } from 'vitest';
import { describeOffset, isMinorDiff } from '../src/project/bankDiff';
import { OFF, PATTERN_SIZE, SOUND_PARAMS } from '../src/project/layout';

describe('écarts de relecture', () => {
  it('réglage de son, âge de note : volatils ; notes et pas : non', () => {
    const sound = 2 * PATTERN_SIZE + OFF.SOUND + 4 * SOUND_PARAMS.length + SOUND_PARAMS.indexOf('fx2');
    expect(describeOffset(sound)).toMatchObject({ pattern: 2, volatile: true });
    expect(describeOffset(sound).where).toMatch(/fx2 de la piste 5/);
    expect(describeOffset(OFF.NOTES + 7).volatile).toBe(true); // âge
    expect(describeOffset(OFF.NOTES + 4).volatile).toBe(false); // hauteur de note
    expect(describeOffset(OFF.STEPS + 3).volatile).toBe(false);
    expect(isMinorDiff([sound, OFF.NOTES + 7])).toBe(true);
    expect(isMinorDiff([sound, OFF.NOTES + 4])).toBe(false);
    expect(isMinorDiff([])).toBe(false);
  });
});
