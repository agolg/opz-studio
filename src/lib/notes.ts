const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** 60 → « C4 » (convention C4 = 60). */
export const noteName = (n: number): string => `${NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
