import { useMemo, useState } from 'react';
import type { Result } from '../../lib/result';
import { noteName } from '../../lib/notes';
import { plugName, soundsForTrack, type DeviceCatalog } from '../../project/catalog';
import { copySoundToAllPatterns, setPlug, setStepNotes, stepNotes } from '../../project/edit';
import type { OpzProject, ProjectTrack } from '../../project/opzProject';
import { TRACK_INFO } from '../../project/trackTypes';

interface Props {
  pattern: number;
  track: ProjectTrack;
  step: number | null;
  catalog: DeviceCatalog | null;
  connected: boolean;
  onReadCatalog: () => void;
  update: (fn: (p: OpzProject) => Result<OpzProject, Error>) => boolean;
  preview: (track: number, note: number, velocity?: number) => void;
  padNote: number | null;
  onPadNote: (note: number) => void;
}

/**
 * Hypothèse (à confirmer à l'oreille) : les 24 sons d'un kit sont sur les 24 touches
 * du clavier de l'OP-Z, qui commence à fa (F3 = note MIDI 53).
 */
export const KIT_FIRST_NOTE = 53;
const KIT_SIZE = 24;

/**
 * Le son d'une piste, comme sur l'OP-Z :
 *  piste → 10 sons sur ses touches noires → le pattern en joue 1 → (kit) 24 sons → chaque pas en joue 1.
 * Les autres sons de l'OP-Z sont listés pour information (le studio ne modifie pas les sons).
 */
export function SoundTab({ pattern, track, step, catalog, connected, onReadCatalog, update, preview, padNote, onPadNote }: Props) {
  const info = TRACK_INFO[track.id];
  const isKit = info.kind === 'drum' || info.kind === 'sample';
  const word = info.soundWord.toLowerCase();
  const slots = catalog?.slots.get(track.id) ?? [];
  const currentSlot = slots.find((s) => s.id === track.plug)?.slot ?? null;

  const noun = isKit ? 'kit' : word;
  const soundCount = isKit ? '24 sons' : null;
  const ready = slots.length;

  return (
    <div className="space-y-6">
      {/* Le principe de l'OP-Z, en une ligne. */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded-md bg-zinc-100 px-2 py-1 font-medium">Piste {info.label}</span>
        <span className="text-zinc-400">→</span>
        <span className="rounded-md bg-zinc-100 px-2 py-1">{ready} {noun}{ready > 1 ? 's' : ''} sur ses touches noires</span>
        <span className="text-zinc-400">→</span>
        <span className="rounded-md bg-zinc-900 px-2 py-1 text-white">pattern {pattern + 1} : {plugName(catalog, track.plug, info.soundWord)}</span>
        {soundCount && <><span className="text-zinc-400">→</span><span className="rounded-md bg-zinc-100 px-2 py-1">{soundCount}</span><span className="text-zinc-400">→</span><span className="rounded-md bg-zinc-100 px-2 py-1">chaque pas en joue 1</span></>}
        {!isKit && (info.kind === 'synth' || info.kind === 'arp' || info.kind === 'chord') && <><span className="text-zinc-400">→</span><span className="rounded-md bg-zinc-100 px-2 py-1">vous jouez des notes</span></>}
      </div>

      {!catalog || catalog.plugs.size === 0 ? (
        <section className="rounded-xl border border-dashed border-zinc-300 p-4 text-sm text-zinc-600">
          <p>Pour voir et changer les sons, le studio doit lire la liste des sons de l’OP-Z.</p>
          <button className="btn btn-dark mt-3" disabled={!connected} onClick={onReadCatalog}>Lire les sons de l’OP-Z</button>
          {!connected && <p className="mt-2 text-xs text-zinc-500">Connectez l’OP-Z d’abord.</p>}
        </section>
      ) : (
        <>
          <section>
            <h3 className="text-sm font-semibold">{info.soundWord} de la piste {info.label} dans le pattern {pattern + 1}</h3>
            <p className="mb-2 text-xs text-zinc-500">
              Dans un pattern, une piste joue <b>un seul {noun}</b>, choisi parmi ceux de ses touches noires. Chaque pattern peut en choisir un autre, et chaque piste a le sien :
              un pattern combine donc jusqu’à 8 instruments différents. Un clic suffit, l’OP-Z suit.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((slot) => {
                const ref = slots.find((s) => s.slot === slot);
                const active = ref && ref.id === track.plug;
                return (
                  <button key={slot} disabled={!ref || active} onClick={() => ref && update((p) => setPlug(p, pattern, track.id, ref.id))}
                    title={ref ? `Sur l’OP-Z : touche ${info.label} + touche noire ${slot}` : 'Touche noire vide : un son peut y être ajouté depuis l’OP-Z (mode disque)'}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${active ? 'border-zinc-900 bg-zinc-900 text-white' : ref ? 'border-zinc-200 hover:border-zinc-400' : 'border-dashed border-zinc-200 text-zinc-300'}`}>
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-semibold ${active ? 'bg-white text-zinc-900' : 'bg-zinc-800 text-white'} ${ref ? '' : 'opacity-30'}`}>{slot}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{ref ? plugName(catalog, ref.id, info.soundWord) : 'vide'}</span>
                      {ref && catalog.plugs.get(ref.id)?.description && (
                        <span className="block truncate text-[11px] text-zinc-400">{catalog.plugs.get(ref.id)?.description}</span>
                      )}
                    </span>
                    {active && <span className="text-[11px]">joué</span>}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
              <span className="flex-1">{currentSlot ? <>Sur l’OP-Z : touche <b>{info.label}</b> + touche noire <b>{currentSlot}</b>.</> : 'Ce son n’est sur aucune touche noire de la piste.'}</span>
              <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => update((p) => copySoundToAllPatterns(p, pattern, track.id))}>Même {noun} dans les 16 patterns</button>
            </div>
          </section>

          {isKit
            ? <KitPads track={track} pattern={pattern} step={step} update={update} preview={preview} padNote={padNote} onPadNote={onPadNote} kitName={plugName(catalog, track.plug, info.soundWord)} />
            : (info.kind === 'synth' || info.kind === 'arp' || info.kind === 'chord') && (
              <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                Un moteur fabrique le son. On le fait jouer avec des notes (grille, ou onglet <b>Pas</b> pour choisir la hauteur, les accords, les arpèges) ;
                son timbre se règle dans l’onglet <b>Réglages</b> (paramètres 1 et 2, filtre, enveloppe, LFO).
              </p>
            )}

          <AllSounds catalog={catalog} track={track} word={noun} />
        </>
      )}
    </div>
  );
}

function KitPads({ track, pattern, step, update, preview, padNote, onPadNote, kitName }: Pick<Props, 'track' | 'pattern' | 'step' | 'update' | 'preview' | 'padNote' | 'onPadNote'> & { kitName: string }) {
  const counts = new Map<number, number>();
  for (const s of track.steps) for (const n of s.notes) counts.set(n.note, (counts.get(n.note) ?? 0) + 1);
  const outside = [...counts.keys()].filter((n) => n < KIT_FIRST_NOTE || n >= KIT_FIRST_NOTE + KIT_SIZE);
  const stepNotesNow = step === null ? [] : stepNotes(track.steps.find((s) => s.index === step));

  const click = (note: number) => {
    preview(track.id, note);
    onPadNote(note);
    if (step !== null && stepNotesNow.length) update((p) => setStepNotes(p, pattern, track.id, step, [{ ...(stepNotesNow[0] ?? { velocity: 100, lengthSteps: 1, micro: 0 }), note }]));
  };

  return (
    <section>
      <h3 className="text-sm font-semibold">Les 24 sons de « {kitName} »</h3>
      <p className="mb-2 text-xs text-zinc-500">
        Cliquez un des 24 sons du kit pour l’écouter : il devient le son des prochaines notes posées dans la grille
        {step !== null && stepNotesNow.length ? <>, et <b>remplace le son du pas {step + 1}</b> sélectionné</> : ' (clic droit sur un pas de la grille pour changer le son de ce pas)'}.
        Gris foncé : sons déjà utilisés dans ce pattern. L’OP-Z ne donne pas le nom de chaque son : ils sont numérotés, écoutez-les d’un clic.
      </p>
      <div className="grid grid-cols-6 gap-1.5">
        {Array.from({ length: KIT_SIZE }, (_, i) => {
          const note = KIT_FIRST_NOTE + i;
          const used = counts.get(note) ?? 0;
          const onStep = stepNotesNow.some((n) => n.note === note);
          const chosen = padNote === note;
          return (
            <button key={note} onClick={() => click(note)} title={`Son ${i + 1} (${noteName(note)})`}
              className={`flex h-12 flex-col items-center justify-center rounded-lg border text-xs transition ${onStep ? 'border-zinc-900 bg-zinc-900 text-white' : used ? 'border-zinc-300 bg-zinc-200 font-semibold' : 'border-zinc-200 text-zinc-500 hover:bg-zinc-50'} ${chosen && !onStep ? 'ring-2 ring-orange-400' : ''}`}>
              <span>{i + 1}</span>
              {used > 0 && <span className={`text-[10px] ${onStep ? 'text-zinc-300' : 'text-zinc-500'}`}>×{used}</span>}
            </button>
          );
        })}
      </div>
      {outside.length > 0 && <p className="mt-2 text-xs text-zinc-500">Notes hors du clavier utilisées : {outside.map(noteName).join(', ')}.</p>}
    </section>
  );
}

function AllSounds({ catalog, track, word }: { catalog: DeviceCatalog; track: ProjectTrack; word: string }) {
  const info = TRACK_INFO[track.id];
  const [open, setOpen] = useState(false);
  const entries = useMemo(() => soundsForTrack(catalog, track.id), [catalog, track.id]);
  const others = entries.filter((e) => e.compatible && !e.placed.some((w) => w.track === track.id))
    .sort((a, b) => Number(b.named) - Number(a.named) || a.name.localeCompare(b.name, 'fr', { numeric: true }));
  if (!others.length) return null;
  return (
    <section>
      <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen(!open)}>
        <h3 className="text-sm font-semibold">Autres {word}s de l’OP-Z ({others.length})</h3>
        <span className="ml-auto text-xs text-zinc-400">{open ? 'masquer' : 'voir'}</span>
      </button>
      <p className="mt-1 text-xs text-zinc-500">
        Ils sont dans l’OP-Z, mais sur aucune touche noire de {info.label} : aucun pattern ne peut les jouer sur cette piste.
        Pour en ajouter un : brancher l’OP-Z en mode disque (« content ») et le glisser dans un emplacement vide de la piste, puis « Relire la liste des sons » (menu OP-Z).
        Le studio ne modifie jamais les sons eux-mêmes.
      </p>
      {open && (
        <ul className="mt-2 max-h-72 divide-y divide-zinc-100 overflow-y-auto rounded-lg border border-zinc-200 text-sm">
          {others.map((e) => {
            const elsewhere = e.placed.map((w) => `${TRACK_INFO[w.track].label} ${w.slot}`).join(', ');
            return (
              <li key={e.id} className="flex items-center gap-2 px-3 py-1.5 text-zinc-500">
                <span className="min-w-0 flex-1 truncate">{e.named ? e.name : `${info.soundWord} n° ${e.id}`}</span>
                <span className="truncate text-[11px] text-zinc-400">{elsewhere ? `sur ${elsewhere}` : 'sur aucune piste'}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
