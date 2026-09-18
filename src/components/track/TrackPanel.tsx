import type { Result } from '../../lib/result';
import type { DeviceCatalog } from '../../project/catalog';
import { plugName } from '../../project/catalog';
import type { OpzProject, ProjectPattern, ProjectTrack } from '../../project/opzProject';
import { TRACK_INFO } from '../../project/trackTypes';
import { SettingsTab } from './SettingsTab';
import { SoundTab } from './SoundTab';
import { StepsTab } from './StepsTab';
import { TrackTab } from './TrackTab';

export type TrackTabId = 'son' | 'reglages' | 'pas' | 'piste';

interface Props {
  project: OpzProject;
  pattern: number;
  patternData: ProjectPattern;
  track: ProjectTrack;
  step: number | null;
  tab: TrackTabId;
  catalog: DeviceCatalog | null;
  canReadCatalog: boolean;
  padNote: number | null;
  onPadNote: (note: number) => void;
  onTab: (t: TrackTabId) => void;
  onStep: (s: number) => void;
  onReadCatalog: () => void;
  update: (fn: (p: OpzProject) => Result<OpzProject, Error>) => boolean;
  preview: (track: number, note: number, velocity?: number) => void;
}

/** Tout sur la piste sélectionnée, en quatre onglets. */
export function TrackPanel(p: Props) {
  const info = TRACK_INFO[p.track.id];
  const tabs: [TrackTabId, string][] = [['son', info.soundWord], ['reglages', 'Réglages'], ['pas', 'Pas'], ['piste', 'Piste']];
  return (
    <aside className="card flex min-h-0 flex-col">
      <div className="border-b border-zinc-200 px-5 pt-4">
        <div className="flex items-center gap-2">
          <span className={`h-3 w-3 rounded-full ${info.dot}`} />
          <h2 className="text-lg font-semibold">{info.label}</h2>
          <span className="truncate text-sm text-zinc-500">· {plugName(p.catalog, p.track.plug, info.soundWord)}</span>
        </div>
        <p className="mt-1 text-sm text-zinc-500">{info.description}</p>
        <nav className="-mb-px mt-3 flex">
          {tabs.map(([id, label]) => (
            <button key={id} className={`tab ${p.tab === id ? 'tab-active' : ''}`} onClick={() => p.onTab(id)}>{label}</button>
          ))}
        </nav>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {p.tab === 'son' && <SoundTab pattern={p.pattern} track={p.track} step={p.step} catalog={p.catalog} connected={p.canReadCatalog} onReadCatalog={p.onReadCatalog} update={p.update} preview={p.preview} padNote={p.padNote} onPadNote={p.onPadNote} />}
        {p.tab === 'reglages' && <SettingsTab project={p.project} pattern={p.pattern} track={p.track} catalog={p.catalog} update={p.update} />}
        {p.tab === 'pas' && <StepsTab project={p.project} pattern={p.pattern} track={p.track} step={p.step} onStep={p.onStep} update={p.update} preview={p.preview} />}
        {p.tab === 'piste' && <TrackTab pattern={p.patternData} track={p.track} update={p.update} />}
      </div>
    </aside>
  );
}
