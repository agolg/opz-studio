import { useEffect, useState } from 'react';
import type { PlayMode } from '../device/usePlayer';
import type { ProjectPattern } from '../project/opzProject';
import type { DevicePosition } from '../sequencer/telemetry';

interface Props {
  patterns: ProjectPattern[];
  selected: number;
  playingPattern: number | null;
  playing: boolean;
  /** L'OP-Z joue lui-même (horloge reçue). */
  deviceRunning: boolean;
  canPlay: boolean;
  mode: PlayMode;
  /** Chaîne jouée en mode « Chaîne » (patterns 0..15) et chaînes enregistrées dans l'OP-Z. */
  chain: number[];
  savedChains: number[][];
  onChain: (chain: number[]) => void;
  tempo: number;
  canUndo: boolean;
  canRedo: boolean;
  /** Projet affiché (0..9) si connu, noms des 10 projets et des 16 patterns. */
  project: number | null;
  projectNames: string[];
  patternNames: string[];
  canSwitchProject: string | null;
  onProject: (project: number) => void;
  onRenameProject: (name: string) => void;
  onRenamePattern: (name: string) => void;
  onSelect: (p: number) => void;
  devicePos: DevicePosition | null;
  follow: boolean;
  followBlocked: string | null;
  onFollow: (on: boolean) => void;
  onToggle: () => void;
  onMode: (m: PlayMode) => void;
  onTempo: (bpm: number) => void;
  onUndo: () => void;
  onRedo: () => void;
}

/** « Où suis-je ? » (projet, pattern, ce que joue l'OP-Z) puis la lecture. */
export function Transport(p: Props) {
  const [tempo, setTempo] = useState(String(p.tempo));
  useEffect(() => setTempo(String(p.tempo)), [p.tempo]);
  const commit = () => {
    const v = Math.round(Number(tempo));
    if (v >= 40 && v <= 200) p.onTempo(v);
    else setTempo(String(p.tempo));
  };
  const ordered = [...p.patterns].sort((a, b) => a.id - b.id);
  const label = (i: number, names: string[], word: string) => `${word} ${i + 1}${names[i] ? ` · ${names[i]}` : ''}`;
  const synced = p.devicePos && p.project !== null && p.devicePos.project === p.project && p.devicePos.pattern === p.selected;

  return (
    <div className="border-b border-zinc-200">
      {/* Où suis-je */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 pt-3">
        <label className="flex items-center gap-2">
          <span className="label">Projet</span>
          <select className="field w-48" value={p.project ?? ''} disabled={p.canSwitchProject !== null}
            title={p.canSwitchProject ?? 'Choisir un autre projet : l’OP-Z y passe, puis le studio le charge.'}
            onChange={(e) => p.onProject(Number(e.target.value))}>
            {p.project === null && <option value="">Projet inconnu</option>}
            {Array.from({ length: 10 }, (_, i) => <option key={i} value={i}>{label(i, p.projectNames, 'Projet')}</option>)}
          </select>
          {p.project !== null && (
            <NameField value={p.projectNames[p.project] ?? ''} placeholder="nommer ce projet" onCommit={p.onRenameProject} />
          )}
        </label>

        <div className="flex items-center gap-1">
          <span className="label mr-1">Pattern</span>
          {ordered.map((pt) => {
            const used = pt.tracks.some((t) => t.steps.some((s) => s.notes.length));
            const active = pt.id === p.selected;
            const onDevice = p.devicePos && p.project !== null && p.devicePos.project === p.project && p.devicePos.pattern === pt.id;
            return (
              <button key={pt.id} onClick={() => p.onSelect(pt.id)}
                title={`${label(pt.id, p.patternNames, 'Pattern')}${used ? '' : ' (vide)'}${onDevice ? ' — actif sur l’OP-Z' : ''}`}
                className={`relative h-8 w-8 rounded-md text-sm font-medium transition ${active ? 'bg-zinc-900 text-white' : used ? 'text-zinc-800 hover:bg-zinc-100' : 'text-zinc-400 hover:bg-zinc-100'}`}>
                {pt.id + 1}
                {used && <span className={`absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${active ? 'bg-white' : 'bg-zinc-900'}`} />}
                {onDevice && <span className="absolute -left-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-500" />}
                {p.playingPattern === pt.id && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-orange-500" />}
              </button>
            );
          })}
        </div>
        <NameField value={p.patternNames[p.selected] ?? ''} placeholder={`nommer le pattern ${p.selected + 1}`} onCommit={p.onRenamePattern} />
      </div>

      {/* Lecture */}
      <div className="flex flex-wrap items-center gap-4 px-5 py-2.5">
        <button className={`btn w-28 ${p.playing ? 'border-orange-500 bg-orange-500 text-white hover:bg-orange-400' : 'btn-dark'}`}
          onClick={p.onToggle} disabled={!p.canPlay} title={p.canPlay ? 'Barre d’espace' : 'Connectez l’OP-Z pour écouter'}>
          {p.playing ? '■ Stop' : '▶︎ Lecture'}
        </button>

        <div className="flex overflow-hidden rounded-lg border border-zinc-200 text-sm">
          <button className={`px-3 py-1.5 ${p.mode === 'pattern' ? 'bg-zinc-900 text-white' : 'hover:bg-zinc-50'}`} onClick={() => p.onMode('pattern')}>Boucler le pattern</button>
          <button className={`px-3 py-1.5 ${p.mode === 'chain' ? 'bg-zinc-900 text-white' : 'hover:bg-zinc-50'}`} onClick={() => p.onMode('chain')}
            title="Jouer plusieurs patterns à la suite">
            Enchaîner ({p.chain.length} pattern{p.chain.length > 1 ? 's' : ''})
          </button>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <span className="label">Tempo</span>
          <input className="field w-16 text-center" type="number" min={40} max={200} value={tempo}
            onChange={(e) => setTempo(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
          <span className="text-zinc-400">BPM</span>
        </label>

        {p.canPlay && (
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5 text-zinc-700" title={p.followBlocked ?? 'Chaque changement de pattern ici fait passer l’OP-Z sur le même pattern.'}>
              <input type="checkbox" className="h-4 w-4 accent-zinc-900" checked={p.follow} onChange={(e) => p.onFollow(e.target.checked)} />
              L’OP-Z suit le pattern choisi
            </label>
            {p.devicePos
              ? <span className={synced ? 'text-emerald-700' : 'text-amber-700'}>
                  {synced ? '● l’OP-Z est sur ce pattern' : `● l’OP-Z est sur ${label(p.devicePos.project, p.projectNames, 'projet').toLowerCase()}, pattern ${p.devicePos.pattern + 1}`}
                </span>
              : <span className="text-zinc-400">pattern de l’OP-Z inconnu : cliquez un pattern</span>}
            {p.follow && p.followBlocked && <span className="text-amber-700">({p.followBlocked})</span>}
          </div>
        )}

        <div className="ml-auto flex gap-1">
          <button className="btn btn-ghost px-2" onClick={p.onUndo} disabled={!p.canUndo} title="Annuler (Ctrl+Z)">↶</button>
          <button className="btn btn-ghost px-2" onClick={p.onRedo} disabled={!p.canRedo} title="Rétablir (Ctrl+Y)">↷</button>
        </div>
      </div>

      {p.mode === 'chain' && (
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 bg-zinc-50 px-5 py-2 text-sm">
          <span className="label">Chaîne</span>
          {p.chain.length === 0 && <span className="text-xs text-zinc-500">vide : ajoutez des patterns</span>}
          {p.chain.map((pt, i) => (
            <span key={i} className={`flex items-center gap-1 rounded-md border bg-white px-2 py-0.5 ${p.playingPattern === pt ? 'border-orange-500' : 'border-zinc-200'}`}>
              <b>{pt + 1}</b>{p.patternNames[pt] && <span className="max-w-24 truncate text-xs text-zinc-500">{p.patternNames[pt]}</span>}
              <button className="text-zinc-400 hover:text-red-600" title="Retirer" onClick={() => p.onChain(p.chain.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
          <button className="btn px-2 py-0.5 text-xs" disabled={p.chain.length >= 32} onClick={() => p.onChain([...p.chain, p.selected])}>+ pattern {p.selected + 1}</button>
          {p.chain.length > 0 && <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => p.onChain([])}>Vider</button>}
          {p.savedChains.some((c) => c.length) && (
            <select className="field ml-2 w-56 text-xs" value="" onChange={(e) => e.target.value !== '' && p.onChain(p.savedChains[Number(e.target.value)])}>
              <option value="">Reprendre une chaîne de l’OP-Z…</option>
              {p.savedChains.map((c, i) => c.length ? <option key={i} value={i}>Chaîne {i + 1} : {c.map((x) => x + 1).join(' → ')}</option> : null)}
            </select>
          )}
          <span className="ml-auto text-xs text-zinc-500">Composée ici pour l’écoute ; l’OP-Z suit pattern par pattern.</span>
        </div>
      )}
    </div>
  );
}

/** Champ de nom discret : validé à la sortie ou sur Entrée. */
function NameField({ value, placeholder, onCommit }: { value: string; placeholder: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input className="w-44 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm italic text-zinc-700 placeholder:text-zinc-400 hover:border-zinc-200 focus:border-zinc-300 focus:not-italic focus:outline-none"
      value={v} placeholder={`✎ ${placeholder}`} maxLength={60}
      onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setV(value); }} />
  );
}
