#!/usr/bin/env python3
"""Generate byte-exact test fixtures from kmorrill/op-z-sysex (the Python reference).

Usage:
    git clone https://github.com/kmorrill/op-z-sysex.git ../op-z-sysex
    python3 tools/fixtures/generate_fixtures.py --opz-sysex ../op-z-sysex

Writes tests/fixtures/*.json. The TypeScript port must reproduce every byte.
Never edit the JSON by hand: regenerate it.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tests" / "fixtures"


def hx(data: bytes) -> str:
    return data.hex()


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def diff(before: bytes, after: bytes) -> list[list[int]]:
    return [[i, after[i]] for i in range(len(before)) if before[i] != after[i]]


def blank_bank(project) -> bytes:
    """Deterministic 'empty' bank: all zero, every note slot marked unused (FF)."""
    data = bytearray(project.PATTERN_BANK_SIZE)
    for pattern in range(16):
        for step in range(16):
            for slot in range(55):
                data[pattern * project.PATTERN_SIZE + 192 + (step * 55 + slot) * 8 + 4] = 0xFF
        for track in range(16):
            data[pattern * project.PATTERN_SIZE + track * 12 + 4] = 16  # step count
    return bytes(data)


def default_global() -> bytes:
    """GlobalData constructor defaults (docs/project-global-format.md)."""
    data = bytearray(568)
    data[0:512] = b"\xFF" * 512
    data[512], data[513], data[514], data[515] = 0x80, 0x80, 0x00, 0x00
    data[516:518] = (120).to_bytes(2, "little")
    data[561], data[562], data[563], data[564] = 0x7F, 0x64, 0x00, 0xFF
    return bytes(data)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--opz-sysex", required=True, help="path to a clone of kmorrill/op-z-sysex")
    args = parser.parse_args()
    ref = Path(args.opz_sysex).resolve()
    sys.path.insert(0, str(ref))
    from opzsysex import sysex, project, midi_config, fileprotocol  # noqa: E402

    try:
        commit = subprocess.check_output(["git", "-C", str(ref), "rev-parse", "HEAD"], text=True).strip()
    except Exception:  # pragma: no cover
        commit = "unknown"
    meta = {"source": "kmorrill/op-z-sysex", "commit": commit}
    rng = random.Random(0x0B2)
    OUT.mkdir(parents=True, exist_ok=True)

    # --- packing / framing / zlib -------------------------------------------------
    pack_cases = [bytes(), bytes(range(256)), b"\x80", b"\xFF" * 7, b"\xFF" * 8, b"\x7F\x80" * 9]
    pack_cases += [bytes(rng.randrange(256) for _ in range(n)) for n in (1, 6, 7, 8, 13, 14, 15, 100, 777)]
    zlib_cases = [b"", b"a", bytes(range(256)) * 4, default_global(), bytes(rng.randrange(256) for _ in range(1000))]
    frame_cases = [(0x00, b""), (0x53, bytes(range(32))), (0x0C, b"\xFF\x80\x00"), (0x7F, bytes(rng.randrange(256) for _ in range(50)))]
    realtime_target = sysex.frame(0x07, b"abc")
    stream = b"\xF8" + realtime_target[:4] + b"\xF8" + realtime_target[4:] + b"\xFE" + b"\x90\x3C\x40" + sysex.frame(0x01, b"\x01\x02")
    parser_events = [[kind, value if isinstance(value, int) else hx(value)] for kind, value in sysex.MIDIStreamParser().feed(stream)]

    (OUT / "sysex.json").write_text(json.dumps({
        "meta": meta,
        "constants": {
            "te_header": hx(sysex.TE_HEADER),
            "identity_inquiry": hx(sysex.IDENTITY_INQUIRY),
            "pattern_query": hx(sysex.PATTERN_QUERY),
            "midi_configuration_query": hx(sysex.MIDI_CONFIGURATION_QUERY),
            "heartbeat_4e2e": hx(sysex.heartbeat((0x4E, 0x2E))),
        },
        "pack7": [{"input": hx(c), "packed": hx(sysex.pack7(c))} for c in pack_cases],
        "zlib": [{"input": hx(c), "compressed": hx(sysex.compress(c))} for c in zlib_cases],
        "frames": [{"id": i, "payload": hx(p), "frame": hx(sysex.frame(i, p))} for i, p in frame_cases],
        "client_hello": [{"client_id": c, "frame": hx(sysex.state_sync_client_hello(c))} for c in (0x4E2E, 0x0001, 0xBEEF)],
        "active_chain": [
            {"patterns": p, "project": pr, "frame": hx(sysex.active_chain(p, pr))}
            for p, pr in (([1, 2, 3], 4), ([0], 0), (list(range(16)) + list(range(15)), 15), ([15, 0, 15], 7))
        ],
        "stream_parser": {"input": hx(stream), "events": parser_events},
    }, indent=1))

    # --- pattern bank ---------------------------------------------------------------
    bank = blank_bank(project)
    Note = project.Note
    ops = [
        ["notes", 0, 0, 0, [[48, 100, 6200, 0, 0]]],
        ["notes", 3, 6, 4, [[60, 91, 6200, -1, 0], [67, 92, 12400, 2, 3]]],
        ["notes", 15, 6, 15, [[n, 127, 6200 * (i + 1), -12 + i * 3, i] for i, n in enumerate(range(40, 48))]],
        ["notes", 0, 4, 2, [[36, 1, 1, 11, 255]]],
        ["notes", 3, 6, 4, [[61, 90, 3100, 0, 0]]],
        ["notes", 3, 6, 4, []],
        ["lock", 3, 6, 4, 8, 201],
        ["lock", 0, 0, 0, 11, 110],
        ["lock", 0, 0, 0, 11, None],
        ["lock", 15, 15, 15, 17, 0],
        ["component", 0, 0, 0, 0, 2],
        ["component", 0, 0, 0, 3, 5],
        ["component", 0, 0, 0, 13, 7],
        ["component", 0, 0, 0, 3, None],
        ["component", 7, 7, 15, 15, 255],
        ["sound", 0, 0, 8, 127],
        ["sound", 15, 15, 17, 3],
        ["sound", 4, 7, 0, 0],
        ["plug", 0, 0, 1],
        ["plug", 2, 5, 0xDEADBEEF],
        ["step_count", 0, 3, 7],
        ["step_count", 9, 15, 1],
        ["muted", 0, 2, True],
        ["muted", 0, 15, True],
        ["muted", 0, 2, False],
        ["routing", 0, 0xA55A, None],
        ["routing", 15, None, 0x5AA5],
    ]
    editor = project.PatternBankEditor(bank)
    steps = []
    previous = bank
    for op in ops:
        kind = op[0]
        if kind == "notes":
            editor.set_notes(op[1], op[2], op[3], [Note(*n) for n in op[4]])
        elif kind == "lock":
            editor.set_parameter_lock(*op[1:])
        elif kind == "component":
            editor.set_component(*op[1:])
        elif kind == "sound":
            editor.set_sound_parameter(*op[1:])
        elif kind == "plug":
            editor.set_active_plug(*op[1:])
        elif kind == "step_count":
            editor.set_step_count(*op[1:])
        elif kind == "muted":
            editor.set_muted(*op[1:])
        elif kind == "routing":
            editor.set_routing(op[1], tape=op[2], master=op[3])
        current = editor.bytes()
        steps.append({"op": op, "diff": diff(previous, current), "sha256": sha(current)})
        previous = current
    final_bank = editor.bytes()

    invalid = []
    for op in (
        ["notes", 0, 0, 0, [[1, 1, 1, 0, 0]] * 3],
        ["notes", 0, 0, 0, [[128, 1, 1, 0, 0]]],
        ["notes", 0, 0, 0, [[60, 0, 1, 0, 0]]],
        ["notes", 0, 0, 0, [[60, 1, 0, 0, 0]]],
        ["notes", 0, 0, 0, [[60, 1, 1, 12, 0]]],
        ["lock", 0, 0, 0, 18, 1],
        ["component", 0, 0, 0, 16, 1],
        ["sound", 16, 0, 0, 1],
        ["plug", 0, 0, 0],
        ["step_count", 0, 0, 17],
    ):
        try:
            e = project.PatternBankEditor(bank)
            kind = op[0]
            if kind == "notes":
                e.set_notes(op[1], op[2], op[3], [Note(*n) for n in op[4]])
            elif kind == "lock":
                e.set_parameter_lock(*op[1:])
            elif kind == "component":
                e.set_component(*op[1:])
            elif kind == "sound":
                e.set_sound_parameter(*op[1:])
            elif kind == "plug":
                e.set_active_plug(*op[1:])
            elif kind == "step_count":
                e.set_step_count(*op[1:])
            invalid.append({"op": op, "rejected": False})
        except sysex.ProtocolError:
            invalid.append({"op": op, "rejected": True})

    prefix = final_bank[: project.PATTERN_SIZE]
    upload_full = sysex.pattern_upload_frames(final_bank, 0x2F, 0x1234)
    upload_prefix = sysex.pattern_upload_frames(prefix, 0x20, 0x0042)
    (OUT / "pattern.json").write_text(json.dumps({
        "meta": meta,
        "layout": {
            "pattern_size": project.PATTERN_SIZE,
            "pattern_count": project.PATTERN_COUNT,
            "bank_size": project.PATTERN_BANK_SIZE,
            "notes_per_step": list(project.NOTES_PER_STEP),
            "note_offsets": list(project.NOTE_OFFSETS),
            "track_names": list(project.TRACK_NAMES),
        },
        "blank_bank_sha256": sha(bank),
        "ops": steps,
        "invalid_ops": invalid,
        "final_bank_sha256": sha(final_bank),
        "final_bank_zlib": hx(sysex.compress(final_bank)),
        "upload_full": {"address": 0x2F, "transfer_id": 0x1234, "frames": [hx(f) for f in upload_full]},
        "upload_prefix": {"address": 0x20, "transfer_id": 0x42, "frames": [hx(f) for f in upload_prefix]},
    }))

    # --- project global -------------------------------------------------------------
    g = default_global()
    g_state = bytearray(g)
    g_state[525] = 0xA0  # opaque byte seen on hardware: must survive edits
    g_state = bytes(g_state)
    ge = project.GlobalEditor(g_state)
    ge.set_tempo(123)
    ge.set_chain(2, [1, 5, 9])
    ge.set_chain(14, list(range(16)) + list(range(15)))
    ge.set_level("drum", 200)
    ge.set_level("master", 110)
    edited = ge.bytes()
    s = project.decode_global(edited)
    (OUT / "global.json").write_text(json.dumps({
        "meta": meta,
        "input": hx(g_state),
        "edits": [["tempo", 123], ["chain", 2, [1, 5, 9]], ["chain", 14, list(range(16)) + list(range(15))], ["level", "drum", 200], ["level", "master", 110]],
        "output": hx(edited),
        "summary": {
            "drum_level": s.drum_level, "synth_level": s.synth_level, "punch_level": s.punch_level,
            "master_level": s.master_level, "tempo": s.tempo, "swing": s.swing,
            "metronome_level": s.metronome_level, "metronome_sound": s.metronome_sound,
            "chains": [list(c) for c in s.chains], "active_chain": list(s.active_chain),
            "selected_chain_raw": s.selected_chain_raw,
        },
        "upload_frame": hx(sysex.global_upload_frame(edited)),
    }, indent=1))

    # --- MIDI configuration ---------------------------------------------------------
    raw = bytearray(midi_config.BYTE_COUNT)
    raw[289:292] = b"\x11\x22\x33"
    cfg = midi_config.MIDIConfiguration.decode(bytes(raw))
    cfg.set_track_enabled(5, True)
    cfg.set_channel(5, 12)
    cfg.set_cc(5, 3, 74)
    cfg.set_setting(3, True)
    (OUT / "midi_config.json").write_text(json.dumps({
        "meta": meta,
        "input": hx(bytes(raw)),
        "output": hx(cfg.encode()),
        "write_frame": hx(cfg.write_frame()),
    }, indent=1))

    # --- file protocol ids ----------------------------------------------------------
    paths = ["settings/slotConfiguration.json", "settings/plugs.json", "syncjob.json", "samplepacks/1-kick/kick01.aif", "project01.opz"]
    (OUT / "files.json").write_text(json.dumps({
        "meta": meta,
        "file_id": [{"path": p, "id": fileprotocol.file_id(p), "download_id": fileprotocol.download_file_id(p)} for p in paths],
    }, indent=1))
    print(f"fixtures written to {OUT} from op-z-sysex {commit[:10]}")


if __name__ == "__main__":
    main()
