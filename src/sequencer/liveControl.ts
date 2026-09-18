import type { MidiTransport } from '../midi/transport';
import type { SoundParam } from '../project/layout';
import type { MidiConfiguration } from '../project/midiConfig';
import type { ProjectPattern } from '../project/opzProject';

/**
 * Contrôle en direct de l'OP-Z par MIDI standard (messages officiels, guide TE « midi »,
 * tableau « incoming CC ») — jamais de SysEx ici :
 *   CC 1–18 sur le canal de la piste : paramètres (valeur 0–127) ;
 *   CC 53 sur le canal de la piste : muet (0/1) ;
 *   CC 103 sur le canal 1–10 (= projet) : pattern 0–15 ;
 *   Program Change (+ Bank Select CC 0) : « bank 1 / program 1–128 et bank 2 / program 1–32 ».
 * Ces changements agissent sur le pattern ACTIF de l'OP-Z : l'appelant ne les envoie que si
 * l'OP-Z est sur le projet et le pattern affichés.
 */

/** Ordre du tableau TE : CC 1..18. */
export const CC_PARAMS: readonly SoundParam[] = [
  'param1', 'param2', 'filter', 'resonance', 'attack', 'decay', 'sustain', 'release',
  'lfo_depth', 'lfo_speed', 'lfo_value', 'lfo_shape', 'fx1', 'fx2', 'pan', 'level', 'portamento', 'note_style',
];
export const CC_MUTE = 53;
export const CC_PATTERN_SELECT = 103;
export const CC_BANK_SELECT = 0;

const ALLOWED_CC = new Set([...CC_PARAMS.map((_, i) => i + 1), CC_MUTE, CC_PATTERN_SELECT, CC_BANK_SELECT]);

export interface LiveMsg { channel: number; cc: number; value: number }

/** Numéro de CC d'un paramètre pour une piste (config MIDI de l'OP-Z pour les 16 premiers). */
export function ccFor(config: MidiConfiguration | null, track: number, param: SoundParam): number | null {
  const i = CC_PARAMS.indexOf(param);
  if (i < 0) return null;
  if (i < 16 && config) {
    const cc = config.parameterCcs[track * 16 + i];
    if (Number.isInteger(cc) && ALLOWED_CC.has(cc)) return cc;
  }
  return i + 1;
}

/** Messages à envoyer pour que l'OP-Z rejoigne `next` (paramètres et muets modifiés). */
export function liveDiff(prev: ProjectPattern, next: ProjectPattern, config: MidiConfiguration | null, channels: readonly number[]): LiveMsg[] {
  const out: LiveMsg[] = [];
  for (const t of next.tracks) {
    const before = prev.tracks.find((x) => x.id === t.id);
    if (!before) continue;
    const channel = channels[t.id] ?? t.id;
    for (const param of CC_PARAMS) {
      if (before.sound[param] === t.sound[param]) continue;
      const cc = ccFor(config, t.id, param);
      if (cc !== null) out.push({ channel, cc, value: t.sound[param] >> 1 });
    }
    if (before.muted !== t.muted) out.push({ channel, cc: CC_MUTE, value: t.muted ? 1 : 0 });
  }
  return out;
}

/** Sélection de pattern par CC 103 : canal = projet (1–10), valeur = pattern. */
export function patternSelectMsg(project: number, pattern: number): LiveMsg | null {
  if (!Number.isInteger(project) || !Number.isInteger(pattern) || project < 0 || project > 9 || pattern < 0 || pattern > 15) return null;
  return { channel: project, cc: CC_PATTERN_SELECT, value: pattern };
}

export function isAllowedLive(data: ArrayLike<number>): boolean {
  if (data.length === 3) return (data[0] & 0xf0) === 0xb0 && ALLOWED_CC.has(data[1]) && data[2] < 0x80;
  if (data.length === 2) return (data[0] & 0xf0) === 0xc0 && data[1] < 0x80;
  return false;
}

/** Sortie restreinte : CC de la liste ci-dessus et Program Change. Rien d'autre. */
export interface LiveOutput {
  cc(msg: LiveMsg, atMs?: number): void;
  program(channel: number, program: number, atMs?: number): void;
}

export function createLiveOutput(transport: MidiTransport): LiveOutput {
  const send = (data: number[], atMs?: number) => {
    if (!isAllowedLive(data)) throw new Error('sortie restreinte aux CC autorisés et Program Change');
    const bytes = Uint8Array.from(data);
    if (atMs !== undefined && transport.sendAt) transport.sendAt(bytes, atMs);
    else transport.send(bytes);
  };
  return {
    cc: ({ channel, cc, value }, atMs) => send([0xb0 | (channel & 0x0f), cc, value & 0x7f], atMs),
    program: (channel, program, atMs) => send([0xc0 | (channel & 0x0f), program & 0x7f], atMs),
  };
}

/**
 * Façons connues de faire changer l'OP-Z de pattern / projet par MIDI. Le guide TE ne précise
 * ni le canal du Program Change ni la numérotation des banques : on essaie avec l'utilisateur
 * (qui regarde l'OP-Z) et on retient celle qui marche (`opz-switch-method`).
 * Le canal 1 est évité pour le Program Change : « canal 1 → piste active » le détournerait.
 */
export type SwitchStep = { kind: 'cc'; msg: LiveMsg } | { kind: 'pc'; channel: number; program: number };
export interface SwitchMethod { id: string; label: string; build: (project: number, pattern: number) => SwitchStep[] | null }

const inRange = (project: number, pattern: number) =>
  Number.isInteger(project) && Number.isInteger(pattern) && project >= 0 && project <= 9 && pattern >= 0 && pattern <= 15;
const global160 = (project: number, pattern: number) => project * 16 + pattern;
const bankPc = (channel: number, oneBased: boolean) => (project: number, pattern: number): SwitchStep[] | null => {
  if (!inRange(project, pattern)) return null;
  const g = global160(project, pattern);
  const bank = g < 128 ? 0 : 1;
  return [
    { kind: 'cc', msg: { channel, cc: CC_BANK_SELECT, value: bank + (oneBased ? 1 : 0) } },
    { kind: 'pc', channel, program: g - bank * 128 },
  ];
};

export const SWITCH_METHODS: readonly SwitchMethod[] = [
  { id: 'cc103', label: 'CC 103 (canal = projet)', build: (project, pattern) => (inRange(project, pattern) ? [{ kind: 'cc', msg: { channel: project, cc: CC_PATTERN_SELECT, value: pattern } }] : null) },
  { id: 'pc16', label: 'Bank Select + Program Change, canal 16', build: bankPc(15, false) },
  { id: 'pc2', label: 'Bank Select + Program Change, canal 2', build: bankPc(1, false) },
  { id: 'pc1', label: 'Bank Select + Program Change, canal 1', build: bankPc(0, false) },
  { id: 'pc16b', label: 'Bank Select (1 = banque 1) + Program Change, canal 16', build: bankPc(15, true) },
];

export function sendSwitch(out: LiveOutput, steps: SwitchStep[], atMs?: number): void {
  for (const s of steps) {
    if (s.kind === 'cc') out.cc(s.msg, atMs);
    else out.program(s.channel, s.program, atMs);
  }
}

export const describeSteps = (steps: SwitchStep[]): string =>
  steps.map((s) => (s.kind === 'cc' ? `CC ${s.msg.cc}=${s.msg.value} (canal ${s.msg.channel + 1})` : `PC ${s.program} (canal ${s.channel + 1})`)).join(' + ');
