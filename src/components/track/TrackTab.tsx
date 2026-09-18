import type { Result } from '../../lib/result';
import { setTrackSettings, type TrackSettings } from '../../project/edit';
import type { OpzProject, ProjectPattern, ProjectTrack } from '../../project/opzProject';
import { NOTE_STYLES_DRUM, NOTE_STYLES_SYNTH, noteLengthName, TRACK_INFO } from '../../project/trackTypes';

interface Props {
  pattern: ProjectPattern;
  track: ProjectTrack;
  update: (fn: (p: OpzProject) => Result<OpzProject, Error>) => boolean;
}

const STEP_LENGTHS = [1, 2, 3, 4, 6, 8, 12, 16];
/** Valeur brute au milieu de la tranche i (0..n-1) : ce que l'OP-Z affichera comme choix i. */
const bucketValue = (i: number, n: number) => Math.min(255, Math.round(((i + 0.5) / n) * 255));

/**
 * Sur l'OP-Z, ces réglages sont enregistrés pour CHAQUE piste de CHAQUE pattern
 * (fiche de piste de 12 octets dans le pattern). Seuls le tempo et le swing sont communs au projet.
 */
export function TrackTab({ pattern, track, update }: Props) {
  const info = TRACK_INFO[track.id];
  const drum = info.kind === 'drum' || info.kind === 'sample';
  const styles = drum ? NOTE_STYLES_DRUM : NOTE_STYLES_SYNTH;
  const set = (s: TrackSettings) => update((p) => setTrackSettings(p, pattern.id, track.id, s));
  const setAll = (s: TrackSettings) => update((p) => {
    let next: Result<OpzProject, Error> = { ok: true, value: p };
    for (const t of pattern.tracks) if (next.ok) next = setTrackSettings(next.value, pattern.id, t.id, s);
    return next;
  });

  return (
    <div className="space-y-6 text-sm">
      <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
        Sur l’OP-Z, ces réglages sont propres à chaque piste et à chaque pattern : la piste {info.label} peut avoir 12 pas dans le pattern {pattern.id + 1} et 16 dans un autre.
        Le tempo et le swing, eux, valent pour tout le projet.
      </p>

      <section className="space-y-4">
        <h3 className="label">Rythme de la piste</h3>
        <Row label="Nombre de pas" hint="La piste boucle sur ce nombre de pas. Des longueurs différentes entre pistes créent des polyrythmes.">
          <select className="field" value={track.step_count} onChange={(e) => set({ step_count: Number(e.target.value) })}>
            {Array.from({ length: 16 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} pas</option>)}
          </select>
        </Row>
        <Row label="Vitesse" hint="×1 : un pas = une double-croche. ×2 : deux fois plus lent, etc.">
          <select className="field" value={Math.max(1, track.step_length)} onChange={(e) => set({ step_length: Number(e.target.value) })}>
            {[...new Set([...STEP_LENGTHS, Math.max(1, track.step_length)])].sort((a, b) => a - b).map((n) => <option key={n} value={n}>×{n}</option>)}
          </select>
        </Row>
        <button className="btn text-xs" onClick={() => setAll({ step_count: track.step_count, step_length: Math.max(1, track.step_length) })}>
          Appliquer ce rythme ({track.step_count} pas, ×{Math.max(1, track.step_length)}) à toutes les pistes du pattern
        </button>
      </section>

      <section className="space-y-4">
        <h3 className="label">Jeu des notes</h3>
        <Row label="Style de note" hint={drum ? 'Retrig : chaque note relance le son. Mono : une seule voix. Gate : le son s’arrête au relâchement. Boucle : le son boucle.' : 'Poly : plusieurs notes à la fois. Mono : une seule. Legato : liées, sans réattaque.'}>
          <select className="field" value={Math.min(styles.length - 1, Math.floor((track.note_style / 255) * styles.length))}
            onChange={(e) => set({ note_style: bucketValue(Number(e.target.value), styles.length) })}>
            {styles.map((s, i) => <option key={s} value={i}>{s}</option>)}
          </select>
        </Row>
        <Row label="Piste coupée" hint="Coupe la piste dans ce pattern (bouton M de la grille).">
          <input type="checkbox" className="h-4 w-4 accent-zinc-900" checked={track.muted} onChange={(e) => set({ muted: e.target.checked })} />
        </Row>
      </section>

      <details className="rounded-lg border border-zinc-200 p-3">
        <summary className="cursor-pointer text-sm font-medium">Enregistrement en direct sur l’OP-Z</summary>
        <p className="mt-1 text-xs text-zinc-500">Ces deux réglages ne servent que lorsque vous jouez sur les touches de l’OP-Z en mode enregistrement. Ils n’agissent pas sur les notes déjà placées.</p>
        <div className="mt-3 space-y-4">
          <Row label={`Longueur des notes enregistrées : ${noteLengthName(track.note_length)}`} hint="Durée donnée aux notes jouées au clavier.">
            <input type="range" min={0} max={255} value={track.note_length} onChange={(e) => set({ note_length: Number(e.target.value) })} />
          </Row>
          <Row label={`Quantification : ${Math.round((track.quantize / 255) * 100)} %`} hint="Force avec laquelle les notes jouées sont recalées sur la grille.">
            <input type="range" min={0} max={255} value={track.quantize} onChange={(e) => set({ quantize: Number(e.target.value) })} />
          </Row>
        </div>
      </details>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1">
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-xs text-zinc-500">{hint}</div>
      </div>
      <div className="w-40 justify-self-end text-right">{children}</div>
    </div>
  );
}
