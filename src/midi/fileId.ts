/**
 * File-server identifiers. opzsysex/fileprotocol.py file_id / download_file_id.
 * file_id = CRC-32 (zlib polynomial) of the lower-cased UTF-8 path.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function fileId(path: string): number {
  return crc32(new TextEncoder().encode(path.toLowerCase()));
}

/** Reserved ids for the three well-known files. opzsysex/fileprotocol.py */
const RESERVED: Record<string, number> = {
  'settings/slotconfiguration.json': 0,
  'settings/plugs.json': 1,
  'syncjob.json': 2,
};

export function downloadFileId(path: string): number {
  return RESERVED[path.toLowerCase()] ?? fileId(path);
}
