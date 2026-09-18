import { useCallback, useEffect, useRef, useState } from 'react';
import { bytesEqual } from '../lib/bytes';
import type { Result } from '../lib/result';
import { bytesToProject, newProject, projectToBytes, rebaseProject, type OpzProject, type ProjectBytes } from '../project/opzProject';
import { openProjectFile, saveProjectFile } from '../storage/projectFile';

/** État du projet ouvert : fichier, modifications non enregistrées, vérification d'intégrité. */
export interface IntegrityCheck {
  ok: boolean;
  message: string;
}

export function useProject(log: (line: string) => void, ask: (o: { title: string; message?: string; confirm?: string; tone?: 'normal' | 'danger' }) => Promise<boolean>) {
  const [project, setProject] = useState<OpzProject | null>(null);
  const [handle, setHandle] = useState<FileSystemFileHandle | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [integrity, setIntegrity] = useState<IntegrityCheck | null>(null);

  const [past, setPast] = useState<OpzProject[]>([]);
  const [future, setFuture] = useState<OpzProject[]>([]);
  // Toujours la dernière version, pour le lecteur qui la relit à chaque tour de pattern.
  const latest = useRef<OpzProject | null>(null);
  latest.current = project;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const confirmDiscard = useCallback(
    async () => !dirty || ask({ title: 'Modifications non enregistrées', message: 'Le projet ouvert a des modifications qui ne sont pas enregistrées dans un fichier. Les abandonner ?', confirm: 'Abandonner', tone: 'danger' }),
    [dirty, ask],
  );

  const load = useCallback((p: OpzProject, h: FileSystemFileHandle | null, name: string | null, isDirty: boolean) => {
    setPast([]);
    setFuture([]);
    setProject(p);
    setHandle(h);
    setFileName(name);
    setDirty(isDirty);
  }, []);

  const createNew = useCallback(async () => {
    if (!(await confirmDiscard())) return;
    load(newProject(), null, null, false);
    setIntegrity(null);
    log('Nouveau projet vierge.');
  }, [confirmDiscard, load, log]);

  const importFromDevice = useCallback(async (bytes: ProjectBytes, firmware: string | undefined, opzProject?: number, catalog?: OpzProject['device_catalog'], extra?: { device_project?: number; pattern_names?: string[]; name?: string; skipConfirm?: boolean }): Promise<boolean> => {
    if (!extra?.skipConfirm && !(await confirmDiscard())) return false;
    const name = extra?.name || `Import OP-Z ${new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`;
    const p = bytesToProject(bytes, {
      name, source: 'opz-import', firmware, imported_at: new Date().toISOString(), opz_project: opzProject,
      ...(extra?.device_project !== undefined ? { device_project: extra.device_project } : {}),
      ...(extra?.pattern_names ? { pattern_names: extra.pattern_names } : {}),
    });
    if (!p.ok) { log(`Import impossible : ${p.error.message}`); return false; }
    // Critère phase 1 : le projet doit reconstruire exactement les octets lus.
    const rebuilt = projectToBytes(p.value);
    const same = rebuilt.ok && bytesEqual(rebuilt.value.bank, bytes.bank) && bytesEqual(rebuilt.value.global, bytes.global) &&
      (!bytes.midiConfig || (rebuilt.value.midiConfig !== null && bytesEqual(rebuilt.value.midiConfig, bytes.midiConfig)));
    setIntegrity(same
      ? { ok: true, message: 'Vérifié : le projet reconstruit exactement les octets lus sur l’OP-Z.' }
      : { ok: false, message: 'Attention : la reconstruction diffère des octets lus. Ne pas se fier à ce projet.' });
    load(catalog ? { ...p.value, device_catalog: catalog } : p.value, null, null, true);
    log(`Projet importé depuis l’OP-Z${same ? ' (intégrité vérifiée)' : ' — ÉCART DÉTECTÉ'}.`);
    return true;
  }, [confirmDiscard, load, log]);

  const open = useCallback(async () => {
    if (!(await confirmDiscard())) return;
    const r = await openProjectFile();
    if (!r.ok) return log(r.error.message);
    if (!r.value) return;
    load(r.value.project, r.value.handle, r.value.fileName, false);
    setIntegrity({ ok: true, message: 'Fichier valide : structure vérifiée et reconstruction complète réussie.' });
    log(`Ouvert : ${r.value.fileName}`);
  }, [confirmDiscard, load, log]);

  const save = useCallback(async (saveAs = false) => {
    if (!project) return;
    const r = await saveProjectFile(project, saveAs ? null : handle);
    if (!r.ok) return log(r.error.message);
    if (!r.value) return;
    // Enregistrer ne vide pas l'historique d'annulation.
    setProject(r.value.project);
    setHandle(r.value.handle);
    setFileName(r.value.fileName);
    setDirty(false);
    log(`Enregistré : ${r.value.fileName}`);
  }, [project, handle, log]);

  /** Applique une modification (fonctions de project/edit.ts) avec historique d'annulation. */
  const update = useCallback((fn: (p: OpzProject) => Result<OpzProject, Error>): boolean => {
    const current = latest.current;
    if (!current) return false;
    const next = fn(current);
    if (!next.ok) {
      log(next.error.message);
      return false;
    }
    setPast((h) => [...h.slice(-199), current]);
    setFuture([]);
    latest.current = next.value;
    setProject(next.value);
    setDirty(true);
    return true;
  }, [log]);

  const undo = useCallback(() => {
    setPast((h) => {
      if (!h.length || !latest.current) return h;
      const prev = h[h.length - 1];
      setFuture((f) => [latest.current as OpzProject, ...f]);
      latest.current = prev;
      setProject(prev);
      setDirty(true);
      return h.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length || !latest.current) return f;
      const next = f[0];
      setPast((h) => [...h, latest.current as OpzProject]);
      latest.current = next;
      setProject(next);
      setDirty(true);
      return f.slice(1);
    });
  }, []);

  /** Après un envoi confirmé : la référence brute devient l'état écrit dans l'OP-Z (sans toucher à l'historique). */
  const rebase = useCallback((bytes: { bank: Uint8Array; global?: Uint8Array | null }) => {
    const current = latest.current;
    if (!current) return;
    const next = rebaseProject(current, bytes);
    latest.current = next;
    setProject(next);
    setDirty(true);
  }, []);

  const rename = useCallback((name: string) => {
    setProject((p) => (p ? { ...p, meta: { ...p.meta, name } } : p));
    setDirty(true);
  }, []);

  // Ctrl+S / Ctrl+Maj+S, Ctrl+Z / Ctrl+Y (hors champs de saisie pour l'annulation)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        void save(e.shiftKey);
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, undo, redo]);

  return { project, latest, update, rebase, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0, fileName, dirty, integrity, canSaveInPlace: handle !== null, createNew, importFromDevice, open, save, rename };
}
