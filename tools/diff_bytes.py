#!/usr/bin/env python3
"""XOR diff of two binary dumps (e.g. two 'Télécharger .bin' exports of the bank).

Usage: python3 tools/diff_bytes.py A.bin B.bin [--pattern-size 21392]

Prints every differing offset; with --pattern-size, also shows pattern number
and offset inside the pattern, which maps directly onto src/project/layout.ts.
"""
import argparse

parser = argparse.ArgumentParser()
parser.add_argument("a")
parser.add_argument("b")
parser.add_argument("--pattern-size", type=int, default=21392)
args = parser.parse_args()

a = open(args.a, "rb").read()
b = open(args.b, "rb").read()
if len(a) != len(b):
    print(f"warning: sizes differ ({len(a)} vs {len(b)})")
count = 0
for i, (x, y) in enumerate(zip(a, b)):
    if x != y:
        count += 1
        where = f"P{i // args.pattern_size + 1:>2} +{i % args.pattern_size:>5}" if len(a) == args.pattern_size * 16 else ""
        print(f"offset 0x{i:05x} ({i:6d}) {where} : {x:08b} ({x:3d}) → {y:08b} ({y:3d})")
print(f"{count} byte(s) differ")
