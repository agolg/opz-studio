import { concat, u16le, u32le, writeU16le, writeU32le } from '../lib/bytes';
import { ok, protocolError, type ProtocolError, type Result } from '../lib/result';
import { MSG } from './constants';
import { crc32, fileId as pathFileId } from './fileId';
import { encodeFrame, type Frame } from './frame';
import { compress as compressPart, decompress } from './zlib';

/**
 * Serveur de fichiers SysEx de l'OP-Z (LECTURE uniquement ici).
 * Source : op-z-sysex docs/clean-room-file-transport.md, opzsysex/fileprotocol.py.
 *
 * L'hôte joue le rôle de « serveur » : $51 annonce → l'OP-Z répond $34 →
 * l'hôte envoie $52 (sync inactive) puis $35 pour demander un fichier →
 * l'OP-Z envoie des $53 (≤ 200 octets décompressés chacun, zlib par partie) →
 * $55 ferme la session.
 */
export const FILE_PART_SIZE = 200;
export const FILE_ID = { SLOT_CONFIGURATION: 0, PLUGS: 1 } as const;

const u16 = (v: number) => { const b = new Uint8Array(2); writeU16le(b, 0, v); return b; };
const u32 = (v: number) => { const b = new Uint8Array(4); writeU32le(b, 0, v); return b; };

export const serverAdvertise = (serverId: number) => encodeFrame(MSG.FILE_SERVER_ADVERTISE, u16(serverId));
export const serverHeartbeat = (serverId: number, syncActive = false) => encodeFrame(MSG.FILE_SERVER_HEARTBEAT, concat([u16(serverId), Uint8Array.of(syncActive ? 1 : 0)]));
export const serverClose = (serverId: number) => encodeFrame(MSG.FILE_SERVER_CLOSE, u16(serverId));
export const fileRequest = (requesterId: number, fileId: number, part: number) => encodeFrame(MSG.FILE_REQUEST, concat([u16(requesterId), u32(fileId), u16(part)]));

export interface ClientHello { clientId: number; stateCrc: number }

export function decodeClientHello(frame: Frame): ClientHello | null {
  if (frame.messageId !== MSG.FILE_CLIENT_HELLO || frame.payload.length < 6) return null;
  return { clientId: u16le(frame.payload, 0), stateCrc: u32le(frame.payload, 2) };
}

export interface FilePart { sender: number; fileId: number; part: number; last: boolean; data: Uint8Array }

export function decodeFilePart(frame: Frame): Result<FilePart, ProtocolError> {
  if (frame.messageId !== MSG.FILE_DATA || frame.payload.length < 9) return protocolError('partie de fichier $53 invalide');
  const data = decompress(frame.payload.subarray(9), FILE_PART_SIZE);
  if (!data.ok) return data;
  const p = frame.payload;
  return ok({ sender: u16le(p, 0), fileId: u32le(p, 2), part: u16le(p, 6), last: p[8] !== 0, data: data.value });
}

export type DownloadStep =
  | { kind: 'ignore' }
  | { kind: 'progress'; part: number }
  | { kind: 'resend'; fromPart: number }
  | { kind: 'done'; data: Uint8Array };

/**
 * Réassemblage strict d'un fichier : parties dans l'ordre, doublons ignorés,
 * trou ⇒ demande de renvoi à partir de la partie attendue ($35 sert de curseur).
 */
export class FileDownload {
  private parts: Uint8Array[] = [];
  private readonly maxBytes: number;
  readonly fileId: number;
  readonly clientId: number;

  constructor(fileId: number, clientId: number, maxBytes = 2_000_000) {
    this.fileId = fileId;
    this.clientId = clientId;
    this.maxBytes = maxBytes;
  }

  get nextPart(): number {
    return this.parts.length;
  }

  accept(frame: Frame): Result<DownloadStep, ProtocolError> {
    if (frame.messageId !== MSG.FILE_DATA) return ok({ kind: 'ignore' });
    const part = decodeFilePart(frame);
    if (!part.ok) return part;
    const p = part.value;
    if (p.fileId !== this.fileId) return ok({ kind: 'ignore' });
    if (p.sender !== this.clientId) return protocolError(`partie envoyée par un client inattendu (${p.sender})`);
    if (p.part < this.parts.length) return ok({ kind: 'ignore' });
    if (p.part > this.parts.length) return ok({ kind: 'resend', fromPart: this.parts.length });
    this.parts.push(p.data);
    if (this.parts.length * FILE_PART_SIZE > this.maxBytes) return protocolError('fichier trop volumineux');
    if (p.last) return ok({ kind: 'done', data: concat(this.parts) });
    return ok({ kind: 'progress', part: p.part });
  }
}

// ---------------------------------------------------------------------------
// Envoi de fichiers (port de opzsysex/fileprotocol.py UploadState)
// ---------------------------------------------------------------------------


export const SYNC_JOB_ID = 2;
export const MAX_IN_FLIGHT_PARTS = 64;

export interface HostedFile { path: string; data: Uint8Array }
interface Descriptor { fileId: number; path: string; crc: number; size: number }

/** $33 : statut du client (255 = CRC d'état, 1..126 = parties reçues, 127 = terminé). */
export interface ClientStatus { clientId: number; status: number; value: number }
export function decodeClientStatus(frame: Frame): ClientStatus | null {
  if (frame.messageId !== MSG.FILE_CLIENT_STATUS || frame.payload.length < 7) return null;
  return { clientId: u16le(frame.payload, 0), status: frame.payload[2], value: u32le(frame.payload, 3) };
}

export function decodeFileRequest(frame: Frame): { requester: number; fileId: number; part: number } | null {
  if (frame.messageId !== MSG.FILE_REQUEST || frame.payload.length !== 8) return null;
  return { requester: u16le(frame.payload, 0), fileId: u32le(frame.payload, 2), part: u16le(frame.payload, 6) };
}

/**
 * Sert des fichiers à l'OP-Z : il demande d'abord syncjob.json (id 2, le manifeste),
 * puis chaque fichier listé ; `nextFrame()` produit la partie suivante à envoyer.
 */
export class UploadServer {
  readonly descriptors: Descriptor[] = [];
  readonly syncJob: Uint8Array;
  private readonly files = new Map<number, Uint8Array>();
  private active: number | null = null;
  private part = 0;
  private sentLast = new Set<number>();
  private sentParts = 0;
  private completed = 0;

  constructor(files: HostedFile[]) {
    for (const f of files) {
      if (!f.data.length) throw new Error(`fichier vide : ${f.path}`);
      const id = pathFileId(f.path);
      this.files.set(id, f.data);
      this.descriptors.push({ fileId: id, path: f.path, crc: crc32(f.data), size: f.data.length });
    }
    // Clés triées et JSON compact, comme json.dumps(sort_keys=True, separators=(",", ":")).
    const entries = this.descriptors.map((d) => `{"crc":${d.crc},"fileId":${d.fileId},"path":${JSON.stringify(d.path)},"size":${d.size}}`);
    this.syncJob = new TextEncoder().encode(`{"files":[${entries.join(',')}]}`);
  }

  get allSent(): boolean {
    return this.descriptors.every((d) => this.sentLast.has(d.fileId));
  }

  get inFlight(): number {
    return Math.max(0, this.sentParts - this.completed);
  }

  observeCompleted(count: number): void {
    this.completed = Math.max(this.completed, count);
  }

  /** $35 reçu : le client demande `fileId` à partir de `part` (sert aussi de reprise). */
  accept(request: { fileId: number; part: number }): Result<void, ProtocolError> {
    if (request.fileId !== SYNC_JOB_ID && !this.files.has(request.fileId)) return protocolError(`fichier demandé inconnu (${request.fileId})`);
    this.active = request.fileId;
    this.part = request.part;
    return ok(undefined);
  }

  nextFrame(serverId: number): Result<Uint8Array | null, ProtocolError> {
    if (this.active === null || this.inFlight >= MAX_IN_FLIGHT_PARTS) return ok(null);
    const data = this.active === SYNC_JOB_ID ? this.syncJob : this.files.get(this.active)!;
    const start = this.part * FILE_PART_SIZE;
    if (start >= data.length) return protocolError(`partie ${this.part} au-delà du fichier ${this.active}`);
    const end = Math.min(start + FILE_PART_SIZE, data.length);
    const last = end === data.length;
    const head = concat([u16(serverId), u32(this.active), u16(this.part), Uint8Array.of(last ? 1 : 0)]);
    const frame = encodeFrame(MSG.FILE_DATA, concat([head, compressPart(data.subarray(start, end))]));
    if (!frame.ok) return frame;
    this.sentParts++;
    if (last) {
      if (this.active !== SYNC_JOB_ID) this.sentLast.add(this.active);
      this.active = null;
    } else {
      this.part++;
    }
    return ok(frame.value);
  }
}
