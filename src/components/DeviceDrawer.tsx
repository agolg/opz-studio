import type { FrameStat } from '../device/useOpzDevice';
import type { CheckpointSummary } from '../storage/checkpoints';

interface Props {
  open: boolean;
  onClose: () => void;
  connected: boolean;
  identity: string[];
  warnings: string[];
  liveWrite: boolean;
  onLiveWrite: (on: boolean) => void;
  autoApply: boolean;
  onAutoApply: (on: boolean) => void;
  checkpoints: CheckpointSummary[];
  onRestore: (id: string) => void;
  canUse: boolean;
  log: string[];
  frames: FrameStat[];
  onDisconnect: () => void;
  onReadCatalog: () => void;
  diagnostics: React.ReactNode;
}

/** Tout ce qui concerne l'appareil, hors du chemin : état, sauvegardes, journal. */
export function DeviceDrawer(p: Props) {
  if (!p.open) return null;
  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-zinc-900/20" onClick={p.onClose}>
      <div className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center">
          <h2 className="text-lg font-semibold">OP-Z</h2>
          <button className="btn btn-ghost ml-auto" onClick={p.onClose}>Fermer</button>
        </div>

        <section className="space-y-2">
          <p className="text-sm">
            <span className={`mr-2 inline-block h-2 w-2 rounded-full ${p.connected ? 'bg-emerald-500' : 'bg-zinc-300'}`} />
            {p.connected ? `Connecté${p.identity.length ? ` · ${p.identity.join(' · ')}` : ''}` : 'Non connecté'}
          </p>
          {p.warnings.map((w) => <p key={w} className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{w}</p>)}
          {p.connected && (
            <div className="flex gap-2">
              <button className="btn text-xs" onClick={p.onReadCatalog} disabled={!p.canUse}>Relire la liste des sons</button>
              <button className="btn btn-ghost text-xs" onClick={p.onDisconnect}>Déconnecter</button>
            </div>
          )}
        </section>

        <section className="mt-6 space-y-2">
          <h3 className="label">Ce que le studio fait sur l’OP-Z</h3>
          <p className="text-xs text-zinc-600">
            Il lit le projet, change de projet et de pattern, fait jouer des notes, et <b>applique vos modifications aux patterns</b> (notes, kit ou moteur choisi parmi les 10 de la piste, réglages, tempo).
            Il ne modifie <b>jamais les sons</b> chargés sur les touches noires.
          </p>
          <label className="flex items-start gap-2 rounded-lg border border-zinc-200 p-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-zinc-900" checked={p.liveWrite} onChange={(e) => p.onLiveWrite(e.target.checked)} />
            <span>Réglages en direct
              <span className="block text-xs text-zinc-500">Curseurs, M et S s’entendent tout de suite sur l’OP-Z (comme ses propres boutons).</span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-lg border border-zinc-200 p-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-zinc-900" checked={p.autoApply} onChange={(e) => p.onAutoApply(e.target.checked)} />
            <span>Appliquer automatiquement
              <span className="block text-xs text-zinc-500">1,5 s après chaque modification, les patterns sont écrits dans l’OP-Z (sauvegarde avant, relecture après, retour arrière en cas de problème). Sinon : bouton « Appliquer à l’OP-Z » en haut.</span>
            </span>
          </label>
        </section>

        <section className="mt-6">
          <h3 className="label mb-2">Sauvegardes des patterns de l’OP-Z</h3>
          <p className="mb-2 text-xs text-zinc-500">Faites automatiquement avant chaque application. « Restaurer » remet les patterns dans cet état.</p>
          {p.checkpoints.length === 0 ? <p className="text-sm text-zinc-400">Aucune pour l’instant.</p> : (
            <ul className="max-h-60 divide-y divide-zinc-100 overflow-y-auto rounded-lg border border-zinc-200">
              {p.checkpoints.map((c) => (
                <li key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div>{new Date(c.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })}</div>
                    <div className="truncate text-xs text-zinc-500">avant : {c.label}</div>
                  </div>
                  <button className="btn px-2 py-1 text-xs" disabled={!p.canUse} onClick={() => p.onRestore(c.id)}>Restaurer</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <details className="mt-6">
          <summary className="label cursor-pointer">Diagnostic</summary>
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap gap-1">
              {p.frames.map((f) => (
                <span key={f.id} className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px]">${f.id.toString(16).toUpperCase().padStart(2, '0')}×{f.count}</span>
              ))}
            </div>
            {p.diagnostics}
          </div>
        </details>

        <section className="mt-6 min-h-0 flex-1">
          <h3 className="label mb-2">Journal</h3>
          <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 font-mono text-[11px] leading-4 text-zinc-600">{p.log.join('\n') || '—'}</pre>
        </section>
      </div>
    </div>
  );
}
