import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { DeviceCatalog } from '../project/catalog';
import { plugName } from '../project/catalog';
import type { ProjectPattern } from '../project/opzProject';
import { TRACK_INFO } from '../project/trackTypes';
import { trackTiming } from '../sequencer/compile';
import type { PlayerPosition } from '../sequencer/player';

export interface Cell { track: number; step: number }

const ROW = 40;
const GAP = 14; // espace entre groupes de pistes
const HEAD = 26;
const CELL = 42;
const TRACK_HEX = ['#f43f5e', '#fb7185', '#fb923c', '#f59e0b', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#10b981', '#14b8a6', '#84cc16', '#16a34a', '#71717a', '#a1a1aa', '#eab308', '#ec4899'];

const GROUPS = ['Batterie', 'Synthés', 'Effets et sortie', 'Contrôle'] as const;
const groupOf = (t: number) => (t < 4 ? 0 : t < 8 ? 1 : t < 12 ? 2 : 3);

/** Position verticale de chaque piste affichée (espace entre groupes). */
function layout(ids: readonly number[]) {
  const tops = new Map<number, number>();
  const labels: { text: string; top: number }[] = [];
  let y = HEAD;
  let group = -1;
  for (const t of ids) {
    if (groupOf(t) !== group) {
      if (group !== -1) y += GAP;
      group = groupOf(t);
      labels.push({ text: GROUPS[group], top: group === groupOf(ids[0]) ? 6 : y - GAP - 1 });
    }
    tops.set(t, y);
    y += ROW;
  }
  return { tops, labels, height: y + 4 };
}

interface Props {
  pattern: ProjectPattern;
  /** Pistes montrées dans la grille (par défaut les 8 instruments). */
  trackIds: readonly number[];
  catalog: DeviceCatalog | null;
  selectedTrack: number;
  selectedStep: number | null;
  playing: boolean;
  position: () => PlayerPosition | null;
  onToggle: (cell: Cell) => void;
  onSelectStep: (cell: Cell) => void;
  onSelectTrack: (track: number) => void;
  onMute: (track: number, muted: boolean) => void;
  solo: ReadonlySet<number>;
  onSolo: (track: number, additive: boolean) => void;
}

/**
 * Le séquenceur : une ligne par piste (nom, son, muet) et 16 pas.
 * Clic sur un pas : poser / retirer une note. Clic droit : détailler le pas.
 */
export function Sequencer({ pattern, trackIds, catalog, selectedTrack, selectedStep, playing, position, onToggle, onSelectStep, onSelectTrack, onMute, solo, onSolo }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { tops, labels, height } = useMemo(() => layout(trackIds), [trackIds]);
  const rowTop = useCallback((t: number) => tops.get(t) ?? -1000, [tops]);
  const shown = useMemo(() => pattern.tracks.filter((t) => tops.has(t.id)), [pattern, tops]);
  const width = 16 * CELL;

  const draw = useCallback(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    if (el.width !== width * dpr || el.height !== Math.round(height * dpr)) {
      el.width = width * dpr;
      el.height = Math.round(height * dpr);
      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.font = '500 11px ui-sans-serif, system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let s = 0; s < 16; s++) {
      ctx.fillStyle = s % 4 === 0 ? '#18181b' : '#a1a1aa';
      ctx.fillText(String(s + 1), s * CELL + CELL / 2, HEAD / 2);
    }
    const pos = playing ? position() : null;
    const live = pos && pos.patternId === pattern.id ? pos : null;
    for (const track of shown) {
      const t = track.id;
      const y = rowTop(t);
      const steps = new Map(track.steps.map((s) => [s.index, s]));
      const timing = live ? trackTiming(track, live.sixteenthMs) : null;
      const current = live && timing ? Math.floor(live.elapsedMs / timing.stepMs) % timing.count : -1;
      for (let s = 0; s < 16; s++) {
        const x = s * CELL;
        const step = steps.get(s);
        const inRange = s < track.step_count;
        const on = !!step?.notes.length;
        ctx.globalAlpha = track.muted || (solo.size > 0 && !solo.has(t)) ? 0.3 : 1;
        ctx.fillStyle = on ? TRACK_HEX[t] : !inRange ? '#fafafa' : Math.floor(s / 4) % 2 ? '#f4f4f5' : '#e4e4e7';
        roundRect(ctx, x + 3, y + 4, CELL - 6, ROW - 8, 5);
        ctx.fill();
        if (step && Object.keys(step.components).length) {
          ctx.fillStyle = on ? '#ffffff' : '#18181b';
          ctx.beginPath();
          ctx.arc(x + CELL / 2, y + ROW / 2, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        if (step && Object.keys(step.locks).length) {
          ctx.fillStyle = on ? '#ffffff' : '#18181b';
          ctx.fillRect(x + CELL - 11, y + 7, 4, 4);
        }
        if (step && step.notes.length > 1) {
          ctx.fillStyle = '#ffffff';
          ctx.font = '600 10px ui-sans-serif, system-ui';
          ctx.fillText(String(step.notes.length), x + 11, y + ROW / 2);
          ctx.font = '500 11px ui-sans-serif, system-ui';
        }
        ctx.globalAlpha = 1;
        if (s === current) {
          ctx.strokeStyle = '#f97316';
          ctx.lineWidth = 2.5;
          roundRect(ctx, x + 2, y + 3, CELL - 4, ROW - 6, 6);
          ctx.stroke();
        }
        if (t === selectedTrack && s === selectedStep) {
          ctx.strokeStyle = '#18181b';
          ctx.lineWidth = 2;
          roundRect(ctx, x + 1.5, y + 2.5, CELL - 3, ROW - 5, 6);
          ctx.stroke();
        }
      }
    }
  }, [shown, rowTop, pattern.id, selectedTrack, selectedStep, playing, position, width, height, solo]);

  useEffect(() => {
    draw();
    if (!playing) return;
    let frame = requestAnimationFrame(function loop() {
      draw();
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  }, [draw, playing]);

  const hit = (e: React.MouseEvent<HTMLCanvasElement>): Cell | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const step = Math.floor(x / CELL);
    const track = trackIds.find((t) => y >= rowTop(t) && y < rowTop(t) + ROW);
    return track === undefined || step < 0 || step > 15 ? null : { track, step };
  };

  return (
    <div className="flex">
      <div className="relative shrink-0" style={{ width: 240, height }}>
        {shown.map((track) => {
          const info = TRACK_INFO[track.id];
          const active = track.id === selectedTrack;
          return (
            <div key={track.id} className={`absolute left-0 right-2 flex items-center gap-2 rounded-lg px-2 ${active ? 'bg-zinc-100' : 'hover:bg-zinc-50'}`}
              style={{ top: rowTop(track.id) + 2, height: ROW - 4 }}>
              <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => onSelectTrack(track.id)}>
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${info.dot}`} />
                <span className="w-14 shrink-0 text-sm font-medium">{info.label}</span>
                <span className="truncate text-xs text-zinc-500" title={plugName(catalog, track.plug, info.soundWord)}>{plugName(catalog, track.plug, info.soundWord)}</span>
              </button>
              <button onClick={() => onMute(track.id, !track.muted)} title={track.muted ? 'Réactiver' : 'Couper'}
                className={`h-6 w-6 shrink-0 rounded text-[11px] font-semibold ${track.muted ? 'bg-red-500 text-white' : 'text-zinc-400 hover:bg-zinc-200'}`}>
                M
              </button>
              <button onClick={(e) => onSolo(track.id, e.shiftKey)} title={solo.has(track.id) ? 'Retirer du solo' : 'Écouter cette piste seule (Maj+clic : en ajouter d’autres)'}
                className={`h-6 w-6 shrink-0 rounded text-[11px] font-semibold ${solo.has(track.id) ? 'bg-amber-400 text-zinc-900' : 'text-zinc-400 hover:bg-zinc-200'}`}>
                S
              </button>
            </div>
          );
        })}
        {labels.map((g) => (
          <span key={g.text} className="absolute left-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400" style={{ top: g.top }}>
            {g.text}
          </span>
        ))}
      </div>
      <canvas ref={canvas} className="block cursor-pointer select-none"
        onClick={(e) => { const c = hit(e); if (c) onToggle(c); }}
        onContextMenu={(e) => { e.preventDefault(); const c = hit(e); if (c) onSelectStep(c); }} />
    </div>
  );
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
