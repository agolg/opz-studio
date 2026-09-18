import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { OpzProject } from '../project/opzProject';
import { channelsFor, compilePattern, midiWarnings } from '../sequencer/compile';
import type { NoteOutput } from '../sequencer/noteOutput';
import { Player, type PlayerPosition } from '../sequencer/player';

/**
 * Lecture du projet par l'OP-Z en MIDI — NOTES UNIQUEMENT (règle n° 1).
 * Pas de start/stop ni de clock : cela lancerait aussi le séquenceur interne de
 * l'OP-Z et ses propres patterns par-dessus les nôtres.
 */
export type PlayMode = 'pattern' | 'chain';

/** Chaîne jouée : celle composée dans l'éditeur, sinon la chaîne active de l'OP-Z. */
export const playChain = (proj: OpzProject): number[] =>
  (proj.meta.play_chain ?? proj.global.active_chain).filter((x) => x < 16);

/**
 * `follow(pattern, startAt)` : appelé dès qu'un pattern est planifié, avec l'heure où il commence,
 * pour que l'appelant fasse passer l'OP-Z sur ce pattern (Program Change horodaté, jamais $07).
 */
export function usePlayer(output: NoteOutput | null, project: RefObject<OpzProject | null>, selectedPattern: RefObject<number>, followRef?: RefObject<((pattern: number, startAt: number) => void) | null>, solo: ReadonlySet<number> = new Set(), guard?: RefObject<(() => boolean) | null>) {
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<PlayMode>('pattern');
  const [controlTracks, setControlTracks] = useState(true);
  const player = useRef<Player | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // Solo : seules les pistes « S » sont jouées (si au moins une l'est).
  const tracks = useMemo(() => {
    const base = controlTracks ? Array.from({ length: 16 }, (_, i) => i) : [0, 1, 2, 3, 4, 5, 6, 7];
    return new Set(solo.size ? base.filter((t) => solo.has(t)) : base);
  }, [controlTracks, solo]);
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;

  const stop = useCallback(() => {
    player.current?.stop();
    player.current = null;
    setPlaying(false);
  }, []);

  // Déconnexion de l'OP-Z pendant la lecture : on arrête.
  useEffect(() => {
    if (!output) stop();
  }, [output, stop]);
  useEffect(() => stop, [stop]);

  const play = useCallback(() => {
    if (!output || !project.current) return;
    if (guard?.current && !guard.current()) return;
    stop();
    let lastFollowed = -1;
    const p = new Player(output, {
      startDelayMs: 150,
      onSegment: (patternId, startAt) => {
        const follow = followRef?.current;
        if (!follow || patternId === lastFollowed) return;
        lastFollowed = patternId;
        follow(patternId, startAt);
      },
    });
    p.start((previous) => {
      const proj = project.current;
      if (!proj) return null;
      let patternId: number;
      let sequenceIndex: number;
      const chain = playChain(proj);
      if (modeRef.current === 'chain' && chain.length) {
        sequenceIndex = (previous + 1) % chain.length;
        patternId = chain[sequenceIndex];
      } else {
        sequenceIndex = 0;
        patternId = selectedPattern.current ?? 0;
      }
      const pattern = proj.patterns.find((x) => x.id === patternId);
      if (!pattern) return null;
      return { compiled: compilePattern(pattern, proj.global.tempo, { tracks: tracksRef.current, channels: channelsFor(proj) }), sequenceIndex };
    });
    player.current = p;
    setPlaying(true);
  }, [output, project, selectedPattern, stop, followRef, guard]);

  /** Le projet a changé pendant la lecture : on l'applique tout de suite (pas au tour suivant). */
  const refresh = useCallback(() => {
    const proj = project.current;
    if (!player.current || !proj) return;
    player.current.refresh((patternId) => {
      const pattern = proj.patterns.find((x) => x.id === patternId);
      return pattern ? compilePattern(pattern, proj.global.tempo, { tracks: tracksRef.current, channels: channelsFor(proj) }) : null;
    });
  }, [project]);

  // Changement de solo pendant la lecture : appliqué tout de suite.
  useEffect(() => { refresh(); }, [tracks, refresh]);

  const toggle = useCallback(() => (player.current ? stop() : play()), [play, stop]);

  /** Fait entendre une note tout de suite (clic dans la grille). */
  const preview = useCallback((proj: OpzProject, track: number, note: number, velocity = 100) => {
    if (!output) return;
    const channel = channelsFor(proj)[track];
    const now = performance.now();
    output.noteOn(channel, note, velocity, now);
    output.noteOff(channel, note, now + 250);
  }, [output]);

  const position = useCallback((): PlayerPosition | null => player.current?.position() ?? null, []);

  // Barre d'espace = lecture / arrêt (hors champs de saisie).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.code !== 'Space' || (target && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(target.tagName))) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  const warnings = project.current ? midiWarnings(project.current.midi_config, tracks) : [];

  return { refresh, playing, mode, setMode, controlTracks, setControlTracks, play, stop, toggle, preview, position, warnings, canPlay: output !== null };
}
