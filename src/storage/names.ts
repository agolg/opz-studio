/**
 * Noms donnés par l'utilisateur aux projets (1..10) et aux patterns (1..16) de SON OP-Z.
 * L'OP-Z ne stocke aucun nom : ils ne vivent que dans l'éditeur (ce navigateur),
 * et sont recopiés dans le .opzproject à l'enregistrement (meta.pattern_names).
 * Clé : numéro de projet de l'appareil (0..9, télémétrie $07).
 */
const KEY = 'opz-studio-names';

interface NameStore { projects: Record<string, string>; patterns: Record<string, string[]> }

function load(): NameStore {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Partial<NameStore>) : {};
    return { projects: v.projects ?? {}, patterns: v.patterns ?? {} };
  } catch {
    return { projects: {}, patterns: {} };
  }
}

function save(store: NameStore): void {
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* stockage indisponible : noms non retenus */ }
}

export const projectName = (project: number): string => load().projects[String(project)] ?? '';
export const patternNames = (project: number): string[] => {
  const list = load().patterns[String(project)] ?? [];
  return Array.from({ length: 16 }, (_, i) => list[i] ?? '');
};

export function setProjectName(project: number, name: string): void {
  const s = load();
  s.projects[String(project)] = name.trim();
  save(s);
}

export function setPatternNames(project: number, names: string[]): void {
  const s = load();
  s.patterns[String(project)] = names.slice(0, 16).map((n) => n.trim());
  save(s);
}

export const allProjectNames = (): string[] => Array.from({ length: 10 }, (_, i) => projectName(i));
