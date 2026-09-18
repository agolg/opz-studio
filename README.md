# OP-Z Studio

**Éditeur web pour le Teenage Engineering OP-Z** : on branche l'OP-Z en USB, on compose dans le navigateur.
*A web editor for the Teenage Engineering OP-Z — English summary below.*

**Utiliser l'application : https://agolg.github.io/opz-studio/** (Chrome ou Edge, ordinateur)

> Projet **non officiel**, sans lien avec teenage engineering. « OP-Z » est une marque de teenage engineering.

## Ce que fait OP-Z Studio

- **Lit** le projet ouvert sur l'OP-Z : 16 patterns, notes, sons choisis, réglages, tempo, chaînes, liste des sons.
- **Change de projet et de pattern** depuis l'ordinateur (messages MIDI officiels).
- **Séquenceur** : poser des notes, accords et arpèges, step components, réglages verrouillés par pas, copier/coller entre patterns.
- **Sons** : choisir pour chaque piste et chaque pattern l'un des 10 sons prêts (touches noires) ; les 24 sons d'un kit ; réglages (filtre, enveloppe, LFO, envois FX, volume…) ; mixage et effets (FX 1, FX 2, Tape, Master).
- **Applique vos modifications aux patterns de l'OP-Z** : réglages en direct, le reste automatiquement, avec **sauvegarde avant et relecture après** (retour arrière en cas d'écart).
- **Ne modifie jamais les sons** chargés sur l'OP-Z (kits, moteurs, samples).
- **Enregistre** votre travail dans des fichiers `.opzproject` sur votre ordinateur.

## Avertissement

OP-Z Studio écrit dans la mémoire des patterns de votre OP-Z. Chaque écriture est précédée d'une sauvegarde et suivie d'une vérification, mais **le logiciel est fourni tel quel, sans garantie** (licence MIT). Sauvegardez votre OP-Z (mode disque, ou app OP-Z) avant de commencer.

## Prérequis

- **Chrome ou Edge** sur ordinateur (Web MIDI avec SysEx). Firefox et Safari ne sont pas pris en charge.
- OP-Z à jour, branché en USB. Au premier lancement, autoriser l'accès MIDI demandé par le navigateur.
- Réglages MIDI de l'OP-Z (maintenir **tempo + écran**) : touche 2 (entrée MIDI) et 8 (program change) allumées, touche 1 (« canal 1 → piste active ») éteinte.

## Développement

```bash
npm install
npm run dev        # http://localhost:5173 dans Chrome ou Edge
npm test           # tests (parité avec op-z-sysex, aller-retour sans perte, OP-Z simulé)
npm run typecheck
npm run build      # site statique dans dist/
```

Architecture et **règles de sécurité matérielle** : [`CLAUDE.md`](CLAUDE.md). Fonctionnement de l'OP-Z et couverture : [`docs/fonctionnement-opz.md`](docs/fonctionnement-opz.md). Pour contribuer : [`CONTRIBUTING.md`](CONTRIBUTING.md).

Chaque envoi sur `main` est vérifié (types + tests) puis publié automatiquement sur GitHub Pages.

## Crédits

- [kmorrill/op-z-sysex](https://github.com/kmorrill/op-z-sysex) (MIT) : protocole SysEx de l'OP-Z — voir [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
- [patriciogonzalezvivo/libopz](https://github.com/patriciogonzalezvivo/libopz) : noms de champs (documentation uniquement, aucun code repris).
- [lrk/z-po-project](https://github.com/lrk/z-po-project), [MarkRdgOx/opzdoc](https://github.com/MarkRdgOx/opzdoc), guides officiels teenage engineering.

---

## English summary

OP-Z Studio is an **unofficial** browser-based editor for the teenage engineering OP-Z. Plug the OP-Z in over USB, open the app in Chrome or Edge, and edit patterns, notes, chords, arpeggios, step components, sound selection (among the 10 sounds loaded on each track), parameters, mixing and effects. Changes are applied to the OP-Z's **patterns** (live via official MIDI CCs, the rest automatically with backup + byte-exact read-back and rollback). **Loaded sounds (kits, engines, samples) are never modified.** Work is saved as `.opzproject` files. Use at your own risk; back up your OP-Z first. MIT licensed. The UI is in French for now — translations welcome.
