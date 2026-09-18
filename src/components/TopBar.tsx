interface Props {
  name: string | null;
  fileName: string | null;
  dirty: boolean;
  status: 'idle' | 'connecting' | 'connected' | 'error';
  busy: string | null;
  canImport: boolean;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onRename: (name: string) => void;
  onConnect: () => void;
  onImport: () => void;
  onDevice: () => void;
  /** État de l'application des patterns à l'OP-Z. */
  applyState: 'none' | 'done' | 'pending' | 'applying' | 'error';
  onApply: () => void;
  /** Réglages de l'OP-Z qui gênent l'écoute (affichés sans décaler la page). */
  warnings: string[];
}

/** Barre du haut : le projet à gauche, l'OP-Z à droite. */
export function TopBar(p: Props) {
  const connected = p.status === 'connected';
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-5 py-3">
      <span className="text-base font-semibold tracking-tight">OP-Z Studio</span>
      <span className="h-5 w-px bg-zinc-200" />
      {p.name !== null ? (
        <div className="flex items-center gap-2">
          <input className="w-56 rounded-md px-1.5 py-1 text-sm font-medium hover:bg-zinc-50 focus:bg-white focus:outline focus:outline-zinc-300"
            value={p.name} onChange={(e) => p.onRename(e.target.value)} aria-label="Nom du projet" />
          <span className="text-xs text-zinc-400">{p.dirty ? '● non enregistré' : p.fileName ?? ''}</span>
        </div>
      ) : (
        <span className="text-sm text-zinc-400">Aucun projet</span>
      )}
      <div className="flex gap-1">
        <button className="btn btn-ghost" onClick={p.onNew}>Nouveau</button>
        <button className="btn btn-ghost" onClick={p.onOpen}>Ouvrir…</button>
        <button className="btn" onClick={p.onSave} disabled={p.name === null} title="Enregistrer sur l’ordinateur (Ctrl+S)">Enregistrer</button>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {p.busy && <span className="max-w-72 truncate text-xs text-zinc-500">{p.busy}</span>}
        {connected ? (
          <>
            {p.applyState !== 'none' && (
              <button className={`btn w-52 justify-center ${p.applyState === 'error' ? 'border-red-300 bg-red-50 text-red-700' : p.applyState === 'done' ? 'text-emerald-700' : 'border-orange-300 bg-orange-50 text-orange-800'}`}
                onClick={p.onApply} disabled={p.applyState === 'applying' || p.applyState === 'done'}
                title="Les patterns de l’OP-Z suivent le studio : chaque modification y est appliquée automatiquement (sauvegarde avant, relecture après). Les sons des touches noires ne sont jamais modifiés.">
                {p.applyState === 'done' ? '✓ OP-Z à jour' : p.applyState === 'applying' ? 'Application à l’OP-Z…' : p.applyState === 'error' ? '! Réessayer l’application' : '● Appliquer à l’OP-Z'}
              </button>
            )}
            <button className="btn" onClick={p.onImport} disabled={!p.canImport} title="Relire le projet ouvert sur l’OP-Z (rien n’est modifié sur l’appareil)">Importer depuis l’OP-Z</button>
          </>
        ) : (
          <button className="btn btn-dark" onClick={p.onConnect} disabled={p.status === 'connecting'}>
            {p.status === 'connecting' ? 'Connexion…' : 'Connecter l’OP-Z'}
          </button>
        )}
        {p.warnings.length > 0 && (
          <button className="btn border-amber-300 bg-amber-50 text-amber-900" onClick={p.onDevice} title={p.warnings.join('\n\n')}>
            ⚠ Réglage OP-Z
          </button>
        )}
        <button className="btn btn-ghost" onClick={p.onDevice} title="Appareil, sauvegardes, journal">
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : p.status === 'error' ? 'bg-red-500' : 'bg-zinc-300'}`} />
          OP-Z
        </button>
      </div>
    </header>
  );
}
