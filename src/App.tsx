import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BusyOverlay } from './components/BusyOverlay';
import { useDialog } from './components/Dialog';
import { DeviceDrawer } from './components/DeviceDrawer';
import { Sequencer, type Cell } from './components/Sequencer';
import { TopBar } from './components/TopBar';
import { TrackPanel, type TrackTabId } from './components/track/TrackPanel';
import { Transport } from './components/Transport';
import { SignalFlow } from './components/SignalFlow';
import { allProjectNames, patternNames as storedPatternNames, projectName as storedProjectName, setPatternNames as storePatternNames, setProjectName as storeProjectName } from './storage/names';
import { globalStableEqual, projectOfAddress, pushToOpz } from './device/pushToOpz';
import { bytesEqual } from './lib/bytes';
import { deviceWriteProblems, projectRawBytes, projectToBytes } from './project/opzProject';
import { listCheckpoints, loadCheckpoint, saveCheckpoint, type CheckpointSummary } from './storage/checkpoints';
import { useOpzDevice } from './device/useOpzDevice';
import { playChain, usePlayer } from './device/usePlayer';
import { describeSteps, liveDiff, sendSwitch, SWITCH_METHODS } from './sequencer/liveControl';
import { channelsFor } from './sequencer/compile';
import { downloadBytes, timestamp } from './lib/download';
import { webMidiSupported } from './midi/transport';
import { buildCatalog } from './project/catalog';
import { defaultNoteFor, findTrack, setDeviceCatalog, pastePattern, pasteTrack, setPatternName, setPlayChain, setTempo, setTrackSettings, toggleStep } from './project/edit';
import type { ProjectPattern, ProjectTrack } from './project/opzProject';
import { TRACK_INFO } from './project/trackTypes';
import { useProject } from './state/useProject';

type Notice = { tone: 'ok' | 'error' | 'info'; text: string };

export default function App() {
  const opz = useOpzDevice();
  const dialog = useDialog();
  const project = useProject(opz.log, dialog.ask);
  const [pattern, setPattern] = useState(0);
  const patternRef = useRef(0);
  patternRef.current = pattern;
  const [track, setTrack] = useState(0);
  const [step, setStep] = useState<number | null>(null);
  const [tab, setTab] = useState<TrackTabId>('son');
  const [drawer, setDrawer] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    if (!notice || notice.tone === 'error') return;
    const t = setTimeout(() => setNotice(null), notice.tone === 'ok' ? 5000 : 9000);
    return () => clearTimeout(t);
  }, [notice]);

  // Suivi du pattern : l'OP-Z passe sur le pattern choisi ici par MIDI officiel (liveControl.ts),
  // jamais par $07 (a fait planter un OP-Z réel le 18/09/2026).
  const [pcFollow, setPcFollowState] = useState<boolean>(() => {
    try { return localStorage.getItem('opz-pc-follow') !== '0'; } catch { return true; }
  });
  // Pistes d'effets / sortie / contrôle dans la grille : masquées par défaut (elles sont résumées sous la grille).
  const [advanced, setAdvancedState] = useState<boolean>(() => {
    try { return localStorage.getItem('opz-advanced-tracks') === '1'; } catch { return false; }
  });
  const setAdvanced = (v: boolean) => {
    setAdvancedState(v);
    try { localStorage.setItem('opz-advanced-tracks', v ? '1' : '0'); } catch { /* sans importance */ }
  };
  const [projectNames, setProjectNames] = useState<string[]>(allProjectNames);
  const gridTracks = useMemo(() => (advanced ? Array.from({ length: 16 }, (_, i) => i) : [0, 1, 2, 3, 4, 5, 6, 7]), [advanced]);
  // Décision du propriétaire (18/09, soir) : le studio applique aux PATTERNS de l'OP-Z (réglages en direct
  // par CC, puis patterns envoyés automatiquement) ; les sons chargés sur les touches noires ne sont jamais modifiés.
  const [liveWrite, setLiveWriteState] = useState<boolean>(() => {
    try { return localStorage.getItem('opz-live-write') !== '0'; } catch { return true; }
  });
  const [autoApply, setAutoApplyState] = useState<boolean>(() => {
    try { return localStorage.getItem('opz-auto-apply') !== '0'; } catch { return true; }
  });
  const setAutoApply = (v: boolean) => {
    setAutoApplyState(v);
    try { localStorage.setItem('opz-auto-apply', v ? '1' : '0'); } catch { /* */ }
  };
  const [checkpoints, setCheckpoints] = useState<CheckpointSummary[]>([]);
  const refreshCheckpoints = useCallback(() => void listCheckpoints().then(setCheckpoints), []);
  useEffect(refreshCheckpoints, [refreshCheckpoints]);
  const setLiveWrite = (v: boolean) => {
    setLiveWriteState(v);
    try { localStorage.setItem('opz-live-write', v ? '1' : '0'); } catch { /* */ }
  };
  // Note choisie sur les pads du kit, par piste : utilisée pour les nouvelles notes posées dans la grille.
  const [padNote, setPadNote] = useState<Record<number, number>>({});
  const setPcFollow = (v: boolean) => {
    setPcFollowState(v);
    try { localStorage.setItem('opz-pc-follow', v ? '1' : '0'); } catch { /* sans importance */ }
  };
  const followRef = useRef<((pt: number, startAt: number) => void) | null>(null);
  // Solo : écoute d'une ou plusieurs pistes seules (n'est pas enregistré dans le projet).
  const [solo, setSolo] = useState<ReadonlySet<number>>(new Set());
  const toggleSolo = (t: number, additive: boolean) => setSolo((prev) => {
    if (additive) {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    }
    return prev.has(t) && prev.size === 1 ? new Set() : new Set([t]);
  });
  const playGuard = useRef<(() => boolean) | null>(null);
  const player = usePlayer(opz.noteOutput, project.latest, patternRef, followRef, solo, playGuard);
  const connected = opz.status === 'connected';
  const idle = connected && opz.busy === null;
  const p = project.project;
  const current = p?.patterns.find((x) => x.id === pattern) ?? null;
  const currentTrack = p ? findTrack(p, pattern, track) : undefined;
  const catalog = useMemo(() => buildCatalog(p?.device_catalog), [p?.device_catalog]);

  // Ce qui est dans l'éditeur mais pas encore dans l'OP-Z (comparaison avec les octets de référence).
  const unsent = useMemo(() => {
    if (!p || p.meta.source !== 'opz-import') return false;
    const bytes = projectToBytes(p);
    const raw = projectRawBytes(p);
    if (!bytes.ok || !raw.ok) return false;
    return !bytesEqual(bytes.value.bank, raw.value.bank) || !globalStableEqual(bytes.value.global, raw.value.global);
  }, [p]);

  /** Projet de l'OP-Z montré dans l'éditeur : celui rapporté par l'appareil au moment de l'import. */
  const shownProject = p?.meta.device_project ?? null;
  const devicePosRef = useRef(opz.devicePos);
  devicePosRef.current = opz.devicePos;
  // Dernier projet / pattern demandé à l'OP-Z depuis le studio.
  const [assumed, setAssumed] = useState<{ project: number; pattern: number } | null>(null);
  const assumedPos = useRef(assumed);
  const assume = (v: { project: number; pattern: number } | null) => { assumedPos.current = v; setAssumed(v); };
  // L'annonce $07 n'est pas fiable pour le projet ; pour le pattern (quartet bas de l'octet 17)
  // on s'en sert seulement comme alarme : si l'OP-Z annonce un autre pattern que celui qu'on lui
  // a demandé (plus d'une seconde après), c'est qu'on l'a changé sur l'appareil → position inconnue.
  const lastSwitchAt = useRef(0);
  useEffect(() => {
    const cur = assumedPos.current;
    if (!cur || !opz.devicePos || performance.now() - lastSwitchAt.current < 1000) return;
    if (opz.devicePos.pattern !== cur.pattern) {
      opz.log(`L’OP-Z annonce le pattern ${opz.devicePos.pattern + 1} (demandé : ${cur.pattern + 1}) : réglages en direct suspendus jusqu’au prochain choix de pattern.`);
      assume(null);
    }
  }, [opz.devicePos]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Où est l'OP-Z : dernier pattern qu'on lui a demandé (null = inconnu). */
  const devicePosition = assumed;
  const incomingOff = !!p?.midi_config && !(p.midi_config.settings & 0b10);
  const liveProblem = !connected ? 'OP-Z non connecté'
    : incomingOff ? 'l’entrée MIDI de l’OP-Z est éteinte : maintenir tempo + écran, allumer la touche 2'
    : null;
  const pcBlocked = liveProblem ?? (shownProject === null ? 'projet ouvert d’une ancienne version : réimportez-le depuis l’OP-Z' : null);
  const patternNamesNow = Array.from({ length: 16 }, (_, i) => p?.meta.pattern_names?.[i] ?? '');
  // Façon de changer de pattern / projet qui marche sur CET OP-Z (trouvée une fois avec l'utilisateur).
  const [switchMethodId, setSwitchMethodIdState] = useState<string | null>(() => {
    try { return localStorage.getItem('opz-switch-method'); } catch { return null; }
  });
  const setSwitchMethodId = (id: string | null) => {
    setSwitchMethodIdState(id);
    try { if (id) localStorage.setItem('opz-switch-method', id); else localStorage.removeItem('opz-switch-method'); } catch { /* */ }
  };
  const switchMethod = SWITCH_METHODS.find((m) => m.id === switchMethodId) ?? SWITCH_METHODS[0];
  /** Fait passer l'OP-Z sur un pattern du projet affiché. */
  const sendPattern = useCallback((pt: number, atMs?: number) => {
    if (!pcFollow || pcBlocked || shownProject === null || !opz.liveOutput) return;
    const steps = switchMethod.build(shownProject, pt);
    if (!steps) return;
    sendSwitch(opz.liveOutput, steps, atMs);
    lastSwitchAt.current = Math.max(performance.now(), atMs ?? 0);
    assume({ project: shownProject, pattern: pt });
    opz.log(`Pattern ${pt + 1} demandé à l’OP-Z : ${describeSteps(steps)}`);
  }, [pcFollow, pcBlocked, shownProject, opz.liveOutput, opz.log, switchMethod]);
  followRef.current = pcFollow && !pcBlocked ? (pt, startAt) => sendPattern(pt, Math.max(performance.now(), startAt - 20)) : null;
  const selectPattern = (pt: number) => {
    setPattern(pt);
    if (!player.playing || player.mode === 'pattern') sendPattern(pt);
  };

  // Modifications en cours de lecture : appliquées tout de suite, et réglages / muets
  // envoyés en direct à l'OP-Z (CC officiels) s'il joue bien ce projet et ce pattern.
  const lastProject = useRef(p);
  useEffect(() => {
    const before = lastProject.current;
    lastProject.current = p;
    if (!p || !before || before === p) return;
    player.refresh();
    const pos = assumedPos.current;
    // Pendant une application, pas de CC : l'OP-Z doit relire exactement ce qui vient d'être écrit.
    if (!liveWrite || applying.current || !opz.liveOutput || liveProblem || shownProject === null || !pos || pos.project !== shownProject) return;
    if (before.meta.device_project !== p.meta.device_project) return;
    const a = before.patterns.find((x) => x.id === pos.pattern);
    const b = p.patterns.find((x) => x.id === pos.pattern);
    if (!a || !b || a === b) return;
    for (const m of liveDiff(a, b, p.midi_config, channelsFor(p))) opz.liveOutput.cc(m);
  }, [p]); // eslint-disable-line react-hooks/exhaustive-deps

  // Solo sur l'OP-Z : les autres pistes sont coupées en direct (CC 53), puis remises comme dans le pattern.
  useEffect(() => {
    const cur = project.latest.current;
    const pos = assumedPos.current;
    if (!liveWrite || !cur || !opz.liveOutput || liveProblem || shownProject === null || !pos || pos.project !== shownProject) return;
    const pt = cur.patterns.find((x) => x.id === pos.pattern);
    if (!pt) return;
    const ch = channelsFor(cur);
    for (const t of pt.tracks) {
      const mute = solo.size ? !solo.has(t.id) : t.muted;
      opz.liveOutput.cc({ channel: ch[t.id] ?? t.id, cc: 53, value: mute ? 1 : 0 });
    }
  }, [solo]); // eslint-disable-line react-hooks/exhaustive-deps

  // Deux lectures en même temps (l'OP-Z joue son pattern + l'éditeur envoie ses notes) = son doublé
  // et décalé. Dès que l'OP-Z joue lui-même, l'éditeur arrête ses notes et suit son horloge.
  useEffect(() => {
    if (opz.deviceRunning && player.playing) {
      player.stop();
      setNotice({ tone: 'info', text: 'L’OP-Z s’est mis à jouer : l’éditeur arrête ses propres notes (sinon tout serait joué deux fois) et suit l’OP-Z.' });
    }
  }, [opz.deviceRunning]); // eslint-disable-line react-hooks/exhaustive-deps
  playGuard.current = () => {
    if (!opz.deviceRunning) return true;
    setNotice({ tone: 'info', text: 'L’OP-Z joue déjà son pattern : l’éditeur le suit. Pour écouter depuis l’éditeur (modifications pas encore envoyées), arrêtez d’abord l’OP-Z avec sa touche stop.' });
    return false;
  };
  /** Position affichée : celle de l'OP-Z quand il joue, sinon celle du lecteur de l'éditeur. */
  const position = useCallback(() => {
    const c = opz.clock.current;
    const cur = project.latest.current;
    if (opz.deviceRunning && c && cur) {
      const tick = c.tickMs();
      const sixteenthMs = tick ? tick * 6 : 60000 / cur.global.tempo / 4;
      return { patternId: assumedPos.current?.pattern ?? patternRef.current, sequenceIndex: 0, elapsedMs: c.sixteenths() * sixteenthMs, sixteenthMs };
    }
    return player.position();
  }, [opz.deviceRunning, opz.clock, project.latest, player]);

  // ---------------------------------------------------------------- application à l'OP-Z

  /**
   * Applique les patterns (et le tempo / les chaînes) du studio à l'OP-Z : transaction pushToOpz
   * (sauvegarde, écriture, relecture exacte, retour arrière). Jamais les sons des touches noires.
   */
  const [applyState, setApplyState] = useState<'idle' | 'applying' | 'error'>('idle');
  const applying = useRef(false);
  const apply = async (quiet: boolean) => {
    const cur = project.latest.current;
    if (!cur || applying.current || switching.current || !connected) return;
    const problems = deviceWriteProblems(cur);
    if (problems.length) return setNotice({ tone: 'error', text: `Application impossible : ${problems.join(' ; ')}` });
    if (cur.meta.device_project === undefined) return setNotice({ tone: 'error', text: 'Rechargez d’abord le projet depuis l’OP-Z (menu Projet) : l’éditeur doit savoir sur quel projet écrire.' });
    const bytes = projectToBytes(cur);
    const raw = projectRawBytes(cur);
    if (!bytes.ok || !raw.ok) return;
    const globalChanged = !globalStableEqual(bytes.value.global, raw.value.global);
    applying.current = true;
    setApplyState('applying');
    const r = await opz.withDevice('Application à l’OP-Z…', (dev) => pushToOpz(dev, { bank: bytes.value.bank, global: globalChanged ? bytes.value.global : null }, {
      label: cur.meta.name, saveCheckpoint, expectedProject: null,
      // Les réglages envoyés en direct créent de petits écarts ; au-delà de 2 %, on demande (autre projet ?).
      baselineBank: raw.value.bank, baselineTolerance: Math.round(raw.value.bank.length * 0.02),
      confirm: (m) => dialog.ask({ title: 'Vérification avant d’écrire', message: <p className="whitespace-pre-line">{m}</p>, confirm: 'Écrire quand même', tone: 'danger' }),
      progress: (text) => { if (!quiet) opz.setBusy(text); opz.log(text); },
    }), quiet);
    applying.current = false;
    refreshCheckpoints();
    if (!r.ok) {
      setApplyState('error');
      return setNotice({ tone: 'error', text: `Application à l’OP-Z impossible : ${r.error.message}` });
    }
    setApplyState('idle');
    if (r.value.status === 'confirmed' || r.value.status === 'unchanged') project.rebase({ bank: bytes.value.bank, global: globalChanged ? bytes.value.global : null });
  };
  // Application automatique, 1,5 s après la dernière modification.
  useEffect(() => {
    if (!autoApply || !unsent || !connected || opz.busy !== null || applyState === 'error' || shownProject === null) return;
    const t = setTimeout(() => void apply(true), 1500);
    return () => clearTimeout(t);
  }, [p, unsent, autoApply, connected, opz.busy, applyState, shownProject]); // eslint-disable-line react-hooks/exhaustive-deps
  // Nouvelle modification après une erreur : on retente.
  useEffect(() => { if (applyState === 'error') setApplyState('idle'); }, [p]); // eslint-disable-line react-hooks/exhaustive-deps

  const restore = async (id: string) => {
    const cp = await loadCheckpoint(id);
    if (!cp.ok) return setNotice({ tone: 'error', text: cp.error.message });
    const when = new Date(cp.value.createdAt).toLocaleString('fr-FR');
    if (!cp.value.bank) return setNotice({ tone: 'error', text: 'Cette sauvegarde ne contient pas de patterns.' });
    if (!(await dialog.ask({ title: `Remettre les patterns de l’OP-Z dans leur état du ${when} ?`, message: <p>L’état actuel est lui-même sauvegardé avant, puis relu après.</p>, confirm: 'Restaurer', tone: 'danger' }))) return;
    const bank = cp.value.bank;
    const r = await opz.withDevice('Restauration…', (dev) => pushToOpz(dev, { bank, global: cp.value.global }, {
      label: `restauration du ${when}`, saveCheckpoint, expectedProject: null, baselineBank: null,
      confirm: (m) => dialog.ask({ title: 'Vérification', message: <p className="whitespace-pre-line">{m}</p>, confirm: 'Continuer', tone: 'danger' }),
      progress: (text) => { opz.setBusy(text); opz.log(text); },
    }));
    refreshCheckpoints();
    setNotice(r.ok ? { tone: 'ok', text: 'Patterns de l’OP-Z restaurés (vérifié par relecture). Rechargez le projet pour les voir.' } : { tone: 'error', text: r.error.message });
  };

  // ---------------------------------------------------------------- OP-Z

  /** Demande le numéro de projet quand l'annonce de l'OP-Z n'est pas (encore) jugée fiable. */
  const identifyProject = async (t: { project: number | null; fresh: boolean }): Promise<number | null> => {
    let trust = 0;
    try { trust = Number(localStorage.getItem('opz-telemetry-trust') ?? 0); } catch { /* */ }
    if (t.fresh && t.project !== null && t.project < 10 && trust >= 3) return t.project;
    const answer = await dialog.choose<number>({
      title: 'Quel projet est allumé sur l’OP-Z ?',
      message: <p>Sur l’OP-Z, maintenez la touche <b>projet</b> : la touche allumée (1 à 10) est le projet actif. L’éditeur s’en sert pour nommer le projet et suivre les patterns.</p>,
      options: Array.from({ length: 10 }, (_, i) => ({ label: String(i + 1), value: i })),
      initial: t.project !== null && t.project < 10 ? t.project : undefined,
    });
    if (answer === null) return null;
    const agrees = t.fresh && answer === t.project;
    try { localStorage.setItem('opz-telemetry-trust', String(agrees ? trust + 1 : 0)); } catch { /* */ }
    if (!agrees) opz.log(`Projet indiqué : ${answer + 1} ; annonce de l’OP-Z : ${t.project === null ? 'aucune' : t.project + 1}${t.fresh ? '' : ' (ancienne)'}.`);
    return answer;
  };

  const importFromOpz = async (knownProject?: number) => {
    player.stop();
    setNotice({ tone: 'info', text: 'Import en cours : patterns, réglages, puis liste des sons…' });
    const r = await opz.importAll();
    if (!r.ok) return setNotice({ tone: 'error', text: `Import impossible : ${r.error.message}` });
    // Numéro de projet : annonce de l'OP-Z si elle est fiable, sinon on le demande (jamais l'adresse $09).
    const devProject = knownProject ?? await identifyProject(r.value.telemetry);
    if (devProject === null) return setNotice({ tone: 'info', text: 'Import annulé.' });
    const imported = await project.importFromDevice(r.value.bytes, r.value.firmware, projectOfAddress(r.value.address), r.value.catalog, {
      device_project: devProject,
      pattern_names: storedPatternNames(devProject),
      name: storedProjectName(devProject) || `Projet ${devProject + 1}`,
      // Tout ce qui a été modifié est déjà dans l'OP-Z : rien ne sera perdu, pas de question.
      skipConfirm: !unsent && project.project?.meta.source === 'opz-import',
    });
    if (!imported) return setNotice({ tone: 'info', text: 'Import annulé.' });
    // Pattern actif de l'OP-Z : connu seulement si on vient de le choisir (l'annonce $07 n'est pas fiable).
    // Inconnu : aucun réglage n'est envoyé en direct tant qu'un pattern n'a pas été choisi ici.
    assume(knownProject !== undefined ? { project: devProject, pattern: 0 } : null);
    setPattern(0);
    setNotice({
      tone: r.value.catalog ? 'ok' : 'info',
      text: 'Projet actif de l’OP-Z importé et vérifié.' + (r.value.catalog ? '' : ' La liste des sons n’a pas pu être lue : réessayez depuis l’onglet du son.'),
    });
  };

  const readCatalog = async () => {
    const r = await opz.readCatalog();
    if (!r.ok) return setNotice({ tone: 'error', text: `Liste des sons non lue : ${r.error.message}` });
    project.update((x) => setDeviceCatalog(x, r.value));
    setNotice({ tone: 'ok', text: 'Liste des sons de l’OP-Z lue.' });
  };

  /**
   * Changer de projet : méthode déjà validée → envoi puis import direct. Sinon (première fois),
   * on essaie les méthodes une à une et l'utilisateur confirme en regardant l'OP-Z.
   */
  const switchProject = async (target: number) => {
    const out = opz.liveOutput;
    if (!out || target === shownProject) return;
    player.stop();
    // Terminer d'abord l'application en attente (sinon elle pourrait partir vers le nouveau projet).
    if (unsent && autoApply) await apply(true);
    switching.current = true;
    try {
      await switchProjectNow(out, target);
    } finally {
      switching.current = false;
    }
  };
  const switching = useRef(false);
  const switchProjectNow = async (out: NonNullable<typeof opz.liveOutput>, target: number) => {
    const known = SWITCH_METHODS.find((m) => m.id === switchMethodId);
    if (known) {
      const steps = known.build(target, 0);
      if (!steps) return;
      sendSwitch(out, steps);
      lastSwitchAt.current = performance.now();
      opz.log(`Projet ${target + 1} demandé (${known.label}) : ${describeSteps(steps)}`);
      await new Promise((r) => setTimeout(r, 800));
      await importFromOpz(target);
      return;
    }
    const order = [switchMethod, ...SWITCH_METHODS.filter((m) => m !== switchMethod)];
    let found: string | null = null;
    for (let i = 0; i < order.length; i++) {
      const m = order[i];
      const steps = m.build(target, 0);
      if (!steps) continue;
      sendSwitch(out, steps);
      lastSwitchAt.current = performance.now();
      opz.log(`Projet ${target + 1} demandé (${m.label}) : ${describeSteps(steps)}`);
      setNotice({ tone: 'info', text: `Passage de l’OP-Z sur le projet ${target + 1}…` });
      await new Promise((r) => setTimeout(r, 1200));
      const last = i === order.length - 1;
      const answer = await dialog.choose<'yes' | 'no' | 'stop'>({
        title: `L’OP-Z est-il passé au projet ${target + 1} ?`,
        message: <>
          <p>Regardez l’OP-Z : maintenez la touche <b>projet</b>, la touche allumée indique le projet actif.</p>
          {i > 0 && <p className="text-xs text-zinc-500">Essai {i + 1} sur {order.length} : {m.label}.</p>}
        </>,
        options: [
          { label: `Oui, il est sur le projet ${target + 1}`, value: 'yes' },
          ...(last ? [] : [{ label: 'Non, essayer une autre façon', value: 'no' as const }]),
          { label: last ? 'Non' : 'Arrêter', value: 'stop' },
        ],
        initial: 'yes',
      });
      if (answer === 'yes') { found = m.id; break; }
      if (answer !== 'no') break;
    }
    if (!found) {
      return setNotice({ tone: 'error', text: `L’OP-Z n’est pas passé au projet ${target + 1}. Vérifiez sur l’OP-Z (maintenir tempo + écran) que les touches 2 (entrée MIDI) et 8 (program change) sont allumées et la touche 1 éteinte, puis réessayez. En attendant : touche projet + touche ${target + 1} sur l’OP-Z, puis « Importer ». Envoyez-moi le journal (menu OP-Z).` });
    }
    if (found !== switchMethodId) {
      setSwitchMethodId(found);
      opz.log(`Méthode retenue pour cet OP-Z : ${SWITCH_METHODS.find((m) => m.id === found)?.label}`);
    }
    await importFromOpz(target);
  };

  const renameProject = (name: string) => {
    if (shownProject === null) return;
    storeProjectName(shownProject, name);
    setProjectNames(allProjectNames());
    if (name.trim()) project.rename(name.trim());
  };

  const renamePattern = (name: string) => {
    if (!project.update((x) => setPatternName(x, pattern, name))) return;
    if (shownProject !== null) {
      const names = [...patternNamesNow];
      names[pattern] = name.trim();
      storePatternNames(shownProject, names);
    }
  };

  // ---------------------------------------------------------------- édition

  // Copier / coller entre patterns (presse-papiers de l'éditeur).
  const [clip, setClip] = useState<{ kind: 'pattern'; from: number; data: ProjectPattern } | { kind: 'track'; from: number; data: ProjectTrack } | null>(null);
  const copyPattern = () => {
    if (!current) return;
    setClip({ kind: 'pattern', from: pattern, data: structuredClone(current) });
    setNotice({ tone: 'ok', text: `Pattern ${pattern + 1} copié. Choisissez un autre pattern puis « Coller » (ou Ctrl+V).` });
  };
  const copyTrack = () => {
    if (!currentTrack) return;
    setClip({ kind: 'track', from: pattern, data: structuredClone(currentTrack) });
    setNotice({ tone: 'ok', text: `Piste ${TRACK_INFO[currentTrack.id].label} du pattern ${pattern + 1} copiée. Choisissez un autre pattern puis « Coller ».` });
  };
  const paste = () => {
    if (!clip) return;
    const ok = project.update((x) => (clip.kind === 'pattern' ? pastePattern(x, pattern, clip.data) : pasteTrack(x, pattern, clip.data)));
    if (ok) setNotice({ tone: 'ok', text: `${clip.kind === 'pattern' ? `Pattern ${clip.from + 1}` : `Piste ${TRACK_INFO[clip.data.id].label} du pattern ${clip.from + 1}`} collé dans le pattern ${pattern + 1}. Ctrl+Z pour annuler.` });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (!(e.ctrlKey || e.metaKey) || (el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) || window.getSelection()?.toString()) return;
      if (e.key === 'c') { e.preventDefault(); copyPattern(); }
      if (e.key === 'v') { e.preventDefault(); paste(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const preview = (t: number, note: number, velocity = 100) => {
    if (project.latest.current) player.preview(project.latest.current, t, note, velocity);
  };

  const toggle = ({ track: t, step: s }: Cell) => {
    const cur = project.latest.current;
    if (!cur) return;
    const had = !!findTrack(cur, pattern, t)?.steps.find((x) => x.index === s)?.notes.length;
    const note = padNote[t] ?? defaultNoteFor(cur, t);
    setTrack(t);
    setStep(s);
    if (project.update((x) => toggleStep(x, pattern, t, s, note)) && !had) preview(t, note);
  };

  const playingPattern = player.playing ? (player.position()?.patternId ?? null) : null;

  return (
    <div className="flex h-screen flex-col">
      <TopBar
        name={p?.meta.name ?? null}
        fileName={project.fileName}
        dirty={project.dirty}
        status={opz.status}
        busy={opz.busy}
        canImport={idle}
        onNew={() => { player.stop(); project.createNew(); }}
        onOpen={() => { player.stop(); void project.open(); }}
        onSave={() => void project.save(false)}
        onRename={project.rename}
        onConnect={() => void opz.connect()}
        onImport={() => void importFromOpz()}
        onDevice={() => setDrawer(true)}
        applyState={!connected || p?.meta.source !== 'opz-import' ? 'none' : applyState === 'applying' ? 'applying' : applyState === 'error' ? 'error' : unsent ? 'pending' : 'done'}
        onApply={() => void apply(false)}
        warnings={connected ? player.warnings : []}
      />

      {!webMidiSupported() && (
        <p className="bg-red-50 px-5 py-2 text-sm text-red-700">Ce navigateur ne permet pas de parler à l’OP-Z. Utilisez Chrome ou Edge.</p>
      )}
      {/* Messages : en surimpression en bas, jamais dans la page (rien ne se décale). */}
      {notice && (
        <div role="status" className={`fixed bottom-5 left-1/2 z-40 flex w-[min(640px,calc(100vw-32px))] -translate-x-1/2 items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${notice.tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : notice.tone === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-zinc-200 bg-white text-zinc-700'}`}>
          <span className="flex-1 whitespace-pre-line">{notice.text}</span>
          <button className="opacity-60 hover:opacity-100" onClick={() => setNotice(null)} aria-label="Fermer">✕</button>
        </div>
      )}

      {p && current ? (
        <>
          <Transport
            patterns={p.patterns}
            selected={pattern}
            playingPattern={playingPattern}
            playing={player.playing}
            deviceRunning={opz.deviceRunning}
            canPlay={player.canPlay}
            mode={player.mode}
            chain={playChain(p)}
            savedChains={p.global.chains.map((c) => c.filter((x) => x < 16))}
            onChain={(c) => project.update((x) => setPlayChain(x, c))}
            tempo={p.global.tempo}
            canUndo={project.canUndo}
            canRedo={project.canRedo}
            onSelect={selectPattern}
            project={shownProject}
            projectNames={projectNames}
            patternNames={patternNamesNow}
            canSwitchProject={liveProblem ?? (!idle ? 'OP-Z occupé' : null)}
            onProject={(n) => void switchProject(n)}
            onRenameProject={renameProject}
            onRenamePattern={renamePattern}
            devicePos={connected && devicePosition ? { chainLength: 1, ...devicePosition } : null}
            follow={pcFollow}
            followBlocked={pcBlocked}
            onFollow={setPcFollow}
            onToggle={player.toggle}
            onMode={player.setMode}
            onTempo={(bpm) => project.update((x) => setTempo(x, bpm))}
            onUndo={project.undo}
            onRedo={project.redo}
          />
          <main className="grid min-h-0 flex-1 gap-5 overflow-hidden bg-zinc-50 p-5 xl:grid-cols-[minmax(0,1fr)_400px]">
            <section className="min-w-0 overflow-auto">
              {/* Le séquenceur : la pièce maîtresse de la page. */}
              <div className="w-fit rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
                <div className="mb-3 flex items-baseline gap-3">
                  <h2 className="text-xl font-semibold">Pattern {pattern + 1}</h2>
                  {patternNamesNow[pattern] && <span className="text-lg text-zinc-500">{patternNamesNow[pattern]}</span>}
                  <div className="ml-auto flex items-center gap-1">
                    <button className="btn btn-ghost px-2 py-1 text-xs" onClick={copyPattern} title="Ctrl+C">Copier le pattern</button>
                    {currentTrack && currentTrack.id < 8 && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={copyTrack}>Copier la piste {TRACK_INFO[currentTrack.id].label}</button>}
                    <button className="btn px-2 py-1 text-xs" disabled={!clip} onClick={paste} title="Ctrl+V">
                      {clip ? (clip.kind === 'pattern' ? `Coller le pattern ${clip.from + 1}` : `Coller ${TRACK_INFO[clip.data.id].label} (pattern ${clip.from + 1})`) : 'Coller'}
                    </button>
                  </div>
                </div>
                <p className="-mt-1 mb-3 text-xs text-zinc-400">Clic : poser / retirer une note · clic droit : détailler le pas · M : couper · S : solo (Maj : plusieurs)</p>
              <Sequencer
                pattern={current}
                trackIds={gridTracks}
                catalog={catalog}
                selectedTrack={track}
                selectedStep={step}
                playing={player.playing || opz.deviceRunning}
                position={position}
                solo={solo}
                onSolo={toggleSolo}
                onToggle={toggle}
                onSelectStep={(c) => { setTrack(c.track); setStep(c.step); setTab('pas'); }}
                onSelectTrack={(t) => setTrack(t)}
                onMute={(t, muted) => project.update((x) => setTrackSettings(x, pattern, t, { muted }))}
              />
              </div>
              <SignalFlow pattern={current} catalog={catalog} live={connected && liveWrite} update={project.update} onOpen={(t) => { setTrack(t); setStep(null); setTab(t < 8 ? 'reglages' : 'son'); }} />
              <details className="mt-4 max-w-[960px] px-1 text-sm" open={advanced} onToggle={(e) => setAdvanced((e.target as HTMLDetailsElement).open)}>
                <summary className="cursor-pointer text-xs font-medium text-zinc-500">Pistes avancées dans la grille (effets, bande, master, perform, module, lumières, motion)</summary>
                <p className="mt-1 text-xs text-zinc-500">
                  Utiles seulement pour programmer des variations pas à pas : un effet qui change sur un pas, un arrêt de bande, une transposition du master, un effet « punch-in » (Perform), la piste MIDI d’un module, des lumières DMX ou des images (Motion).
                  Pour composer, les 8 instruments suffisent.
                </p>
                {!advanced && (['Perform', 'Module', 'Lights', 'Motion'] as const).map((l, i) => (
                  <button key={l} className="btn mr-1 mt-2 text-xs" onClick={() => { setTrack(12 + i); setTab('son'); }}>{l}</button>
                ))}
              </details>
            </section>
            {currentTrack && (
              <TrackPanel
                project={p}
                pattern={pattern}
                patternData={current}
                track={currentTrack}
                padNote={padNote[track] ?? null}
                onPadNote={(n) => setPadNote((m) => ({ ...m, [track]: n }))}
                step={step}
                tab={tab}
                catalog={catalog}
                canReadCatalog={idle}
                onTab={setTab}
                onStep={setStep}
                onReadCatalog={() => void readCatalog()}
                update={project.update}
                preview={preview}
              />
            )}
          </main>
        </>
      ) : (
        <main className="flex flex-1 items-center justify-center p-8">
          <div className="w-full max-w-2xl">
            <h1 className="text-center text-2xl font-semibold">Composer sur l’OP-Z, simplement</h1>
            <p className="mt-2 text-center text-zinc-500">L’OP-Z contient <b>10 projets</b> de <b>16 patterns</b> chacun. L’éditeur travaille sur un projet à la fois.</p>
            <ol className="mt-6 space-y-4">
              <li className={`rounded-2xl border p-5 ${connected ? 'border-zinc-200 bg-zinc-50' : 'border-zinc-900'}`}>
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold text-white">1</span>
                  <span className="font-medium">Brancher l’OP-Z en USB, l’allumer, puis le connecter</span>
                  <span className="ml-auto">
                    {connected
                      ? <span className="text-sm text-emerald-700">● connecté</span>
                      : <button className="btn btn-dark" onClick={() => void opz.connect()} disabled={opz.status === 'connecting'}>{opz.status === 'connecting' ? 'Connexion…' : 'Connecter l’OP-Z'}</button>}
                  </span>
                </div>
              </li>
              <li className={`rounded-2xl border p-5 ${connected ? 'border-zinc-900' : 'border-zinc-200 opacity-60'}`}>
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold text-white">2</span>
                  <span className="font-medium">Choisir le projet à charger</span>
                </div>
                <p className="mt-2 text-sm text-zinc-500">
                  Cliquez un projet : l’OP-Z y passe, puis l’éditeur le charge (notes, sons, réglages).
                  Sur l’OP-Z lui-même : maintenir la touche <b>projet</b> et appuyer sur une touche de <b>1 à 0</b> (ex. projet + 7 = projet 7).
                  Les projets n’ont pas de nom sur l’OP-Z : ceux que vous donnez restent dans l’éditeur.
                </p>
                <div className="mt-4 grid grid-cols-5 gap-2">
                  {Array.from({ length: 10 }, (_, i) => (
                    <button key={i} className="btn h-16 flex-col justify-center" disabled={!idle || liveProblem !== null}
                      onClick={() => void switchProject(i)} title={liveProblem ?? `Charger le projet ${i + 1}`}>
                      <span className="text-lg font-semibold">{i + 1}</span>
                      <span className="w-full truncate text-[11px] text-zinc-500">{projectNames[i] || `Projet ${i + 1}`}</span>
                    </button>
                  ))}
                </div>
                <button className="btn btn-ghost mt-3 text-sm" disabled={!idle} onClick={() => void importFromOpz()}>ou charger le projet déjà ouvert sur l’OP-Z</button>
              </li>
            </ol>
            <div className="mt-6 flex justify-center gap-2 text-sm">
              <button className="btn btn-ghost" onClick={() => void project.open()}>Ouvrir un fichier .opzproject</button>
              <button className="btn btn-ghost" onClick={() => void project.createNew()}>Projet vierge (sans OP-Z)</button>
            </div>
          </div>
        </main>
      )}

      <BusyOverlay text={opz.busy} steps={opz.importSteps} />
      {dialog.host}
      <DeviceDrawer
        open={drawer}
        onClose={() => setDrawer(false)}
        connected={connected}
        identity={opz.identity}
        warnings={connected ? player.warnings : []}
        liveWrite={liveWrite}
        onLiveWrite={setLiveWrite}
        autoApply={autoApply}
        onAutoApply={setAutoApply}
        checkpoints={checkpoints}
        onRestore={(id) => void restore(id)}
        canUse={idle}
        log={opz.logLines}
        frames={[...opz.frames.values()].sort((a, b) => a.id - b.id)}
        onDisconnect={opz.disconnect}
        onReadCatalog={() => void readCatalog()}
        diagnostics={
          <div className="flex flex-wrap gap-2">
            <button className="btn text-xs" onClick={opz.readBank} disabled={!idle}>Lire la banque</button>
            <button className="btn text-xs" onClick={opz.readGlobal} disabled={!idle}>Lire le global</button>
            {opz.bank && <button className="btn text-xs" onClick={() => downloadBytes(opz.bank!.bytes, `opz-bank-${timestamp()}.bin`)}>banque.bin</button>}
            {opz.global && <button className="btn text-xs" onClick={() => downloadBytes(opz.global!.bytes, `opz-global-${timestamp()}.bin`)}>global.bin</button>}
            {p?.device_catalog?.plugs_json && (
              <button className="btn text-xs" onClick={() => downloadBytes(new TextEncoder().encode(p.device_catalog!.plugs_json!), 'plugs.json')}>plugs.json</button>
            )}
            {p?.device_catalog?.slots_json && (
              <button className="btn text-xs" onClick={() => downloadBytes(new TextEncoder().encode(p.device_catalog!.slots_json!), 'slotConfiguration.json')}>slotConfiguration.json</button>
            )}
          </div>
        }
      />
    </div>
  );
}
