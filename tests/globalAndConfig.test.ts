import { describe, expect, it } from 'vitest';
import { toHex } from '../src/lib/bytes';
import { unwrap } from '../src/lib/result';
import { downloadFileId, fileId } from '../src/midi/fileId';
import { globalUploadFrame, midiConfigWriteFrame } from '../src/midi/messages';
import { decodeGlobal, GlobalEditor } from '../src/project/global';
import { decodeMidiConfig, encodeMidiConfig, midiConfigEdits } from '../src/project/midiConfig';
import { fixture, hex, inflateFrame } from './helpers';

interface GlobalFixture {
  input: string;
  edits: [string, ...unknown[]][];
  output: string;
  summary: Record<string, unknown>;
  upload_frame: string;
}
const g = fixture<GlobalFixture>('global');

describe('project-global $0C', () => {
  it('edits are byte-identical to GlobalEditor and preserve opaque byte 525', () => {
    const editor = unwrap(GlobalEditor.from(hex(g.input)));
    for (const [kind, a, b] of g.edits) {
      if (kind === 'tempo') unwrap(editor.setTempo(a as number));
      if (kind === 'chain') unwrap(editor.setChain(a as number, b as number[]));
      if (kind === 'level') unwrap(editor.setLevel(a as 'drum', b as number));
    }
    const out = editor.bytes();
    expect(toHex(out)).toBe(g.output);
    expect(out[525]).toBe(0xa0);
    const ours = inflateFrame(unwrap(globalUploadFrame(out)));
    const theirs = inflateFrame(hex(g.upload_frame));
    expect(ours.id).toBe(0x0c);
    expect(toHex(ours.content)).toBe(toHex(theirs.content));
  });
  it('decode matches decode_global', () => {
    const s = unwrap(decodeGlobal(hex(g.output)));
    expect({
      drum_level: s.drumLevel, synth_level: s.synthLevel, punch_level: s.punchLevel, master_level: s.masterLevel,
      tempo: s.tempo, swing: s.swing, metronome_level: s.metronomeLevel, metronome_sound: s.metronomeSound,
      chains: s.chains, active_chain: s.activeChain, selected_chain_raw: s.selectedChainRaw,
    }).toEqual(g.summary);
  });
  it('validation', () => {
    const e = unwrap(GlobalEditor.from(hex(g.input)));
    expect(e.setTempo(39).ok).toBe(false);
    expect(e.setTempo(201).ok).toBe(false);
    expect(e.setChain(15, [1]).ok).toBe(false);
    expect(e.setChain(0, new Array(32).fill(0)).ok).toBe(false);
    expect(GlobalEditor.from(new Uint8Array(10)).ok).toBe(false);
    expect(toHex(e.bytes())).toBe(g.input);
  });
});

interface MidiFixture { input: string; output: string; write_frame: string }
const m = fixture<MidiFixture>('midi_config');

describe('MIDI configuration $10', () => {
  it('edits and write frame are byte-identical', () => {
    let c = unwrap(decodeMidiConfig(hex(m.input)));
    c = unwrap(midiConfigEdits.setTrackEnabled(c, 5, true));
    c = unwrap(midiConfigEdits.setChannel(c, 5, 12));
    c = unwrap(midiConfigEdits.setCc(c, 5, 3, 74));
    c = unwrap(midiConfigEdits.setSetting(c, 3, true));
    const bytes = unwrap(encodeMidiConfig(c));
    expect(toHex(bytes)).toBe(m.output);
    const ours = inflateFrame(unwrap(midiConfigWriteFrame(bytes)));
    expect(ours.id).toBe(0x10);
    expect(toHex(ours.content)).toBe(toHex(inflateFrame(hex(m.write_frame)).content));
  });
  it('preserves padding and rejects invalid values', () => {
    const c = unwrap(decodeMidiConfig(hex(m.input)));
    expect(c.padding).toEqual([0x11, 0x22, 0x33]);
    expect(midiConfigEdits.setChannel(c, 0, 17).ok).toBe(false);
    expect(encodeMidiConfig({ ...c, parameterCcs: c.parameterCcs.map(() => 128) }).ok).toBe(false);
  });
});

interface FilesFixture { file_id: { path: string; id: number; download_id: number }[] }
describe('file-server ids', () => {
  it.each(fixture<FilesFixture>('files').file_id.map((f) => [f.path, f] as const))('%s', (_p, f) => {
    expect(fileId(f.path)).toBe(f.id);
    expect(downloadFileId(f.path)).toBe(f.download_id);
  });
});
