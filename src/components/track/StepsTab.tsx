import type { Result } from '../../lib/result';
import { noteName } from '../../lib/notes';
import { defaultNoteFor, setComponent, setLock, setStepNotes, stepNotes, type NoteInput } from '../../project/edit';
import { NOTES_PER_STEP, SOUND_PARAMS, type SoundParam } from '../../project/layout';
import type { OpzProject, ProjectTrack } from '../../project/opzProject';
import { COMPONENT_TRACK_LIMIT, STEP_COMPONENTS } from '../../project/stepComponents';
import { paramPages, polyphonyFor, TRACK_INFO } from '../../project/trackTypes';

interface Props {
  project: OpzProject;
  pattern: number;
  track: ProjectTrack;
  step: number | null;
  onStep: (step: number) => void;
  update: (fn: (p: OpzProject) => Result<OpzProject, Error>) => boolean;
  preview: (track: number, note: number, velocity?: number) => void;
}

const LENGTHS = [0.25, 0.5, 1, 2, 3, 4, 8, 16];
const COMPONENTS = STEP_COMPONENTS.filter((c) => !c.reserved);
const CHORDS: [string, number[]][] = [
  ['Majeur', [0, 4, 7]], ['Mineur', [0, 3, 7]], ['7', [0, 4, 7, 10]], ['Maj7', [0, 4, 7, 11]], ['m7', [0, 3, 7, 10]],
  ['Sus2', [0, 2, 7]], ['Sus4', [0, 5, 7]], ['Diminué', [0, 3, 6]], ['Augmenté', [0, 4, 8]], ['Quinte', [0, 7]],
];
const ROOTS = ['Do', 'Do#', 'Ré', 'Ré#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
const LOCK_LABEL = Object.fromEntries(paramPages('synth', ['', '']).flatMap((p) => p.params.map((d) => [d.param, d.label]))) as Record<SoundParam, string>;

/** Détail d'un pas : notes (adapté au type de piste), step components, parameter locks. */
export function StepsTab({ project, pattern, track, step, onStep, update, preview }: Props) {
  const info = TRACK_INFO[track.id];
  const s = step === null ? undefined : track.steps.find((x) => x.index === step);
  const notes = stepNotes(s);
  const capacity = Math.min(NOTES_PER_STEP[track.id], polyphonyFor(track.id));
  const title = info.kind === 'chord' ? 'Accord' : info.kind === 'arp' ? 'Notes de l’arpège' : info.kind === 'drum' || info.kind === 'sample' ? 'Sons joués' : 'Déclenchement';

  const picker = (
    <div className="flex flex-wrap gap-1">
      {Array.from({ length: 16 }, (_, i) => {
        const has = track.steps.some((x) => x.index === i && (x.notes.length || Object.keys(x.components).length || Object.keys(x.locks).length));
        return (
          <button key={i} onClick={() => onStep(i)}
            className={`h-7 w-7 rounded text-xs font-medium ${i === step ? 'bg-zinc-900 text-white' : has ? 'bg-zinc-200' : 'bg-zinc-50 text-zinc-400 hover:bg-zinc-100'}`}>
            {i + 1}
          </button>
        );
      })}
    </div>
  );
  const how = info.kind === 'chord'
    ? 'Accords : toutes les notes posées sur un même pas sonnent ensemble (4 au maximum). Choisissez un pas, puis une fondamentale et un type d’accord.'
    : info.kind === 'arp'
      ? 'Arpèges : les notes posées sur un même pas (8 au maximum) ne sonnent pas ensemble, l’arpégiateur les joue l’une après l’autre. Vitesse, motif (montant, descendant…), style et étendue : onglet Réglages, page « Arpège » (vitesse à 0 = pas d’arpège). Allongez la note pour que l’arpège dure.'
      : null;
  if (step === null) return <div className="space-y-3">{how && <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">{how}</p>}<p className="text-sm text-zinc-500">Choisissez un pas (ou clic droit sur la grille).</p>{picker}</div>;

  const setNotes = (next: NoteInput[]) => update((p) => setStepNotes(p, pattern, track.id, step, next));
  const patch = (i: number, v: Partial<NoteInput>) => setNotes(notes.map((n, j) => (j === i ? { ...n, ...v } : n)));
  const used = Object.keys(s?.components ?? {});
  const locks = Object.keys(s?.locks ?? {}) as SoundParam[];
  const freeComponent = COMPONENTS.find((c) => !used.includes(c.id));
  const freeLock = SOUND_PARAMS.find((p) => !locks.includes(p));

  return (
    <div className="space-y-5 text-sm">
      {picker}

      <section>
        <div className="mb-2 flex items-center">
          <h3 className="label">{title} · pas {step + 1} ({notes.length}/{capacity})</h3>
          <button className="btn ml-auto px-2 py-1 text-xs" disabled={notes.length >= capacity}
            onClick={() => setNotes([...notes, { note: Math.min(127, (notes.at(-1)?.note ?? defaultNoteFor(project, track.id) - 4) + 4), velocity: 100, lengthSteps: 1, micro: 0 }])}>
            + note
          </button>
        </div>
        {how && <p className="mb-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">{how}</p>}
        {(info.kind === 'chord' || info.kind === 'arp' || (info.kind === 'synth' && capacity > 1)) && (
          <ChordBuilder capacity={capacity} arp={info.kind === 'arp'} base={notes[0] ?? { note: defaultNoteFor(project, track.id), velocity: 100, lengthSteps: info.kind === 'arp' ? 4 : 1, micro: 0 }}
            onChord={(list) => { setNotes(list); list.forEach((n) => preview(track.id, n.note, n.velocity)); }} />
        )}
        {notes.length === 0 && <p className="text-zinc-500">Aucune note sur ce pas.</p>}
        <div className="space-y-2">
          {notes.map((n, i) => (
            <div key={i} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 rounded-lg border border-zinc-200 p-2">
              <select className="field w-20" value={n.note} onChange={(e) => { patch(i, { note: Number(e.target.value) }); preview(track.id, Number(e.target.value), n.velocity); }}>
                {Array.from({ length: 128 }, (_, v) => <option key={v} value={v}>{noteName(v)}</option>)}
              </select>
              <label className="flex items-center gap-2 text-xs text-zinc-500">Vélocité
                <input type="range" min={1} max={127} value={n.velocity} onChange={(e) => patch(i, { velocity: Number(e.target.value) })} />
              </label>
              <select className="field" value={n.lengthSteps} onChange={(e) => patch(i, { lengthSteps: Number(e.target.value) })} title="Durée en pas">
                {[...new Set([...LENGTHS, n.lengthSteps])].sort((a, b) => a - b).map((v) => <option key={v} value={v}>{v} pas</option>)}
              </select>
              <div className="flex gap-1">
                <button className="btn btn-ghost px-2 py-0.5" onClick={() => preview(track.id, n.note, n.velocity)} title="Écouter">{"\u25B6\uFE0E"}</button>
                <button className="btn btn-ghost px-2 py-0.5" onClick={() => setNotes(notes.filter((_, j) => j !== i))} title="Supprimer">✕</button>
              </div>
              <label className="col-span-4 flex items-center gap-2 text-xs text-zinc-500">
                Décalage (micro-timing) {n.micro > 0 ? `+${n.micro}` : n.micro}
                <input type="range" min={-12} max={11} value={n.micro} onChange={(e) => patch(i, { micro: Number(e.target.value) })} />
              </label>
            </div>
          ))}
        </div>
      </section>

      {track.id < COMPONENT_TRACK_LIMIT && (
        <section>
          <div className="mb-2 flex items-center">
            <h3 className="label">Effets de pas (step components)</h3>
            <button className="btn ml-auto px-2 py-1 text-xs" disabled={!freeComponent} onClick={() => freeComponent && update((p) => setComponent(p, pattern, track.id, step, freeComponent.id, 1))}>+ effet</button>
          </div>
          {used.length === 0 && <p className="text-zinc-500">Aucun.</p>}
          <div className="space-y-1.5">
            {used.map((id) => (
              <div key={id} className="flex items-center gap-2">
                <select className="field flex-1" value={id} onChange={(e) => update((p) => {
                  const c = setComponent(p, pattern, track.id, step, id, null);
                  return c.ok ? setComponent(c.value, pattern, track.id, step, e.target.value, s?.components[id] ?? 1) : c;
                })}>
                  {COMPONENTS.filter((c) => c.id === id || !used.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <select className="field" value={s?.components[id] ?? 1} onChange={(e) => update((p) => setComponent(p, pattern, track.id, step, id, Number(e.target.value)))}>
                  {(s?.components[id] ?? 1) > 10 && <option value={s?.components[id]}>brut {s?.components[id]}</option>}
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => <option key={v} value={v}>{v === 10 ? '0' : v}</option>)}
                </select>
                <button className="btn btn-ghost px-2 py-0.5" onClick={() => update((p) => setComponent(p, pattern, track.id, step, id, null))}>✕</button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center">
          <h3 className="label">Réglages verrouillés sur ce pas</h3>
          <button className="btn ml-auto px-2 py-1 text-xs" disabled={!freeLock} onClick={() => freeLock && update((p) => setLock(p, pattern, track.id, step, freeLock, track.sound[freeLock]))}>+ réglage</button>
        </div>
        {locks.length === 0 && <p className="text-zinc-500">Aucun : le pas utilise les réglages de la piste.</p>}
        <div className="space-y-1.5">
          {locks.map((param) => (
            <div key={param} className="grid grid-cols-[8rem_1fr_2.5rem_auto] items-center gap-2">
              <select className="field" value={param} onChange={(e) => update((p) => {
                const c = setLock(p, pattern, track.id, step, param, null);
                return c.ok ? setLock(c.value, pattern, track.id, step, e.target.value as SoundParam, s?.locks[param] ?? 0) : c;
              })}>
                {SOUND_PARAMS.filter((x) => x === param || !locks.includes(x)).map((x) => <option key={x} value={x}>{LOCK_LABEL[x]}</option>)}
              </select>
              <input type="range" min={0} max={255} value={s?.locks[param] ?? 0} onChange={(e) => update((p) => setLock(p, pattern, track.id, step, param, Number(e.target.value)))} />
              <span className="text-right tabular-nums">{s?.locks[param]}</span>
              <button className="btn btn-ghost px-2 py-0.5" onClick={() => update((p) => setLock(p, pattern, track.id, step, param, null))}>✕</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/** Construit un accord (ou les notes d'un arpège) à partir d'une fondamentale et d'un type. */
function ChordBuilder({ capacity, arp, base, onChord }: { capacity: number; arp: boolean; base: Required<NoteInput>; onChord: (notes: Required<NoteInput>[]) => void }) {
  const root = base.note % 12;
  const octave = Math.floor(base.note / 12) - 1;
  const build = (r: number, o: number, iv: number[], upOctave: boolean) => {
    const baseNote = (o + 1) * 12 + r;
    const list = [...iv, ...(upOctave ? [12] : [])].slice(0, capacity).map((d) => ({ ...base, note: Math.min(127, baseNote + d) }));
    onChord(list);
  };
  return (
    <div className="mb-3 rounded-lg border border-zinc-200 p-2">
      <div className="mb-1.5 flex items-center gap-2 text-xs text-zinc-500">
        {arp ? 'Notes de l’arpège' : 'Accord'} sur
        <select className="field w-20" value={root} onChange={(e) => build(Number(e.target.value), octave, [0], false)}>
          {ROOTS.map((n, i) => <option key={n} value={i}>{n}</option>)}
        </select>
        octave
        <select className="field w-16" value={octave} onChange={(e) => build(root, Number(e.target.value), [0], false)}>
          {[1, 2, 3, 4, 5, 6].map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap gap-1">
        {CHORDS.map(([name, iv]) => (
          <button key={name} className="btn px-2 py-0.5 text-xs" disabled={iv.length > capacity} onClick={() => build(root, octave, iv, arp && iv.length < capacity)}>{name}</button>
        ))}
      </div>
    </div>
  );
}
