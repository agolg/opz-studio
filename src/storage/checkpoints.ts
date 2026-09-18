import { err, ok, type Result } from '../lib/result';
import { compress, decompress } from '../midi/zlib';
import type { Checkpoint } from '../device/pushToOpz';

/**
 * Checkpoints de l'OP-Z (état avant chaque écriture), conservés dans IndexedDB :
 * ils survivent à un rechargement ou à un plantage de la page. Les 30 derniers sont gardés.
 */
const DB = 'opz-studio';
const STORE = 'checkpoints';
const KEEP = 30;

interface Stored {
  id: string;
  createdAt: string;
  label: string;
  address: number;
  transferId: number;
  bank: Uint8Array | null;
  global: Uint8Array | null;
  slotConfiguration?: Uint8Array | null;
}

export interface CheckpointSummary {
  id: string;
  createdAt: string;
  label: string;
  project: number;
  hasBank: boolean;
  hasGlobal: boolean;
  hasSlots: boolean;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB indisponible'));
  });
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error('transaction IndexedDB échouée')); };
  }));
}

export async function saveCheckpoint(cp: Checkpoint): Promise<Result<void, Error>> {
  try {
    const stored: Stored = { ...cp, bank: cp.bank ? compress(cp.bank) : null, global: cp.global ? compress(cp.global) : null, slotConfiguration: cp.slotConfiguration ?? null };
    await run('readwrite', (s) => s.put(stored));
    const all = await listCheckpoints();
    for (const old of all.slice(KEEP)) await run('readwrite', (s) => s.delete(old.id));
    return ok(undefined);
  } catch (e) {
    return err(new Error(`IndexedDB : ${e instanceof Error ? e.message : String(e)}`));
  }
}

export async function listCheckpoints(): Promise<CheckpointSummary[]> {
  try {
    const all = await run<Stored[]>('readonly', (s) => s.getAll() as IDBRequest<Stored[]>);
    return all
      .map((c) => ({ id: c.id, createdAt: c.createdAt, label: c.label, project: (c.address >> 4) & 0x0f, hasBank: c.bank !== null, hasGlobal: c.global !== null, hasSlots: !!c.slotConfiguration }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

export async function loadCheckpoint(id: string): Promise<Result<Checkpoint, Error>> {
  try {
    const c = await run<Stored | undefined>('readonly', (s) => s.get(id) as IDBRequest<Stored | undefined>);
    if (!c) return err(new Error(`checkpoint ${id} introuvable`));
    let bank: Uint8Array | null = null;
    if (c.bank) {
      const b = decompress(c.bank);
      if (!b.ok) return b;
      bank = b.value;
    }
    let global: Uint8Array | null = null;
    if (c.global) {
      const g = decompress(c.global);
      if (!g.ok) return g;
      global = g.value;
    }
    return ok({ ...c, bank, global, slotConfiguration: c.slotConfiguration ?? null });
  } catch (e) {
    return err(new Error(`IndexedDB : ${e instanceof Error ? e.message : String(e)}`));
  }
}
