import { err, ok, ProtocolError, type Result } from '../lib/result';
import { GLOBAL_SIZE, MIDI_CONFIG_SIZE } from '../project/layout';
import { HEARTBEAT_INTERVAL_MS, IDENTITY_INQUIRY, MSG, TE_HEADER } from './constants';
import { decodeFrame, encodeFrame, isTeFrame, type Frame } from './frame';
import { clientHello, decodeIdentityReply, decodeSessionAck, globalUploadFrame, type DeviceIdentity, type SessionAck } from './messages';
import { decodeClientHello, decodeClientStatus, decodeFileRequest, fileRequest, FileDownload, serverAdvertise, serverClose, serverHeartbeat, UploadServer, type HostedFile } from './fileServer';
import { isPatternRejection, PatternBankAssembler, patternUploadFrames, type ReceivedBank } from './patternTransfer';
import type { MidiTransport } from './transport';
import { decompress } from './zlib';

/**
 * Une session StateSync avec l'OP-Z.
 *
 * Lecture : banque ($08→$09/$0A), global ($0C), config MIDI ($0F→$10).
 * Écriture : banque ($09/$0A avec contrôle de flux $0B) et global ($0C).
 * Les écritures ne doivent être appelées QUE par la transaction de
 * src/device/pushToOpz.ts (checkpoint → écriture → relecture → retour arrière).
 *
 * Toute opération passe par `exclusive()` : jamais deux échanges SysEx à la fois.
 * Trame malformée, rejet ou séquence inattendue : l'opération échoue proprement.
 */
export interface SessionOptions {
  timeoutMs?: number;
  /** Silence requis après la rafale d'état qui suit un hello. */
  settleMs?: number;
  heartbeatMs?: number;
  /** Délai pour que l'OP-Z oublie la session (≈5 s ; doc : 6,25 s suffisent). */
  sessionExpireMs?: number;
  clientId?: number;
  log?: (line: string) => void;
}

export type SessionEvent = { kind: 'frame'; frame: Frame } | { kind: 'anomaly'; message: string; data: Uint8Array };

type Handler<T> = (frame: Frame, resolve: (value: T) => void, reject: (error: Error) => void) => boolean | void;

export class OpzSession {
  private readonly transport: MidiTransport;
  private readonly timeoutMs: number;
  private readonly settleMs: number;
  private readonly heartbeatMs: number;
  private readonly sessionExpireMs: number;
  private readonly log: (line: string) => void;
  private clientId: number;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly frameListeners = new Set<(event: SessionEvent) => void>();
  private readonly rawListeners = new Set<(data: Uint8Array) => void>();
  private readonly unsubscribe: () => void;
  private lastFrameAt = 0;
  /** Dernier état spontané reçu (rafale de handshake, télémétrie). */
  readonly latest = new Map<number, Frame>();
  ack: SessionAck | null = null;
  identity: DeviceIdentity | null = null;

  constructor(transport: MidiTransport, options: SessionOptions = {}) {
    this.transport = transport;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.settleMs = options.settleMs ?? 400;
    this.heartbeatMs = options.heartbeatMs ?? HEARTBEAT_INTERVAL_MS;
    this.sessionExpireMs = options.sessionExpireMs ?? 6500;
    this.clientId = options.clientId ?? randomClientId();
    this.log = options.log ?? (() => undefined);
    this.unsubscribe = transport.subscribe((data) => this.onMessage(data));
  }

  onEvent(listener: (event: SessionEvent) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  close(): void {
    this.stopHeartbeat();
    this.unsubscribe();
    this.frameListeners.clear();
    this.rawListeners.clear();
  }

  /** Projet actif sur l'OP-Z d'après le dernier $07 reçu (octet 19), ou null. */
  activeProject(): number | null {
    const f = this.latest.get(MSG.CHAIN_STATE);
    return f && f.payload.length >= 20 ? f.payload[19] : null;
  }

  connect(): Promise<Result<SessionAck, Error>> {
    return this.exclusive('connect', async () => {
      const identity = await this.exchange(IDENTITY_INQUIRY, (d) => d[0] === 0xf0 && d[1] === 0x7e && d[3] === 0x06 && d[4] === 0x02, 'identity reply');
      if (identity.ok) {
        const decoded = decodeIdentityReply(identity.value);
        if (decoded.ok) this.identity = decoded.value;
      } else {
        this.log(`identité : ${identity.error.message} (on continue)`);
      }
      const ack = await this.hello(false, this.timeoutMs, false);
      if (!ack.ok) return ack;
      this.startHeartbeat();
      await this.waitForQuiet();
      return ok(ack.value.ack);
    });
  }

  readPatternBank(): Promise<Result<ReceivedBank, Error>> {
    return this.exclusive('lecture banque', () => this.readBankNow());
  }

  readMidiConfig(): Promise<Result<Uint8Array, Error>> {
    return this.exclusive('lecture config MIDI', async () => {
      const query = encodeFrame(MSG.MIDI_CONFIG_QUERY);
      if (!query.ok) return query;
      return this.collect<Uint8Array>(query.value, (frame, resolve, reject) => {
        if (frame.messageId !== MSG.MIDI_CONFIG) return false;
        const inflated = decompress(frame.payload, MIDI_CONFIG_SIZE);
        if (!inflated.ok) return reject(inflated.error);
        if (inflated.value.length !== MIDI_CONFIG_SIZE) return reject(new ProtocolError(`MIDI config de ${inflated.value.length} octets, attendu ${MIDI_CONFIG_SIZE}`));
        resolve(inflated.value);
        return true;
      });
    });
  }

  /**
   * Bloc global $0C. Il n'y a pas de requête dédiée : l'OP-Z l'envoie une fois
   * par session StateSync (docs/host-write-persistence.md « StateSync Session Rule »).
   * `fresh` = on laisse d'abord expirer la session courante pour garantir une
   * relecture indépendante (obligatoire pour vérifier une écriture).
   */
  readGlobal(fresh = false): Promise<Result<Uint8Array, Error>> {
    return this.exclusive(fresh ? 'lecture globale (session neuve)' : 'lecture globale', () => this.readGlobalNow(fresh));
  }

  /** Upload de la banque ($09…$0A), chaque paquet attendant son $0B. N'effectue AUCUNE vérification : voir pushToOpz. */
  writePatternBank(bank: Uint8Array, address: number, transferId: number): Promise<Result<{ packets: number }, Error>> {
    return this.exclusive('écriture banque', () => this.writeBankNow(bank, address, transferId));
  }

  /** Upload du bloc global $0C (568 octets). N'effectue AUCUNE vérification : voir pushToOpz. */
  writeGlobal(global: Uint8Array): Promise<Result<void, Error>> {
    return this.exclusive('écriture globale', async () => {
      const frame = globalUploadFrame(global);
      if (!frame.ok) return frame;
      this.transport.send(frame.value);
      await sleep(250);
      return ok(undefined);
    });
  }

  /**
   * Lit des fichiers de réglages de l'OP-Z via son serveur de fichiers (lecture seule).
   * La session StateSync est suspendue le temps de l'échange puis rouverte
   * (docs/clean-room-file-transport.md « Transport integration »).
   */
  readDeviceFiles(fileIds: readonly number[]): Promise<Result<Map<number, Uint8Array>, Error>> {
    return this.exclusive('lecture des fichiers de l’OP-Z', () => this.withFileServer(false, async (serverId, clientId) => {
      const files = new Map<number, Uint8Array>();
      for (const id of fileIds) {
        const data = await this.downloadFile(serverId, clientId, id);
        if (!data.ok) return data;
        files.set(id, data.value);
      }
      return ok(files);
    }));
  }

  /**
   * Envoie des fichiers à l'OP-Z par son serveur de fichiers (manifeste syncjob.json
   * puis chaque fichier). N'effectue AUCUNE vérification : réservé à
   * src/device/slotInstall.ts, qui relit et restaure si besoin.
   */
  uploadDeviceFiles(files: HostedFile[]): Promise<Result<void, Error>> {
    return this.exclusive('envoi de fichiers à l’OP-Z', () => this.withFileServer(true, (serverId, clientId) => {
      let server: UploadServer;
      try {
        server = new UploadServer(files);
      } catch (e) {
        return Promise.resolve(err(e instanceof Error ? e : new Error(String(e))));
      }
      return this.serveUpload(serverId, clientId, server);
    }));
  }

  /** Suspend StateSync, ouvre une session du serveur de fichiers, exécute `job`, ferme et reprend StateSync. */
  private async withFileServer<T>(syncActive: boolean, job: (serverId: number, clientId: number) => Promise<Result<T, Error>>): Promise<Result<T, Error>> {
    this.stopHeartbeat();
    const serverId = 0x4000 + Math.floor(Math.random() * 0x3fff);
    let result: Result<T, Error>;
    const advertise = serverAdvertise(serverId);
    if (!advertise.ok) return advertise;
    const client = await this.collect<number>(advertise.value, (f, resolve) => {
      const h = decodeClientHello(f);
      if (!h) return false;
      resolve(h.clientId);
      return true;
    }, 3000);
    if (!client.ok) {
      result = err(new ProtocolError(`l’OP-Z n’a pas répondu au serveur de fichiers (${client.error.message})`));
    } else {
      const beat = serverHeartbeat(serverId, syncActive);
      if (!beat.ok) return beat;
      this.transport.send(beat.value);
      const heartbeat = setInterval(() => this.transport.send(beat.value), 1000);
      try {
        result = await job(serverId, client.value);
      } finally {
        clearInterval(heartbeat);
      }
    }
    const close = serverClose(serverId);
    if (close.ok) this.transport.send(close.value);
    await sleep(300);
    const again = await this.hello(false);
    this.startHeartbeat();
    await this.waitForQuiet();
    if (!again.ok) this.log(`reprise de la session après le serveur de fichiers : ${again.error.message}`);
    return result;
  }

  private serveUpload(serverId: number, clientId: number, server: UploadServer): Promise<Result<void, Error>> {
    return new Promise((settle) => {
      let finished = false;
      let complete = false;
      let lastSent = 0;
      let lastActivity = Date.now();
      const started = Date.now();
      const finish = (r: Result<void, Error>) => {
        if (finished) return;
        finished = true;
        clearInterval(pump);
        stop();
        settle(r);
      };
      const stop = this.onEvent((event) => {
        if (event.kind === 'anomaly') return finish(err(new ProtocolError(event.message)));
        const request = decodeFileRequest(event.frame);
        if (request) {
          if (request.requester !== clientId) return finish(err(new ProtocolError(`demande d’un client inattendu (${request.requester})`)));
          const a = server.accept(request);
          if (!a.ok) return finish(a);
          lastActivity = Date.now();
          return;
        }
        const status = decodeClientStatus(event.frame);
        if (status && status.clientId === clientId) {
          lastActivity = Date.now();
          if (status.status === 127) complete = true;
          else if (status.status >= 1 && status.status <= 126) server.observeCompleted(status.value);
        }
      });
      const pump = setInterval(() => {
        const now = Date.now();
        const interval = server.inFlight >= 33 ? 50 : server.inFlight >= 17 ? 20 : 10;
        if (now - lastSent >= interval) {
          const frame = server.nextFrame(serverId);
          if (!frame.ok) return finish(frame);
          if (frame.value) {
            this.transport.send(frame.value);
            lastSent = now;
            lastActivity = now;
          }
        }
        // « terminé » ($33 = 127) ne suffit pas : chaque fichier doit avoir reçu sa dernière partie.
        if (complete && server.allSent) return finish(ok(undefined));
        if (now - lastActivity > 6000) return finish(err(new ProtocolError('l’OP-Z ne demande plus de données (délai dépassé)')));
        if (now - started > 300_000) return finish(err(new ProtocolError('envoi trop long')));
      }, 5);
    });
  }

  private async downloadFile(serverId: number, clientId: number, fileId: number): Promise<Result<Uint8Array, Error>> {
    const download = new FileDownload(fileId, clientId);
    for (let attempt = 0; attempt < 3; attempt++) {
      const request = fileRequest(serverId, fileId, download.nextPart);
      if (!request.ok) return request;
      const r = await this.collect<Uint8Array>(request.value, (frame, resolve, reject) => {
        if (frame.messageId !== MSG.FILE_DATA) return false;
        const step = download.accept(frame);
        if (!step.ok) return reject(step.error);
        if (step.value.kind === 'done') resolve(step.value.data);
        else if (step.value.kind === 'resend') {
          const again = fileRequest(serverId, fileId, step.value.fromPart);
          if (again.ok) this.transport.send(again.value);
        }
        return step.value.kind !== 'ignore';
      }, 2500);
      if (r.ok) return r;
      if (!/délai/.test(r.error.message)) return r;
      this.log(`fichier ${fileId} : pas de réponse, reprise à la partie ${download.nextPart}`);
    }
    return err(new ProtocolError(`fichier ${fileId} : l’OP-Z ne l’a pas envoyé`));
  }

  // -------------------------------------------------------------------------

  private async readBankNow(): Promise<Result<ReceivedBank, Error>> {
    const query = encodeFrame(MSG.PATTERN_QUERY);
    if (!query.ok) return query;
    const assembler = new PatternBankAssembler();
    return this.collect<ReceivedBank>(query.value, (frame, resolve, reject) => {
      if (isPatternRejection(frame)) return reject(new ProtocolError('OP-Z a rejeté le transfert ($08 FF FF FF FF)'));
      if (frame.messageId !== MSG.PATTERN_PACKET && frame.messageId !== MSG.PATTERN_TERMINATOR) return false;
      if (!assembler.inProgress && frame.payload.length >= 6 && (frame.payload[4] | (frame.payload[5] << 8)) !== 0) return true;
      const step = assembler.accept(frame);
      if (!step.ok) return reject(step.error);
      if (step.value.kind === 'packet') {
        if (step.value.ack) this.transport.send(step.value.ack);
        return true;
      }
      resolve(step.value.received);
      return true;
    });
  }

  private async writeBankNow(bank: Uint8Array, address: number, transferId: number): Promise<Result<{ packets: number }, Error>> {
    const frames = patternUploadFrames(bank, address, transferId);
    if (!frames.ok) return frames;
    const last = frames.value.length - 1;
    for (let index = 0; index <= last; index++) {
      if (index < last) {
        const acked = await this.collect<void>(frames.value[index], (frame, resolve, reject) => {
          if (isPatternRejection(frame)) return reject(new ProtocolError(`OP-Z a rejeté le paquet ${index} ($08 FF FF FF FF)`));
          if (frame.messageId !== MSG.PATTERN_ACK || frame.payload.length < 8) return false;
          const id = frame.payload[4] | (frame.payload[5] << 8);
          const packet = frame.payload[6] | (frame.payload[7] << 8);
          if (id !== transferId || packet !== index) return reject(new ProtocolError(`ACK inattendu (id ${id}, paquet ${packet}) pour le paquet ${index}`));
          resolve();
          return true;
        }, 2000);
        if (!acked.ok) return acked;
      } else {
        // Le terminateur $0A n'est pas forcément acquitté : on guette seulement un rejet.
        const rejected = await this.collect<boolean>(frames.value[index], (frame, resolve) => {
          if (isPatternRejection(frame)) {
            resolve(true);
            return true;
          }
          return false;
        }, 400);
        if (rejected.ok && rejected.value) return err(new ProtocolError('OP-Z a rejeté le terminateur ($08 FF FF FF FF)'));
      }
    }
    await this.waitForQuiet();
    return ok({ packets: frames.value.length });
  }

  private async readGlobalNow(fresh: boolean): Promise<Result<Uint8Array, Error>> {
    if (!fresh) {
      const quick = await this.hello(true, 2500);
      if (quick.ok && quick.value.global) return this.finishGlobal(quick.value.global);
      this.log('bloc global non renvoyé par la session en cours : on attend son expiration');
    }
    this.stopHeartbeat();
    await sleep(this.sessionExpireMs);
    const again = await this.hello(true);
    this.startHeartbeat();
    if (!again.ok) return again;
    if (!again.value.global) return err(new ProtocolError('bloc global absent de la nouvelle session'));
    return this.finishGlobal(again.value.global);
  }

  private async finishGlobal(frame: Frame): Promise<Result<Uint8Array, Error>> {
    await this.waitForQuiet();
    const inflated = decompress(frame.payload, GLOBAL_SIZE);
    if (!inflated.ok) return inflated;
    if (inflated.value.length !== GLOBAL_SIZE) return err(new ProtocolError(`bloc global de ${inflated.value.length} octets, attendu ${GLOBAL_SIZE}`));
    return inflated;
  }

  /**
   * Client hello avec un nouvel id. Résout sur le $01 qui nous répond ; si
   * `wantGlobal`, attend aussi le $0C de la rafale (jusqu'au délai).
   */
  private async hello(wantGlobal: boolean, timeoutMs = this.timeoutMs, newId = true): Promise<Result<{ ack: SessionAck; global: Frame | null }, Error>> {
    if (newId) this.clientId = randomClientId();
    const frame = clientHello(this.clientId);
    if (!frame.ok) return frame;
    let ack: SessionAck | null = null;
    let global: Frame | null = null;
    const r = await this.collect<true>(frame.value, (f, resolve) => {
      if (f.messageId === MSG.SESSION_ACK) {
        const a = decodeSessionAck(f);
        if (!a.ok || a.value.echoedClientId !== this.clientId) return false;
        ack = a.value;
        this.ack = a.value;
      } else if (f.messageId === MSG.GLOBAL_DATA && ack) {
        global = f;
      } else {
        return false;
      }
      if (ack && (!wantGlobal || global)) resolve(true);
      return true;
    }, timeoutMs);
    if (!ack) return r.ok ? err(new ProtocolError('pas de $01')) : r;
    return ok({ ack, global });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      const frame = clientHello(this.clientId);
      if (frame.ok) this.transport.send(frame.value);
    }, this.heartbeatMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private exclusive<T>(name: string, run: () => Promise<Result<T, Error>>, quiet = false): Promise<Result<T, Error>> {
    const next = this.queue.then(async () => {
      if (!quiet) this.log(`▶ ${name}`);
      const result = await run();
      if (!quiet || !result.ok) this.log(result.ok ? `✔ ${name}` : `✖ ${name} : ${result.error.message}`);
      return result;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Envoie `request` puis confie les trames TE à `handle` jusqu'à résolution, rejet ou délai (relancé à chaque trame consommée). */
  private collect<T>(request: Uint8Array, handle: Handler<T>, timeoutMs = this.timeoutMs): Promise<Result<T, Error>> {
    return new Promise((settle) => {
      let finished = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (result: Result<T, Error>): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        stop();
        settle(result);
      };
      const arm = (): void => {
        clearTimeout(timer);
        timer = setTimeout(() => finish(err(new ProtocolError(`délai dépassé (${timeoutMs} ms)`))), timeoutMs);
      };
      const stop = this.onEvent((event) => {
        if (finished) return;
        if (event.kind === 'anomaly') return finish(err(new ProtocolError(event.message)));
        const consumed = handle(event.frame, (v) => finish(ok(v)), (e) => finish(err(e)));
        if (consumed && !finished) arm();
      });
      arm();
      this.transport.send(request);
    });
  }

  private exchange(request: Uint8Array, match: (data: Uint8Array) => boolean, label: string): Promise<Result<Uint8Array, Error>> {
    return new Promise((settle) => {
      const timer = setTimeout(() => {
        this.rawListeners.delete(listener);
        settle(err(new ProtocolError(`${label} : délai dépassé`)));
      }, Math.min(this.timeoutMs, 2000));
      const listener = (data: Uint8Array): void => {
        if (!match(data)) return;
        clearTimeout(timer);
        this.rawListeners.delete(listener);
        settle(ok(data));
      };
      this.rawListeners.add(listener);
      this.transport.send(request);
    });
  }

  private waitForQuiet(): Promise<void> {
    return new Promise((resolve) => {
      const check = (): void => {
        const idle = Date.now() - this.lastFrameAt;
        if (idle >= this.settleMs) resolve();
        else setTimeout(check, this.settleMs - idle);
      };
      setTimeout(check, this.settleMs);
    });
  }

  private onMessage(data: Uint8Array): void {
    if (data.length === 1 && data[0] >= 0xf8) return;
    for (const l of this.rawListeners) l(data);
    if (data[0] !== 0xf0) return;
    if (data.length >= 5 && data[1] === TE_HEADER[1] && data[2] === TE_HEADER[2] && data[3] === TE_HEADER[3]) {
      this.lastFrameAt = Date.now();
      if (!isTeFrame(data)) return this.emit({ kind: 'anomaly', message: 'trame TE malformée', data });
      const frame = decodeFrame(data);
      if (!frame.ok) return this.emit({ kind: 'anomaly', message: frame.error.message, data });
      this.latest.set(frame.value.messageId, frame.value);
      this.emit({ kind: 'frame', frame: frame.value });
    }
  }

  private emit(event: SessionEvent): void {
    if (event.kind === 'anomaly') this.log(`⚠ anomalie : ${event.message}`);
    for (const l of this.frameListeners) l(event);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function randomClientId(): number {
  return 1 + Math.floor(Math.random() * 0xfffe);
}
