/** Small byte helpers shared by the MIDI and project layers. */

export function toHex(data: Uint8Array, separator = ''): string {
  return Array.from(data, (b) => b.toString(16).padStart(2, '0')).join(separator);
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  if (clean.length % 2 !== 0) throw new Error('odd-length hex string');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Offsets that differ between two equal-length buffers (the TS twin of tools/diff_bytes.py). */
export function diffOffsets(a: Uint8Array, b: Uint8Array): Array<[offset: number, before: number, after: number]> {
  const out: Array<[number, number, number]> = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) out.push([i, a[i], b[i]]);
  return out;
}

export function u16le(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
}

export function writeU16le(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff;
  data[offset + 1] = (value >>> 8) & 0xff;
}

export function u32le(data: Uint8Array, offset: number): number {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
}

export function writeU32le(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff;
  data[offset + 1] = (value >>> 8) & 0xff;
  data[offset + 2] = (value >>> 16) & 0xff;
  data[offset + 3] = (value >>> 24) & 0xff;
}

export function i32le(data: Uint8Array, offset: number): number {
  return u32le(data, offset) | 0;
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
  return toHex(new Uint8Array(digest));
}
