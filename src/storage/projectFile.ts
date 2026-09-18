import { err, ok, type Result } from '../lib/result';
import { parseProject, PROJECT_EXTENSION, serializeProject, type OpzProject } from '../project/opzProject';

/**
 * Lecture / écriture du `.opzproject` sur le disque de l'utilisateur.
 * Chrome/Edge : File System Access API (on garde le « handle » pour réenregistrer
 * au même endroit sans redemander). Autres navigateurs : upload / téléchargement.
 */

// Types minimaux : les sélecteurs de fichiers ne sont pas encore dans lib.dom.
interface FilePickerType { description: string; accept: Record<string, string[]> }
interface PickerWindow {
  showOpenFilePicker(options: { types: FilePickerType[]; multiple?: boolean }): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker(options: { types: FilePickerType[]; suggestedName?: string }): Promise<FileSystemFileHandle>;
}

const TYPES: FilePickerType[] = [{ description: 'Projet OP-Z Studio', accept: { 'application/json': [PROJECT_EXTENSION] } }];

export function fileAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window && 'showSaveFilePicker' in window;
}

const picker = (): PickerWindow => window as unknown as PickerWindow;
const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

export interface OpenedProject {
  project: OpzProject;
  handle: FileSystemFileHandle | null;
  fileName: string;
}

/** `ok(null)` = l'utilisateur a annulé. */
export async function openProjectFile(): Promise<Result<OpenedProject | null, Error>> {
  let file: File | null;
  let handle: FileSystemFileHandle | null = null;
  try {
    if (fileAccessSupported()) {
      [handle] = await picker().showOpenFilePicker({ types: TYPES });
      file = await handle.getFile();
    } else {
      file = await pickWithInput();
    }
  } catch (e) {
    if (isAbort(e)) return ok(null);
    return err(new Error(`Ouverture impossible : ${e instanceof Error ? e.message : String(e)}`));
  }
  if (!file) return ok(null);
  const project = parseProject(await file.text());
  if (!project.ok) return err(new Error(`${file.name} : ${project.error.message}`));
  return ok({ project: project.value, handle, fileName: file.name });
}

export interface SavedProject {
  handle: FileSystemFileHandle | null;
  fileName: string;
  project: OpzProject;
}

/** Enregistre (réutilise `handle`) ou « Enregistrer sous » (`handle` null). `ok(null)` = annulé. */
export async function saveProjectFile(project: OpzProject, handle: FileSystemFileHandle | null): Promise<Result<SavedProject | null, Error>> {
  const text = serializeProject(project);
  const saved = JSON.parse(text) as OpzProject; // porte la date de modification écrite
  const suggestedName = `${safeName(project.meta.name)}${PROJECT_EXTENSION}`;
  try {
    if (fileAccessSupported()) {
      const target = handle ?? (await picker().showSaveFilePicker({ types: TYPES, suggestedName }));
      const writable = await target.createWritable();
      await writable.write(text);
      await writable.close();
      return ok({ handle: target, fileName: target.name, project: saved });
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return ok({ handle: null, fileName: suggestedName, project: saved });
  } catch (e) {
    if (isAbort(e)) return ok(null);
    return err(new Error(`Enregistrement impossible : ${e instanceof Error ? e.message : String(e)}`));
  }
}

function safeName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'projet';
}

function pickWithInput(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${PROJECT_EXTENSION},application/json`;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
