import type { ImportStep } from '../device/useOpzDevice';

/** Voile d'attente pendant un échange avec l'OP-Z (import, envoi) : on voit ce qui se passe. */
export function BusyOverlay({ text, steps }: { text: string | null; steps?: ImportStep[] | null }) {
  if (!text) return null;
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-white/70 backdrop-blur-[2px]" role="status" aria-live="polite">
      <div className={`card flex flex-col items-center gap-4 px-8 py-7 shadow-lg ${steps ? 'w-[30rem]' : 'w-96 text-center'}`}>
        <div className="flex gap-1.5" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="h-3 w-3 animate-bounce rounded-full bg-zinc-900" style={{ animationDelay: `${i * 120}ms` }} />
          ))}
        </div>
        <div className="text-center">
          <div className="font-medium">{text}</div>
          <div className="mt-1 text-xs text-zinc-500">Ne débranchez pas l’OP-Z. Rien n’est modifié sur l’appareil pendant l’import.</div>
        </div>
        {steps && (
          <ol className="w-full space-y-2.5 text-sm">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                  s.state === 'done' ? 'bg-emerald-500 text-white' : s.state === 'failed' ? 'bg-red-500 text-white' : s.state === 'doing' ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-400'}`}>
                  {s.state === 'done' ? '✓' : s.state === 'failed' ? '!' : i + 1}
                </span>
                <span className="min-w-0">
                  <span className={`block ${s.state === 'todo' ? 'text-zinc-400' : 'font-medium'}`}>
                    {s.label}{s.state === 'doing' && <span className="text-zinc-400"> — en cours…</span>}
                  </span>
                  <span className="block text-xs text-zinc-500">{s.result ? <b className={s.state === 'failed' ? 'text-red-600' : 'text-emerald-700'}>{s.result}</b> : s.detail}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
