# CLAUDE.md — OP-Z Web Editor (OP-Z Studio)

Lu par Claude Code au démarrage de chaque session. Les règles de sécurité matérielle priment sur tout le reste.

## Règle n° 1 (décision du propriétaire, 18/09/2026 : « patterns oui, sons non »)

**Le studio applique aux PATTERNS de l'OP-Z ce que l'utilisateur fait (notes, kit/moteur choisi parmi les 10 de la piste, réglages, muets, tempo, chaînes). Il ne modifie JAMAIS les sons chargés sur les touches noires (slotConfiguration, sample packs, moteurs).** But : on branche l'OP-Z en USB et tout se fait dans le studio.

### Écriture des patterns — UNIQUEMENT `src/device/pushToOpz.ts`
1. relire la banque (checkpoint IndexedDB, `storage/checkpoints.ts` ; échec ⇒ rien n'est écrit) ;
2. garde-fou : l'OP-Z relu doit rester proche des octets de référence (tolérance 2 % pour les écarts dus aux CC), sinon on demande (autre projet ?) — `projectOfAddress` n'est PAS fiable, `expectedProject: null` ;
3. écrire (`$09/$0A`, chaque paquet attend son `$0B` ; `$0C` si tempo/chaînes) ;
4. relire (`verifyBank`, 2 relectures) : identique, ou écart ≤ 32 octets uniquement « volatils » (réglages de son, âge des notes, octets internes — `project/bankDiff.ts`), toléré et journalisé ;
5. sinon retour arrière vers le checkpoint, vérifié de la même façon.
- Déclenchement : application automatique 1,5 s après la dernière modification (« Appliquer automatiquement », défaut oui) ou bouton « Appliquer à l'OP-Z ». Mode discret (pas de voile). Pas de CC en direct pendant une application.
- Seuls les projets importés depuis l'OP-Z et dont le projet est connu (`meta.device_project`) sont appliqués (`deviceWriteProblems`).
- Le tampon de chaîne active (global 480..511) reste celui de l'appareil et est exclu des comparaisons.
- `slotInstall.ts` (emplacements de sons) reste testé mais n'est PAS appelé par l'interface.

### Contrôle en direct — UNIQUEMENT messages MIDI officiels (guide TE) via `src/sequencer/liveControl.ts`
- Sortie restreinte : CC 1–18 (paramètres), CC 53 (muet), CC 103 / Bank Select + Program Change (pattern/projet). Jamais de SysEx par ce chemin.
- Pattern / projet : `SWITCH_METHODS` ; la première fois, l'utilisateur confirme en regardant l'OP-Z quelle méthode marche ; elle est retenue (`opz-switch-method`) puis utilisée sans question. Changement de projet = envoi puis réimport.
- Réglages / muets / solo : CC (« Réglages en direct », défaut oui) seulement si le pattern actif de l'OP-Z est connu = dernier pattern choisi depuis le studio.
- Lecture : notes uniquement (`noteOutput.ts`), jamais de start/stop ni de clock. Si l'OP-Z joue lui-même (horloge reçue, `clockFollower.ts`), le studio n'envoie plus de notes et suit son horloge.

### Interdits et faits établis
- **INCIDENT 18/09/2026 : `$07` envoyé depuis l'éditeur a fait planter l'OP-Z réel** (monté comme disque, son coupé). `$07` en écriture est INTERDIT. Toujours interdits : `$07`, `$0E`, `$10`, `$03`, `$04`, `$06`, `$13`, `$14`, `$19`, `$62`, `$66`, file server en écriture.
- Télémétrie `$07` reçue : octet 17 quartet bas = pattern, octet 19 = projet ; observée peu fiable → journalisée, sert d'alarme (changement fait sur l'appareil ⇒ réglages en direct suspendus), jamais de vérité. À l'import, le numéro de projet est demandé à l'utilisateur tant que l'annonce ne lui a pas donné raison 3 fois (`identifyProject`).

### Interface (décisions du propriétaire)
- Le séquenceur est la pièce maîtresse (carte blanche en tête) ; la grille montre les 8 instruments ; « Mixage et effets » (`SignalFlow`) dessous ; pistes de contrôle derrière « Pistes avancées ».
- Aucun message ne décale la page (notifications en surimpression, état dans le bouton d'application, alertes OP-Z dans un bouton). Pas de `window.confirm`/`alert` : `components/Dialog.tsx`.
- Onglet Son : piste → 10 sons des touches noires → le pattern en joue 1 → (kit) 24 sons → chaque pas en joue 1. Les autres sons de l'OP-Z sont listés pour information.
- Noms de projets/patterns : propres au studio (`storage/names.ts` + `meta.pattern_names`).
- Pas de composant React défini dans un rendu (les curseurs perdraient le glisser).
- Projets immuables : `projectToBytes` / la référence brute sont mis en cache par objet (WeakMap) — ne jamais muter un `OpzProject`, toujours passer par `edit.ts`.

## Règles de sécurité (lecture et écriture)

Source : `kmorrill/op-z-sysex` `docs/coverage.md` (« Safety invariants »).

1. Ne jamais chevaucher deux échanges SysEx : tout passe par `OpzSession.exclusive()`.
2. Préserver tous les octets opaques : ils vivent dans `raw` du `.opzproject` et sont recopiés tels quels (voir `opaquePatternOffsets()`, octets 518–560 et 565–567 du global, padding MIDI 289–291).
3. Trame malformée, séquence inattendue, taille inconnue : échouer proprement et journaliser l'anomalie.
4. Tout import est vérifié : le projet doit reconstruire exactement les octets lus.

## Faits protocolaires à ne pas réinventer (corrigent le brief initial)

- **Banque** : `$09` transporte les **16 patterns** du projet actif = 16 × 21 392 = **342 272 octets**. Il n'y a pas « 16 banques × 8 patterns ». Pour changer de projet : `liveControl.ts` (MIDI officiel), jamais `$07`.
- **Écriture partielle** : l'upload `$09/$0A` remplace un **préfixe contigu** (patterns 1..N). Le nibble bas de l'adresse ne choisit PAS le pattern. Éditer le pattern N = renvoyer 1..N.
- **Step components** : déjà cartographiés et prouvés sur l'appareil (`src/project/step-components-map.json`). Pas de campagne de reverse engineering à refaire ; seul Spark raw `10` (reset) reste flou.
- **Notes par step** : kick/snare/perc/sample 2, bass/lead/chord 4, **arp 8**, fx1/fx2/tape 1, master 4, perform/module 6, lights/motion 4.
- **Durée** : 6 200 unités par step (int32). **Micro-timing** : octet signé = ticks × 8, ticks −12…+11.
- **Tempo** : uint16 LE à l'offset 516 du bloc global (pas un octet). Swing à 561.
- **Chaînes** : 15 chaînes sauvées + 1 buffer actif, 31 entrées max, terminées par `FF`.
- **Global `$0C`** : pas de requête dédiée ; un snapshot frais s'obtient en ouvrant une nouvelle session (nouveau client id).
- **`$02`** est de la télémétrie OP-Z → hôte uniquement ; les écritures hôte passent par `$09/$0A`, `$0C`, `$0E`, `$10`, `$07`.
- **zlib** : la sortie deflate n'est pas canonique. pako et le zlib 1.3 de CPython produisent des octets compressés différents mais équivalents. Les tests comparent donc le **contenu décompressé** et la structure des trames, jamais les octets compressés.

## Architecture

- `src/lib/` : `Result<T, E>`, helpers d'octets. Aucune dépendance.
- `src/midi/` : framing, packing 7 bits, zlib, parseur de flux, machines d'état de transfert, `OpzSession`, transport Web MIDI. **Pas de logique métier.**
- `src/project/` : layout mémoire, éditeurs typés (banque, global, config MIDI), vue typée sans perte (`decodeBank` / `encodeBank`), mapping des step components.
- `src/device/` : pont React ↔ session (`useOpzDevice`). **Seul endroit** où l'UI touche au MIDI.
- `src/project/opzProject.ts` : format `.opzproject` (champs lisibles + `raw` de référence), validation stricte.
- `src/storage/` : lecture/écriture du fichier sur disque (File System Access API, repli téléchargement).
- `src/state/` : état du projet ouvert (`useProject`, historique annuler/rétablir).
- `src/project/edit.ts` : modifications immuables et validées du projet (toute édition UI passe par là).
- `src/sequencer/` : `compile.ts` (pattern → notes datées, fonction pure), `player.ts` (planification lookahead, `refresh` pour les modifications en cours de lecture), `noteOutput.ts` (Note On/Off seulement), `liveControl.ts` (CC / PC autorisés, méthodes de changement de pattern), `clockFollower.ts` (horloge de l'OP-Z), `telemetry.ts` (décodage de la télémétrie `$07`).
- `src/device/usePlayer.ts` : pont React ↔ lecteur.
- `src/components/` : interface (fond blanc, simple) — `TopBar`, `Transport` (projet, patterns, lecture, chaîne), `Sequencer` (canvas), `SignalFlow` (mixage et effets), `track/TrackPanel` avec onglets Son / Réglages / Pas / Piste adaptés au type de piste (`project/trackTypes.ts`), `DeviceDrawer` (options, sauvegardes, journal), `Dialog`, `BusyOverlay`. Jamais d'appel MIDI direct.
- `src/project/bankDiff.ts` : description des octets de la banque (écarts de relecture).
- `src/midi/fileServer.ts` + `OpzSession.readDeviceFiles` : lecture de `settings/plugs.json` et `settings/slotConfiguration.json` (catalogue des sons, `project/catalog.ts`, stocké dans `.opzproject` → `device_catalog`). Format de plugs.json non documenté : lecture tolérante.
- Principe d'interface : l'éditeur existe pour rendre l'OP-Z compréhensible d'un coup d'œil. Séquenceur visible par défaut, tout le reste par piste et par onglet, vocabulaire simple en français.
- `docs/fonctionnement-opz.md` : principes de l'OP-Z (guide TE) et état de l'éditeur pour chacun. À tenir à jour.
- `tests/` : Vitest. `tests/fixtures/*.json` sont générés, jamais édités à la main.
- `tools/` : scripts Python (génération de fixtures, `diff_bytes.py`). `tools/maj/` : archives de mise à jour déposées dans C:\son\opz-studio-2 (dossier de travail de l'utilisateur, pas un dépôt git).

## Règles de code

- TypeScript strict, pas de `any`.
- Les fonctions qui touchent au MIDI ou au fichier projet retournent `Result<T, Error>`, jamais d'exception silencieuse.
- Chaque constante de protocole (offset, id de message) est nommée et commentée avec sa source (ex. `// op-z-sysex docs/typed-pattern-editing.md "Pattern Layout"`).
- Les octets opaques ne sont jamais modifiés par le code éditeur — uniquement recopiés depuis la baseline.
- Toute fonction de sérialisation a ses tests avant implémentation ; tout port d'une fonction `op-z-sysex` a un test de parité avec une fixture Python.
- Licences : `op-z-sysex` est MIT (port autorisé, notice dans `THIRD_PARTY_NOTICES.md`). `libopz` est sous **Prosperity Public License** (non commercial) : s'en servir comme documentation de faits, **ne jamais copier son code**.

## Tests obligatoires avant merge

- `npm test` : 0 échec. `npm run typecheck` : 0 erreur.
- Parité Python : `npm run fixtures` (avec un clone de `op-z-sysex` dans `../op-z-sysex`) puis `npm test`.
- Round-trip : `encodeBank(decodeBank(b), b) === b` et couverture de la vue typée (seuls les offsets opaques documentés échappent au modèle).
- Session : simulateur `tests/fakeOpz.ts` (handshake, ACK par paquet, rejet `$08 FF FF FF FF`, paquet sauté, trame malformée, silence).
- Fichier projet : octets → projet → octets identiques ; enregistrer → rouvrir identique ; chaque modification lisible touche exactement les octets des éditeurs de référence ; fichiers invalides refusés.

## Sources de référence

- kmorrill/op-z-sysex (MIT) : protocole SysEx, écriture de patterns, global, config MIDI, file server. Référence principale.
- patriciogonzalezvivo/libopz : noms des champs (paramètres de piste, sons). Documentation seulement.
- MarkRdgOx/opzdoc : inventaire des messages.
- lrk/z-po-project : structure filesystem, format des packs samples.
- teenage.engineering/guides/op-z/step-components : sens musical des valeurs 1–0 des step components.
