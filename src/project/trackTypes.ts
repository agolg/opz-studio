import type { SoundParam } from './layout';

/**
 * Ce que fait chaque piste de l'OP-Z, pour adapter l'interface.
 * Faits : guide OP-Z de Teenage Engineering ; listes de valeurs : libopz (noms seulement).
 */
export type TrackKind = 'drum' | 'sample' | 'synth' | 'arp' | 'chord' | 'fx' | 'tape' | 'master' | 'perform' | 'module' | 'lights' | 'motion';
export type TrackGroup = 'Batterie' | 'Synthés' | 'Effets' | 'Contrôle';

export interface TrackInfo {
  id: number;
  label: string;
  kind: TrackKind;
  group: TrackGroup;
  /** Nom du « son » pour ce type de piste. */
  soundWord: string;
  description: string;
  /** Couleur d'identification (classes Tailwind). */
  dot: string;
}

export const TRACK_INFO: readonly TrackInfo[] = [
  { id: 0, label: 'Kick', kind: 'drum', group: 'Batterie', soundWord: 'Kit', description: 'Grosse caisse. Chaque note joue un des sons du kit.', dot: 'bg-rose-500' },
  { id: 1, label: 'Snare', kind: 'drum', group: 'Batterie', soundWord: 'Kit', description: 'Caisse claire. Chaque note joue un des sons du kit.', dot: 'bg-rose-400' },
  { id: 2, label: 'Perc', kind: 'drum', group: 'Batterie', soundWord: 'Kit', description: 'Percussions. Chaque note joue un des sons du kit.', dot: 'bg-orange-400' },
  { id: 3, label: 'Sample', kind: 'sample', group: 'Batterie', soundWord: 'Sample', description: 'Samples (kits de samples ou vos propres enregistrements).', dot: 'bg-amber-400' },
  { id: 4, label: 'Bass', kind: 'synth', group: 'Synthés', soundWord: 'Moteur', description: 'Basse : synthé monophonique (une note par pas). Sert aussi de référence au Master pour la tonalité.', dot: 'bg-sky-500' },
  { id: 5, label: 'Lead', kind: 'synth', group: 'Synthés', soundWord: 'Moteur', description: 'Lead : synthé mélodique, jusqu’à 3 notes par pas.', dot: 'bg-blue-500' },
  { id: 6, label: 'Arp', kind: 'arp', group: 'Synthés', soundWord: 'Moteur', description: 'Arpégiateur : les notes posées sur un même pas sont jouées en arpège (vitesse, motif, style, étendue).', dot: 'bg-indigo-500' },
  { id: 7, label: 'Chord', kind: 'chord', group: 'Synthés', soundWord: 'Moteur', description: 'Accords : jusqu’à 4 notes jouées ensemble.', dot: 'bg-violet-500' },
  { id: 8, label: 'FX 1', kind: 'fx', group: 'Effets', soundWord: 'Effet', description: 'Effet 1 : reçoit les envois « FX 1 » des autres pistes.', dot: 'bg-emerald-500' },
  { id: 9, label: 'FX 2', kind: 'fx', group: 'Effets', soundWord: 'Effet', description: 'Effet 2 : reçoit les envois « FX 2 » des autres pistes.', dot: 'bg-teal-500' },
  { id: 10, label: 'Tape', kind: 'tape', group: 'Effets', soundWord: 'Effet de bande', description: 'Tape : mémoire audio qui enregistre en continu ; les notes créent boucles et effets de vitesse (touches blanches : départ, noires : longueur).', dot: 'bg-lime-500' },
  { id: 11, label: 'Master', kind: 'master', group: 'Effets', soundWord: 'Effet master', description: 'Master : chorus, drive et filtre sur tout le mix ; ses notes transposent le morceau (tonalité, accords).', dot: 'bg-green-600' },
  { id: 12, label: 'Perform', kind: 'perform', group: 'Contrôle', soundWord: 'Performance', description: 'Perform : effets « punch-in » sur toutes les pistes à la fois.', dot: 'bg-zinc-500' },
  { id: 13, label: 'Module', kind: 'module', group: 'Contrôle', soundWord: 'Module', description: 'Module : pilote un module d’extension (ZM-1, ZM-2, ZM-4), sinon piste MIDI.', dot: 'bg-zinc-400' },
  { id: 14, label: 'Lights', kind: 'lights', group: 'Contrôle', soundWord: 'Lumières', description: 'Lights : séquence jusqu’à 16 éclairages (DMX).', dot: 'bg-yellow-500' },
  { id: 15, label: 'Motion', kind: 'motion', group: 'Contrôle', soundWord: 'Motion', description: 'Motion : séquence d’images (photomatic, vidéo).', dot: 'bg-pink-500' },
];

/** Pistes jouées comme des instruments (réglages de son complets, step components). */
export const isInstrument = (kind: TrackKind) => ['drum', 'sample', 'synth', 'arp', 'chord'].includes(kind);

// Listes de valeurs : la valeur 0..255 est répartie en tranches égales (comme l'affiche l'OP-Z).
const bucket = <T,>(list: readonly T[], v: number): T => list[Math.min(list.length - 1, Math.floor((v / 255) * list.length))];
export const LFO_SHAPES = ['Sinus', 'Triangle', 'Carré', 'Dent de scie', 'Aléatoire', 'Gyro', 'Sinus (sync)', 'Triangle (sync)', 'Carré (sync)', 'Dent de scie (sync)', 'Aléatoire (sync)', 'Une fois'];
export const LFO_TARGETS = ['Param 1', 'Param 2', 'Filtre', 'Résonance', 'Attaque', 'Hauteur', 'Panoramique', 'Volume'];
export const NOTE_STYLES_DRUM = ['Retrig', 'Mono', 'Gate', 'Boucle'];
export const NOTE_STYLES_SYNTH = ['Poly', 'Mono', 'Legato'];
export const NOTE_LENGTHS = ['Drone', '1', '1/2', '1/4', '1/8', '1/16', '1/32', '1/64'];

export interface ParamDef {
  param: SoundParam;
  label: string;
  format: (v: number, kind: TrackKind) => string;
}

const pct = (v: number) => `${Math.round((v / 255) * 100)}`;
const pan = (v: number) => (Math.abs(v - 128) <= 1 ? 'Centre' : v < 128 ? `G ${Math.round(((128 - v) / 128) * 100)}` : `D ${Math.round(((v - 128) / 127) * 100)}`);

export interface ParamPage { title: string; hint: string; params: ParamDef[] }

/**
 * Pages de réglages telles que l'OP-Z les présente (guide TE « parameter pages », « arp »,
 * « tape », « master », « lights »). Même stockage (18 octets par piste), libellés selon la piste.
 */
export const ARP_PATTERNS = ['Manuel', 'Montant', 'Descendant', 'Montant/descendant', 'Descendant/montant', 'Aléatoire'];
export const MASTER_STYLES = ['Latch', 'Libre'];

export function paramPages(kind: TrackKind, fxNames: [string, string]): ParamPage[] {
  const d = (param: SoundParam, label: string, format: ParamDef['format'] = pct): ParamDef => ({ param, label, format });
  const styles = kind === 'drum' || kind === 'sample' ? NOTE_STYLES_DRUM : kind === 'master' ? MASTER_STYLES : NOTE_STYLES_SYNTH;
  const sends: ParamPage = { title: 'Effets et mix', hint: 'Page 4 (voyant rouge)', params: [d('fx1', `Envoi FX 1${fxNames[0] ? ` (${fxNames[0]})` : ''}`), d('fx2', `Envoi FX 2${fxNames[1] ? ` (${fxNames[1]})` : ''}`), d('pan', 'Panoramique', pan), d('level', 'Volume')] };
  const env: ParamPage = { title: 'Enveloppe', hint: 'Page 2 (voyant bleu)', params: [d('attack', 'Attaque'), d('decay', 'Décroissance'), d('sustain', 'Maintien'), d('release', 'Relâchement')] };
  const lfo: ParamPage = { title: 'LFO', hint: 'Page 3 (voyant jaune)', params: [d('lfo_depth', 'Quantité'), d('lfo_speed', 'Vitesse'), d('lfo_value', 'Cible', (v) => bucket(LFO_TARGETS, v)), d('lfo_shape', 'Forme', (v) => bucket(LFO_SHAPES, v))] };
  const play: ParamPage = { title: 'Jeu', hint: 'Touche piste + cadrans', params: [d('portamento', 'Portamento'), d('note_style', 'Style de note', (v) => bucket(styles, v))] };
  const filter = [d('filter', 'Filtre'), d('resonance', 'Résonance')];
  switch (kind) {
    case 'drum':
    case 'sample':
      return [{ title: 'Son', hint: 'Page 1 (voyant vert)', params: [d('param1', 'Hauteur'), d('param2', 'Inversion'), ...filter] }, env, lfo, sends, play];
    case 'arp':
      return [
        { title: 'Son', hint: 'Page 1 (voyant vert) — dépend du moteur', params: [d('param1', 'Param 1'), d('param2', 'Param 2'), ...filter] },
        env,
        { title: 'Arpège', hint: 'Page 3 : remplace le LFO sur la piste Arp', params: [d('lfo_depth', 'Vitesse (0 = arpège coupé)'), d('lfo_speed', 'Motif', (v) => bucket(ARP_PATTERNS, v)), d('lfo_value', 'Style rythmique', (v) => `${Math.min(6, Math.floor((v / 255) * 6) + 1)} / 6`), d('lfo_shape', 'Étendue (octaves)')] },
        sends, play,
      ];
    case 'fx':
      return [{ title: 'Effet', hint: 'Page 1 — dépend de l’effet choisi', params: [d('param1', 'Param 1'), d('param2', 'Param 2'), ...filter] }, { ...lfo, hint: 'Page 2' }];
    case 'tape':
      return [{ title: 'Bande', hint: 'Page 1', params: [d('param1', 'Vitesse (grossière)'), d('param2', 'Vitesse (fine)'), ...filter] }];
    case 'master':
      return [{ title: 'Master', hint: 'Page 1', params: [d('param1', 'Chorus'), d('param2', 'Drive'), d('filter', 'Filtre (passe-bas ↔ passe-haut)'), d('resonance', 'Résonance')] }, { ...play, params: [d('note_style', 'Style de note', (v) => bucket(styles, v))] }];
    case 'lights':
      return [{ title: 'Lumières', hint: 'Page 1', params: [d('param1', 'Couleur'), d('param2', 'Couleur alternative'), d('filter', 'Vitesse'), d('resonance', 'Intensité')] }];
    default:
      return [{ title: 'Son', hint: 'Page 1 — dépend du moteur', params: [d('param1', 'Param 1'), d('param2', 'Param 2'), ...filter] }, env, lfo, sends, play];
  }
}

/** Nombre de notes jouées ensemble par pas (guide TE « tracks ») — la mémoire en autorise parfois plus. */
export const MUSICAL_POLYPHONY: Record<TrackKind, number> = {
  drum: 2, sample: 2, synth: 3, arp: 8, chord: 4, fx: 1, tape: 1, master: 4, perform: 6, module: 6, lights: 4, motion: 4,
};
export const polyphonyFor = (track: number): number => (track === 4 ? 1 : MUSICAL_POLYPHONY[TRACK_INFO[track].kind]);

export const noteLengthName = (v: number) => bucket(NOTE_LENGTHS, v);
