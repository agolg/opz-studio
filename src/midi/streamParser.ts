/**
 * Incremental MIDI byte-stream parser that tolerates realtime bytes (F8–FF)
 * interleaved inside SysEx. Port of opzsysex/sysex.py MIDIStreamParser.
 *
 * Web MIDI normally delivers complete SysEx messages, but this parser is kept
 * for raw captures, tests and any transport that fragments messages.
 */
export type StreamEvent = { kind: 'realtime'; byte: number } | { kind: 'sysex'; data: Uint8Array };

export class MidiStreamParser {
  private sysex: number[] | null = null;

  feed(data: Uint8Array): StreamEvent[] {
    const events: StreamEvent[] = [];
    for (const byte of data) {
      if (byte >= 0xf8) {
        events.push({ kind: 'realtime', byte });
        continue;
      }
      if (this.sysex === null) {
        if (byte === 0xf0) this.sysex = [byte];
        continue;
      }
      if (byte === 0xf0) {
        this.sysex = [byte];
      } else {
        this.sysex.push(byte);
        if (byte === 0xf7) {
          events.push({ kind: 'sysex', data: Uint8Array.from(this.sysex) });
          this.sysex = null;
        }
      }
    }
    return events;
  }
}
