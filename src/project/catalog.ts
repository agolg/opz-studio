import { TRACK_COUNT } from './layout';

/**
 * Catalogue des sons de l'OP-Z, lu dans ses fichiers de réglages :
 *  - settings/slotConfiguration.json : les 10 emplacements de chaque piste
 *    (forme connue : { tracks: [{ index, packs: [{ id, slot }] }] }, cf. op-z-sysex tools/opz-slot-map-edit.py) ;
 *  - settings/plugs.json : la liste des sons (plugs). Sa structure exacte n'est pas
 *    documentée publiquement : on la lit de façon tolérante et on garde le texte brut.
 */
export interface PlugInfo {
  id: number;
  name: string;
  /** Catégorie si le fichier en donne une (type, category…). */
  kind: string | null;
  /** Moteur sonore (ex. « sampleplayergain » = lecteur de samples), si connu. */
  engine: string | null;
  /** false quand le fichier ne donne aucun nom : on n'invente pas un nom à partir du moteur. */
  named: boolean;
  /** Description courte (moteur) ou catégorie (kit : grosses caisses, caisses claires…). */
  description?: string | null;
}

export interface SlotRef {
  slot: number; // 1..10
  id: number;
}

export interface DeviceCatalog {
  plugs: Map<number, PlugInfo>;
  /** piste (0..15) → emplacements. */
  slots: Map<number, SlotRef[]>;
}

export interface RawCatalog {
  plugs_json: string | null;
  slots_json: string | null;
  read_at: string;
}

const NAME_KEYS = ['name', 'displayName', 'display_name', 'title', 'label', 'packName', 'pack_name'];
const KIND_KEYS = ['type', 'kind', 'category', 'group', 'engineType', 'engine_type'];
// Où chercher un nom lisible quand il n'y a pas de champ « name » : pack, preset, sample… avant le moteur.
const PATH_KEYS = ['pack', 'packPath', 'samplepack', 'samplePack', 'preset', 'presetPath', 'patch', 'sample', 'samplePath', 'file', 'path'];
const ID_KEYS = ['id', 'plugId', 'plug_id', 'plugID', 'uid'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const asId = (v: unknown): number | null => {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 0xffffffff ? n : null;
};
const firstString = (o: Record<string, unknown>, keys: string[]): string | null => {
  for (const k of keys) if (typeof o[k] === 'string' && (o[k] as string).trim()) return (o[k] as string).trim();
  return null;
};
const baseName = (path: string) => path.split('/').pop()!.replace(/\.[a-z0-9]+$/i, '');
/** « 01-boom_kit » → « Boom kit » */
const prettify = (s: string) => {
  const t = s.replace(/^\d+[-_ .]*/, '').replace(/[-_]+/g, ' ').trim() || s;
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Description lisible du moteur. */
export function engineLabel(engine: string | null): string | null {
  if (!engine) return null;
  if (/sampleplayer|sampler|drum/i.test(engine)) return 'lecteur de samples';
  return prettify(engine);
}

/**
 * Noms officiels des moteurs (guide OP-Z de Teenage Engineering, page « reference »)
 * rapprochés des fichiers engines/*.engine lus sur l'appareil. Descriptions seulement quand elles sont sûres.
 */
const ENGINES: Record<string, [string, string | null]> = {
  analoga: ['Analog', 'saw, sub et bruit avec enveloppe de filtre'],
  cluster: ['Cluster', 'oscillateurs groupés'],
  digital: ['Digital', 'moteur numérique brut'],
  electric: ['Electric', 'complexe et évolutif'],
  saw013a: ['Saw', 'ondes filtrées'],
  volt: ['Volt', 'synthèse électrique multi-oscillateurs'],
  organ: ['Organ', '8 algorithmes d’orgue FM'],
  ep: ['EP', '8 algorithmes de piano électrique FM'],
  ministringshort: ['String', 'synthèse de cordes'],
  dxfm: ['FM', 'synthèse FM'],
  fmedit: ['FM Edit', null],
  fmedit2: ['FM Edit 2', null],
  fm003b: ['FM 003', null],
  lead: ['Lead', null],
  chord: ['Chord', null],
  synthsampler: ['Sample', 'lecteur d’échantillon mélodique'],
  delay: ['Delay', 'écho numérique'],
  reverb: ['Reverb', 'réverbération claire, légèrement modulée'],
  fdnreverb: ['Rymd', 'réverbération numérique'],
  dist: ['Dist', 'distorsion overdrive'],
  crush: ['Crush', 'écrasement vectoriel'],
  chorus2: ['Chorus-80', 'chorus à l’ancienne'],
  chorus: ['Chorus', null],
  tapetwo: ['Tape', 'effets de bande'],
  bode: ['Bode', null],
};

const SYNTH_ENGINES = new Set(['analoga', 'cluster', 'digital', 'electric', 'saw013a', 'volt', 'organ', 'ep', 'ministringshort', 'dxfm', 'fmedit', 'fmedit2', 'fm003b', 'lead', 'chord', 'synthsampler']);
const FX_ENGINES = new Set(['delay', 'reverb', 'fdnreverb', 'dist', 'crush', 'chorus2', 'bode']);

/** « AlainKicks » → « Alain Kicks », « TeSnares » → « TE Snares », « zVinyl » → « Vinyl ». */
function sampleName(path: string): string {
  if (/\/user\//i.test(path)) return 'Sample perso';
  let b = baseName(path).replace(/^z(?=[A-Z])/, '');
  b = b.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^Te\b/, 'TE').trim();
  return b.charAt(0).toUpperCase() + b.slice(1);
}

function kitCategory(name: string): string {
  if (/kick/i.test(name)) return 'grosses caisses';
  if (/snare/i.test(name)) return 'caisses claires';
  if (/perc/i.test(name)) return 'percussions';
  if (/fx/i.test(name)) return 'bruitages (samples FX)';
  return 'kit';
}

/** Format réel de settings/plugs.json (lu sur un OP-Z) : { engines: [...], plugs: [{ id, engine, samples, flags, version }] }. */
function parseOpzPlugs(json: Record<string, unknown>): Map<number, PlugInfo> | null {
  if (!Array.isArray(json.plugs) || !json.plugs.some((p) => isObj(p) && 'engine' in p)) return null;
  const out = new Map<number, PlugInfo>();
  for (const p of json.plugs) {
    if (!isObj(p)) continue;
    const id = asId(p.id);
    if (id === null) continue;
    const engine = typeof p.engine === 'string' && p.engine ? baseName(p.engine) : null;
    const samples = typeof p.samples === 'string' && p.samples ? p.samples : null;
    if (samples) {
      const name = sampleName(samples);
      const melodic = engine === 'synthsampler';
      out.set(id, { id, name, kind: melodic ? 'sample mélodique' : 'kit', engine, named: true, description: melodic ? 'échantillon joué sur le clavier' : kitCategory(name) });
    } else if (engine) {
      const known = ENGINES[engine];
      out.set(id, { id, name: known ? known[0] : prettify(engine), kind: 'moteur', engine, named: true, description: known ? known[1] : null });
    } else {
      out.set(id, { id, name: `n° ${id}`, kind: null, engine: null, named: false, description: null });
    }
  }
  return out;
}

export function parsePlugs(json: unknown): Map<number, PlugInfo> {
  if (isObj(json)) {
    const real = parseOpzPlugs(json);
    if (real) return real;
  }
  const out = new Map<number, PlugInfo>();
  const visit = (node: unknown, keyHint: string | null, depth: number): void => {
    if (depth > 8) return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n, null, depth + 1));
    if (!isObj(node)) return;
    let id: number | null = null;
    for (const k of ID_KEYS) if (id === null) id = asId(node[k]);
    if (id === null && keyHint) id = asId(keyHint);
    const engineRaw = firstString(node, ['engine', 'engineName', 'engine_name', 'engineId']);
    const engine = engineRaw ? baseName(engineRaw) : null;
    let name = firstString(node, NAME_KEYS);
    if (!name) {
      const path = firstString(node, PATH_KEYS);
      if (path) name = prettify(baseName(path));
    }
    const named = !!name;
    if (!name && engine) name = `n° ${id}`;
    if (id !== null && name && !out.has(id)) out.set(id, { id, name, kind: firstString(node, KIND_KEYS), engine, named });
    for (const [k, v] of Object.entries(node)) if (typeof v === 'object' && v !== null) visit(v, k, depth + 1);
  };
  visit(json, null, 0);
  return out;
}

export function parseSlots(json: unknown): Map<number, SlotRef[]> {
  const out = new Map<number, SlotRef[]>();
  if (!isObj(json) || !Array.isArray(json.tracks)) return out;
  for (const t of json.tracks) {
    if (!isObj(t) || typeof t.index !== 'number' || t.index < 0 || t.index >= TRACK_COUNT || !Array.isArray(t.packs)) continue;
    const refs: SlotRef[] = [];
    for (const p of t.packs) {
      if (!isObj(p)) continue;
      const id = asId(p.id);
      if (id !== null && typeof p.slot === 'number') refs.push({ slot: p.slot, id });
    }
    out.set(t.index, refs.sort((a, b) => a.slot - b.slot));
  }
  return out;
}

export function buildCatalog(raw: RawCatalog | null | undefined): DeviceCatalog | null {
  if (!raw) return null;
  const parse = (text: string | null): unknown => {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };
  return { plugs: parsePlugs(parse(raw.plugs_json)), slots: parseSlots(parse(raw.slots_json)) };
}

/** Nom affichable. Sans nom dans le fichier de l'OP-Z : « Kit n° 12 », « Moteur n° 65 »… (jamais le nom technique du moteur). */
export function plugName(catalog: DeviceCatalog | null, id: number, word = 'Son'): string {
  if (!id) return '—';
  const p = catalog?.plugs.get(id);
  return p?.named ? p.name : `${word} n° ${id}`;
}

// ---------------------------------------------------------------------------
// Familles de pistes : quels sons peuvent aller sur quelle piste
// ---------------------------------------------------------------------------

/** Pistes qui partagent le même genre de sons. */
export const trackFamily = (track: number): string =>
  track <= 3 ? 'batterie' : track <= 7 ? 'synthé' : track <= 9 ? 'effet' : ['tape', 'master', 'perform', 'module', 'lights', 'motion'][track - 10];

export interface SoundEntry extends PlugInfo {
  /** Où il est installé : pistes et emplacements. */
  placed: { track: number; slot: number }[];
  /** Peut aller sur la piste demandée. */
  compatible: boolean;
}

/**
 * Tous les sons du catalogue, pour une piste donnée. Un son est compatible s'il est
 * déjà installé sur une piste de la même famille, ou s'il utilise le même moteur
 * qu'un son de cette famille (prudence : on ne propose pas un synthé sur une piste batterie).
 */
export function soundsForTrack(catalog: DeviceCatalog, track: number): SoundEntry[] {
  const family = trackFamily(track);
  const placed = new Map<number, { track: number; slot: number }[]>();
  for (const [t, refs] of catalog.slots) for (const r of refs) {
    if (!placed.has(r.id)) placed.set(r.id, []);
    placed.get(r.id)!.push({ track: t, slot: r.slot });
  }
  const byEngine = (p: PlugInfo): string | null => {
    if (p.kind === 'kit') return 'batterie';
    if (p.kind === 'sample mélodique' || (p.engine && SYNTH_ENGINES.has(p.engine))) return 'synthé';
    if (p.engine && FX_ENGINES.has(p.engine)) return 'effet';
    if (p.engine === 'tapetwo') return 'tape';
    return null;
  };
  const familyEngines = new Set<string>();
  for (const [id, where] of placed) {
    if (where.some((w) => trackFamily(w.track) === family)) {
      const e = catalog.plugs.get(id)?.engine;
      if (e) familyEngines.add(e);
    }
  }
  return [...catalog.plugs.values()].map((p) => {
    const where = placed.get(p.id) ?? [];
    const known = byEngine(p);
    const compatible = known !== null
      ? known === family
      : where.some((w) => trackFamily(w.track) === family) || (!!p.engine && familyEngines.has(p.engine) && !where.some((w) => trackFamily(w.track) !== family));
    return { ...p, placed: where, compatible };
  });
}
