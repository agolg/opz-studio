import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Fenêtres de dialogue de l'éditeur (remplacent window.confirm / alert).
 * `ask` : question oui / non. `choose` : choix parmi des boutons.
 */
export interface AskOptions {
  title: string;
  message?: React.ReactNode;
  confirm?: string;
  cancel?: string;
  tone?: 'normal' | 'danger';
}

export interface ChooseOptions<T> {
  title: string;
  message?: React.ReactNode;
  options: { label: string; value: T; hint?: string }[];
  initial?: T;
  cancel?: string;
}

type Pending =
  | { kind: 'ask'; opts: AskOptions; resolve: (v: boolean) => void }
  | { kind: 'choose'; opts: ChooseOptions<unknown>; resolve: (v: unknown) => void };

export function useDialog() {
  const [pending, setPending] = useState<Pending | null>(null);
  const ask = useCallback((opts: AskOptions) => new Promise<boolean>((resolve) => setPending({ kind: 'ask', opts, resolve })), []);
  const choose = useCallback(<T,>(opts: ChooseOptions<T>) => new Promise<T | null>((resolve) =>
    setPending({ kind: 'choose', opts: opts as ChooseOptions<unknown>, resolve: resolve as (v: unknown) => void })), []);
  const close = useCallback((value: unknown) => {
    setPending((p) => {
      if (p?.kind === 'ask') p.resolve(value === true);
      else if (p) p.resolve(value);
      return null;
    });
  }, []);
  const host = pending ? <DialogView pending={pending} close={close} /> : null;
  return { ask, choose, host };
}

function DialogView({ pending, close }: { pending: Pending; close: (v: unknown) => void }) {
  const first = useRef<HTMLButtonElement>(null);
  const cancelValue = pending.kind === 'ask' ? false : null;
  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(cancelValue); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, cancelValue]);
  const { title, message } = pending.opts;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/30 p-4" onMouseDown={(e) => e.target === e.currentTarget && close(cancelValue)}>
      <div role="dialog" aria-modal="true" aria-labelledby="dlg-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 id="dlg-title" className="text-lg font-semibold">{title}</h2>
        {message && <div className="mt-2 space-y-2 text-sm text-zinc-600">{message}</div>}
        {pending.kind === 'ask' ? (
          <div className="mt-6 flex justify-end gap-2">
            <button className="btn" onClick={() => close(false)}>{pending.opts.cancel ?? 'Annuler'}</button>
            <button ref={first} className={`btn ${pending.opts.tone === 'danger' ? 'border-red-600 bg-red-600 text-white hover:bg-red-500' : 'btn-dark'}`} onClick={() => close(true)}>
              {pending.opts.confirm ?? 'Continuer'}
            </button>
          </div>
        ) : (
          <>
            <div className={`mt-4 gap-2 ${pending.opts.options.length <= 4 ? 'flex flex-col' : 'grid grid-cols-5'}`}>
              {pending.opts.options.map((o, i) => (
                <button key={i} ref={o.value === pending.opts.initial ? first : undefined} title={o.hint}
                  className={`btn ${pending.opts.options.length <= 4 ? 'justify-center py-2.5' : 'h-12 text-base'} ${o.value === pending.opts.initial ? 'btn-dark' : ''}`} onClick={() => close(o.value)}>
                  {o.label}
                </button>
              ))}
            </div>
            <div className="mt-5 flex justify-end">
              <button className="btn btn-ghost" onClick={() => close(null)}>{pending.opts.cancel ?? 'Annuler'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
