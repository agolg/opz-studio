import type { Result } from '../lib/result';
import type { DeviceCatalog } from '../project/catalog';
import { plugName } from '../project/catalog';
import { setPlug, setSound } from '../project/edit';
import type { SoundParam } from '../project/layout';
import type { OpzProject, ProjectPattern } from '../project/opzProject';
import { paramPages, TRACK_INFO } from '../project/trackTypes';

interface Props {
  pattern: ProjectPattern;
  catalog: DeviceCatalog | null;
  update: (fn: (p: OpzProject) => Result<OpzProject, Error>) => boolean;
  /** Les curseurs agissent-ils aussi sur l'OP-Z (réglages en direct activés) ? */
  live: boolean;
  /** Ouvre tous les réglages d'une piste dans le panneau de droite. */
  onOpen: (track: number) => void;
}

const pct = (v: number) => Math.round((v / 255) * 100);

/**
 * Mixage et effets, en une seule vue :
 *  - chaque instrument : volume, part envoyée vers FX 1 et FX 2 (page 4 de la piste sur l'OP-Z) ;
 *  - FX 1, FX 2, Tape, Master : quel effet, et ses réglages principaux.
 * Curseurs : CC en direct (si activé), puis application automatique des patterns.
 */
export function SignalFlow({ pattern, catalog, update, onOpen, live }: Props) {
  const track = (id: number) => pattern.tracks.find((t) => t.id === id);
  const set = (t: number, param: SoundParam, v: number) => update((p) => setSound(p, pattern.id, t, param, v));
  const fxName = (id: number) => { const t = track(id); return t ? plugName(catalog, t.plug, TRACK_INFO[id].soundWord) : ''; };

  // Fonctions (pas des composants) : un composant recréé à chaque rendu casserait le glisser des curseurs.
  const slider = (t: number, param: SoundParam, label?: string) => {
    const v = track(t)?.sound[param] ?? 0;
    return (
      <label key={`${t}-${param}`} className="flex items-center gap-2 text-xs text-zinc-500" title={label}>
        {label && <span className="w-20 shrink-0 truncate">{label}</span>}
        <input type="range" min={0} max={255} value={v} className="min-w-0 flex-1" onChange={(e) => set(t, param, Number(e.target.value))} />
        <span className="w-8 text-right tabular-nums text-zinc-700">{pct(v)}</span>
      </label>
    );
  };

  const unit = (id: number, hint: string) => {
    const t = track(id);
    const info = TRACK_INFO[id];
    const slots = catalog?.slots.get(id) ?? [];
    const page = paramPages(info.kind, ['', ''])[0];
    return (
      <div key={id} className="rounded-xl border border-zinc-200 p-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${info.dot}`} />
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{info.label}</span>
          <button className="ml-auto text-[11px] text-zinc-400 hover:text-zinc-700" onClick={() => onOpen(id)}>tous les réglages →</button>
        </div>
        {slots.length > 0 && t ? (
          <select className="field mt-1 w-full font-medium" value={t.plug} onChange={(e) => update((p) => setPlug(p, pattern.id, id, Number(e.target.value)))}
            title="Effet utilisé par ce pattern (parmi ceux des touches noires de la piste)">
            {!slots.some((r) => r.id === t.plug) && <option value={t.plug}>{fxName(id)}</option>}
            {slots.map((r) => <option key={r.slot} value={r.id}>{plugName(catalog, r.id, info.soundWord)}</option>)}
          </select>
        ) : <div className="mt-1 font-medium">{fxName(id)}</div>}
        <p className="mb-2 mt-0.5 text-[11px] text-zinc-400">{hint}</p>
        <div className="space-y-1">
          {page.params.map((d) => slider(id, d.param, d.label))}
        </div>
      </div>
    );
  };

  return (
    <section className="mt-5 max-w-[960px] rounded-2xl border border-zinc-200 bg-white p-5">
      <h3 className="text-base font-semibold">Mixage et effets · pattern {pattern.id + 1}</h3>
      <p className="mb-4 text-xs text-zinc-500">
        Le son de chaque instrument va vers la sortie ; une part peut aussi passer par l’effet 1 et l’effet 2 (réglée ici).
        Tout le mélange traverse ensuite la bande (Tape) puis le Master.
        {live ? ' Les curseurs s’entendent tout de suite sur l’OP-Z quand il joue ce pattern.' : ' Ils sont appliqués à l’OP-Z quand il est connecté.'}
      </p>

      <div className="grid grid-cols-[7rem_1fr_1fr_1fr] items-center gap-x-4 gap-y-1.5">
        <span />
        <span className="label">Volume</span>
        <span className="label truncate">Vers FX 1 · {fxName(8)}</span>
        <span className="label truncate">Vers FX 2 · {fxName(9)}</span>
        {Array.from({ length: 8 }, (_, id) => (
          <div key={id} className="contents">
            <button className="flex items-center gap-2 text-left text-sm font-medium hover:underline" onClick={() => onOpen(id)}>
              <span className={`h-2 w-2 rounded-full ${TRACK_INFO[id].dot}`} />{TRACK_INFO[id].label}
            </button>
            {slider(id, 'level')}
            {slider(id, 'fx1')}
            {slider(id, 'fx2')}
          </div>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {unit(8, "reçoit les envois « FX 1 »")}
        {unit(9, "reçoit les envois « FX 2 »")}
        {unit(10, "tout le mélange passe par la bande")}
        {unit(11, "dernier traitement avant la sortie")}
      </div>
    </section>
  );
}
