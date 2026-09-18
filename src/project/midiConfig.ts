import { ok, protocolError, type ProtocolError, type Result } from '../lib/result';
import { MIDI_CONFIG_SIZE } from './layout';

/**
 * 292-byte MIDI configuration ($0F query / $10 payload).
 * opzsysex/midi_config.py — docs/midi-configuration-sysex.md
 *   0..15    track enabled (0/1)
 *   16..31   track channel (0-based)
 *   32..287  16 tracks × 16 parameter CC numbers
 *   288      settings bit field
 *   289..291 padding — preserve
 */
export interface MidiConfiguration {
  trackEnabled: number[];
  trackChannels: number[];
  parameterCcs: number[];
  settings: number;
  padding: number[];
}

export function decodeMidiConfig(data: Uint8Array): Result<MidiConfiguration, ProtocolError> {
  if (data.length !== MIDI_CONFIG_SIZE) return protocolError(`MIDI configuration must be ${MIDI_CONFIG_SIZE} bytes`);
  return ok({
    trackEnabled: Array.from(data.subarray(0, 16)),
    trackChannels: Array.from(data.subarray(16, 32)),
    parameterCcs: Array.from(data.subarray(32, 288)),
    settings: data[288],
    padding: Array.from(data.subarray(289, 292)),
  });
}

export function validMidiConfig(c: MidiConfiguration): boolean {
  return (
    c.trackEnabled.length === 16 && c.trackEnabled.every((v) => v === 0 || v === 1) &&
    c.trackChannels.length === 16 && c.trackChannels.every((v) => Number.isInteger(v) && v >= 0 && v < 16) &&
    c.parameterCcs.length === 256 && c.parameterCcs.every((v) => Number.isInteger(v) && v >= 0 && v < 128) &&
    Number.isInteger(c.settings) && c.settings >= 0 && c.settings <= 255 &&
    c.padding.length === 3
  );
}

export function encodeMidiConfig(c: MidiConfiguration): Result<Uint8Array, ProtocolError> {
  if (!validMidiConfig(c)) return protocolError('invalid MIDI configuration values');
  return ok(Uint8Array.from([...c.trackEnabled, ...c.trackChannels, ...c.parameterCcs, c.settings, ...c.padding]));
}

/** Immutable setters mirroring the reference API. Channel is 1..16 (user-facing). */
export const midiConfigEdits = {
  setTrackEnabled(c: MidiConfiguration, track: number, enabled: boolean): Result<MidiConfiguration, ProtocolError> {
    if (!isTrack(track)) return protocolError('track must be 0..15');
    const trackEnabled = [...c.trackEnabled];
    trackEnabled[track] = enabled ? 1 : 0;
    return ok({ ...c, trackEnabled });
  },
  setChannel(c: MidiConfiguration, track: number, channel: number): Result<MidiConfiguration, ProtocolError> {
    if (!isTrack(track)) return protocolError('track must be 0..15');
    if (!Number.isInteger(channel) || channel < 1 || channel > 16) return protocolError('MIDI channel must be 1..16');
    const trackChannels = [...c.trackChannels];
    trackChannels[track] = channel - 1;
    return ok({ ...c, trackChannels });
  },
  setCc(c: MidiConfiguration, track: number, parameter: number, cc: number): Result<MidiConfiguration, ProtocolError> {
    if (!isTrack(track)) return protocolError('track must be 0..15');
    if (!Number.isInteger(parameter) || parameter < 0 || parameter > 15 || !Number.isInteger(cc) || cc < 0 || cc > 127) {
      return protocolError('parameter must be 0..15 and CC must be 0..127');
    }
    const parameterCcs = [...c.parameterCcs];
    parameterCcs[track * 16 + parameter] = cc;
    return ok({ ...c, parameterCcs });
  },
  setSetting(c: MidiConfiguration, bit: number, enabled: boolean): Result<MidiConfiguration, ProtocolError> {
    if (!Number.isInteger(bit) || bit < 0 || bit > 7) return protocolError('setting bit must be 0..7');
    return ok({ ...c, settings: enabled ? c.settings | (1 << bit) : c.settings & ~(1 << bit) });
  },
};

const isTrack = (t: number): boolean => Number.isInteger(t) && t >= 0 && t < 16;
