import type { Result } from '../../lib/result';
import type { DeviceCatalog } from '../../project/catalog';
import { plugName } from '../../project/catalog';
import { findTrack, setSound } from '../../project/edit';
import type { OpzProject, ProjectTrack } from '../../project/opzProject';
import { paramPages, TRACK_INFO } from '../../project/trackTypes';

interface Props {
  project: OpzProject;
  pattern: number;
  track: ProjectTrack;
  catalog: DeviceCatalog | null;
  update: (fn: (p: OpzProject) => Result<OpzProject, Error>) => boolean;
}

/** Les 18 réglages de son de la piste, rangés comme les pages de l'OP-Z, avec leurs vraies valeurs. */
export function SettingsTab({ project, pattern, track, catalog, update }: Props) {
  const kind = TRACK_INFO[track.id].kind;
  const fxNames: [string, string] = [plugName(catalog, findTrack(project, pattern, 8)?.plug ?? 0, 'Effet'), plugName(catalog, findTrack(project, pattern, 9)?.plug ?? 0, 'Effet')];
  const pages = paramPages(kind, fxNames);
  const visible = pages;

  return (
    <div className="space-y-4">
      {visible.map((page) => (
        <section key={page.title} className="rounded-xl border border-zinc-200 p-4">
          <div className="mb-3 flex items-baseline gap-2">
            <h3 className="text-sm font-semibold">{page.title}</h3>
            <span className="text-xs text-zinc-400">{page.hint}</span>
          </div>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {page.params.map((d) => (
              <label key={d.param} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
                <span className="text-sm text-zinc-700">{d.label}</span>
                <span className="text-right text-sm font-medium tabular-nums">{d.format(track.sound[d.param], kind)}</span>
                <input className="col-span-2" type="range" min={0} max={255} value={track.sound[d.param]}
                  onChange={(e) => update((p) => setSound(p, pattern, track.id, d.param, Number(e.target.value)))} />
              </label>
            ))}
          </div>
        </section>
      ))}
      <p className="text-xs text-zinc-500">Ces réglages sont enregistrés dans chaque pattern (comme sur l’OP-Z). Ils s’entendent tout de suite et sont appliqués à l’OP-Z. Les presets de l’OP-Z (touche piste + touches blanches) sont rangés dans l’appareil, pas dans le pattern.</p>
    </div>
  );
}
