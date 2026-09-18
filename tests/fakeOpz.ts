import { concat } from '../src/lib/bytes';
import { unwrap } from '../src/lib/result';
import { MSG } from '../src/midi/constants';
import { decodeFrame, encodeFrame } from '../src/midi/frame';
import { patternUploadFrames } from '../src/midi/patternTransfer';
import type { MidiTransport } from '../src/midi/transport';
import { compress, decompress } from '../src/midi/zlib';
import { PATTERN_BANK_SIZE } from '../src/project/layout';

/**
 * Simulateur d'OP-Z pour les tests, fidèle au comportement documenté :
 *  - identity reply ; $01 + rafale d'état ($07, $0C) au premier hello d'une session ;
 *  - une session expire après `sessionTimeoutMs` sans hello (heartbeat) ;
 *  - dump de banque sur $08, paquet suivant seulement après le $0B de l'hôte ;
 *  - upload de banque : $0B par paquet $09, application du préfixe sur $0A ;
 *  - écriture du global sur $0C ; config MIDI sur $0F ;
 *  - notes MIDI enregistrées dans `notes`.
 */
export interface FakeOpzOptions {
  bank: Uint8Array;
  global: Uint8Array;
  midiConfig: Uint8Array;
  transferId?: number;
  project?: number;
  /** 0 = chaque hello renvoie la rafale. */
  sessionTimeoutMs?: number;
  /** Fichiers servis par le serveur de fichiers : id → contenu. */
  files?: Map<number, Uint8Array>;
  fault?: 'reject' | 'skip-packet' | 'malformed' | 'silent' | 'reject-upload' | 'corrupt-write' | 'ignore-global-write' | 'corrupt-file' | 'stall-file';
}

export class FakeOpz implements MidiTransport {
  readonly name = 'OP-Z (fake)';
  readonly sent: Uint8Array[] = [];
  readonly acks: number[] = [];
  readonly notes: { data: number[]; at: number | null }[] = [];
  bank: Uint8Array;
  global: Uint8Array;
  writes = 0;
  private listeners = new Set<(data: Uint8Array) => void>();
  private pending: Uint8Array[] = [];
  private upload: Uint8Array[] = [];
  private readonly opts: FakeOpzOptions;
  private readonly deviceSession = 0x95f5;
  private lastHelloAt = -Infinity;
  private fileServer: number | null = null;
  private syncing = false;
  private incoming = new Map<number, Uint8Array[]>();
  private pendingFiles: { id: number; path: string }[] = [];
  fileWrites = 0;
  selected: { pattern: number; project: number } | null = null;

  private requestFile(id: number): void {
    const b = Uint8Array.of(0x8b, 0x55, id & 0xff, (id >> 8) & 0xff, (id >> 16) & 0xff, (id >>> 24) & 0xff, 0, 0);
    this.reply(unwrap(encodeFrame(MSG.FILE_REQUEST, b)));
  }

  private nextPendingFile(): void {
    const next = this.pendingFiles[0];
    if (next) return this.requestFile(next.id);
    this.reply(unwrap(encodeFrame(MSG.FILE_CLIENT_STATUS, Uint8Array.of(0x8b, 0x55, 127, 0, 0, 0, 0))));
  }

  constructor(opts: FakeOpzOptions) {
    this.opts = opts;
    this.bank = opts.bank.slice();
    this.global = opts.global.slice();
  }

  subscribe(listener: (data: Uint8Array) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.listeners.clear();
  }

  sendAt(data: Uint8Array, at: number): void {
    if (data[0] === 0xf0) return this.send(data);
    this.notes.push({ data: [...data], at });
  }

  send(data: Uint8Array): void {
    this.sent.push(data);
    if (data[0] !== 0xf0) {
      this.notes.push({ data: [...data], at: null });
      return;
    }
    if (this.opts.fault === 'silent') return;
    if (data[1] === 0x7e && data[3] === 0x06 && data[4] === 0x01) {
      const ascii = [...new TextEncoder().encode('1.2.45')];
      return this.reply(Uint8Array.from([0xf0, 0x7e, 0x7f, 0x06, 0x02, 0x00, 0x20, 0x76, 0x00, ...ascii, 0x00, 0xf7]));
    }
    const frame = unwrap(decodeFrame(data));
    switch (frame.messageId) {
      case MSG.CLIENT_HELLO: {
        const now = Date.now();
        const fresh = !this.opts.sessionTimeoutMs || now - this.lastHelloAt > this.opts.sessionTimeoutMs;
        this.lastHelloAt = now;
        const client = (frame.payload[0] << 8) | frame.payload[1];
        this.reply(frame4(MSG.SESSION_ACK, [this.deviceSession >> 8, this.deviceSession & 0xff, client >> 8, client & 0xff]));
        if (fresh) {
          const chain = new Uint8Array(20);
          chain[19] = this.opts.project ?? 2;
          this.reply(unwrap(encodeFrame(MSG.CHAIN_STATE, chain)));
          this.reply(unwrap(encodeFrame(MSG.GLOBAL_DATA, compress(this.global))));
        }
        return;
      }
      case MSG.PATTERN_QUERY: {
        if (this.opts.fault === 'reject') return this.reply(frame4(MSG.PATTERN_QUERY, [0xff, 0xff, 0xff, 0xff]));
        this.pending = unwrap(patternUploadFrames(this.bank, ((this.opts.project ?? 2) << 4) | 0, this.opts.transferId ?? 0x0777));
        if (this.opts.fault === 'skip-packet') this.pending.splice(1, 1);
        return this.next();
      }
      case MSG.PATTERN_ACK: {
        this.acks.push(frame.payload[6] | (frame.payload[7] << 8));
        return this.next();
      }
      case MSG.PATTERN_PACKET:
      case MSG.PATTERN_TERMINATOR: {
        const index = frame.payload[4] | (frame.payload[5] << 8);
        if (index === 0) this.upload = [];
        if (this.opts.fault === 'reject-upload' && index === 1) return this.reply(frame4(MSG.PATTERN_QUERY, [0xff, 0xff, 0xff, 0xff]));
        if (index !== this.upload.length) return this.reply(frame4(MSG.PATTERN_QUERY, [0xff, 0xff, 0xff, 0xff]));
        this.upload.push(frame.payload.subarray(6));
        if (frame.messageId === MSG.PATTERN_PACKET) {
          return this.reply(frame4(MSG.PATTERN_ACK, [0x09, 0, 0, 0, frame.payload[2], frame.payload[3], frame.payload[4], frame.payload[5]]));
        }
        const prefix = unwrap(decompress(concat(this.upload), PATTERN_BANK_SIZE));
        this.bank.set(prefix, 0);
        this.writes++;
        if (this.opts.fault === 'corrupt-write' && this.writes === 1) this.bank[1000] ^= 0xff;
        return;
      }
      case MSG.GLOBAL_DATA:
        if (this.opts.fault !== 'ignore-global-write') this.global = unwrap(decompress(frame.payload, 568));
        return;
      case MSG.FILE_SERVER_ADVERTISE: {
        this.fileServer = frame.payload[0] | (frame.payload[1] << 8);
        return this.reply(unwrap(encodeFrame(MSG.FILE_CLIENT_HELLO, Uint8Array.of(0x8b, 0x55, 0x7d, 0x84, 0x0b, 0x2e))));
      }
      case MSG.FILE_REQUEST: {
        const fileId = frame.payload[2] | (frame.payload[3] << 8) | (frame.payload[4] << 16) | (frame.payload[5] << 24);
        const from = frame.payload[6] | (frame.payload[7] << 8);
        const content = this.opts.files?.get(fileId >>> 0);
        if (!content || this.fileServer === null) return;
        const parts = Math.max(1, Math.ceil(content.length / 200));
        for (let part = from; part < parts; part++) {
          const chunk = content.subarray(part * 200, part * 200 + 200);
          const head = Uint8Array.of(0x8b, 0x55, fileId & 0xff, (fileId >> 8) & 0xff, (fileId >> 16) & 0xff, (fileId >>> 24) & 0xff, part & 0xff, part >> 8, part === parts - 1 ? 1 : 0);
          this.reply(unwrap(encodeFrame(MSG.FILE_DATA, concat([head, compress(chunk)]))));
        }
        return;
      }
      case MSG.FILE_SERVER_HEARTBEAT: {
        // sync-active = 1 ⇒ l'OP-Z demande le manifeste (fichier réservé 2)
        if (frame.payload[2] === 1 && !this.syncing) {
          this.syncing = true;
          this.incoming = new Map();
          this.requestFile(2);
        }
        return;
      }
      case MSG.FILE_DATA: {
        const p = frame.payload;
        const fileId = (p[2] | (p[3] << 8) | (p[4] << 16) | (p[5] << 24)) >>> 0;
        const part = p[6] | (p[7] << 8);
        const chunks = this.incoming.get(fileId) ?? [];
        if (part !== chunks.length) return;
        chunks.push(unwrap(decompress(p.subarray(9), 200)));
        this.incoming.set(fileId, chunks);
        if (!p[8]) return;
        const data = concat(chunks);
        if (fileId === 2) {
          const job = JSON.parse(new TextDecoder().decode(data)) as { files: { fileId: number; path: string }[] };
          this.pendingFiles = job.files.map((f) => ({ id: f.fileId, path: f.path }));
          if (this.opts.fault === 'stall-file') return;
          return this.nextPendingFile();
        }
        const entry = this.pendingFiles.find((f) => f.id === fileId);
        if (entry) {
          const stored = data.slice();
          if (this.opts.fault === 'corrupt-file' && this.fileWrites === 0) stored[stored.length - 2] ^= 0x01;
          this.fileWrites++;
          const reserved = { 'settings/slotconfiguration.json': 0, 'settings/plugs.json': 1 } as Record<string, number>;
          const target = reserved[entry.path.toLowerCase()] ?? fileId;
          this.opts.files?.set(target, stored);
          this.pendingFiles = this.pendingFiles.filter((f) => f !== entry);
        }
        return this.nextPendingFile();
      }
      case MSG.FILE_SERVER_CLOSE:
        this.fileServer = null;
        this.syncing = false;
        return;
      case MSG.CHAIN_STATE: {
        const echo = frame.payload.slice();
        this.selected = { pattern: echo[17] & 0x0f, project: echo[19] };
        return this.reply(unwrap(encodeFrame(MSG.CHAIN_STATE, echo)));
      }
      case MSG.MIDI_CONFIG_QUERY:
        if (this.opts.fault === 'malformed') return this.reply(Uint8Array.of(0xf0, 0x00, 0x20, 0x76, 0x01, 0x10, 0x80, 0xf7));
        return this.reply(unwrap(encodeFrame(MSG.MIDI_CONFIG, compress(this.opts.midiConfig))));
      default:
    }
  }

  private next(): void {
    const frame = this.pending.shift();
    if (frame) this.reply(frame);
  }

  private reply(data: Uint8Array): void {
    setTimeout(() => {
      for (const l of this.listeners) l(data);
    }, 1);
  }
}

function frame4(id: number, payload: number[]): Uint8Array {
  return unwrap(encodeFrame(id, Uint8Array.from(payload)));
}
