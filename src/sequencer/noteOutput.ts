import type { MidiTransport } from '../midi/transport';

/**
 * Sortie MIDI restreinte aux notes (Note On 0x9n / Note Off 0x8n).
 * Garde-fou de la règle n° 1 (CLAUDE.md) : le séquenceur ne peut physiquement
 * rien envoyer d'autre à l'OP-Z — ni CC, ni SysEx, ni start/stop.
 */
export interface NoteOutput {
  noteOn(channel: number, note: number, velocity: number, atMs?: number): void;
  noteOff(channel: number, note: number, atMs?: number): void;
}

export function isNoteMessage(data: ArrayLike<number>): boolean {
  return data.length === 3 && (data[0] & 0xe0) === 0x80 && data[1] < 0x80 && data[2] < 0x80;
}

export function createNoteOutput(transport: MidiTransport): NoteOutput {
  const send = (data: number[], atMs?: number): void => {
    if (!isNoteMessage(data)) throw new Error('sortie restreinte aux notes');
    const bytes = Uint8Array.from(data);
    if (atMs !== undefined && transport.sendAt) transport.sendAt(bytes, atMs);
    else transport.send(bytes);
  };
  const ch = (c: number) => c & 0x0f;
  return {
    noteOn: (channel, note, velocity, atMs) => send([0x90 | ch(channel), note & 0x7f, Math.max(1, velocity & 0x7f)], atMs),
    noteOff: (channel, note, atMs) => send([0x80 | ch(channel), note & 0x7f, 0], atMs),
  };
}
