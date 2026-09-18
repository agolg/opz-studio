# Contribuer à OP-Z Studio

Merci ! Toute amélioration est bienvenue : corrections, interface, traductions, documentation, compréhension du protocole de l'OP-Z.
*Contributions welcome — English is fine too.*

## Comment

1. Ouvrez une **issue** pour signaler un bug ou proposer une idée (joignez le journal : menu OP-Z → Journal).
2. Pour du code : *fork* du dépôt, une branche, puis une **pull request** vers `main`.
3. Avant d'envoyer : `npm run typecheck` et `npm test` doivent passer (la CI le vérifie).

## Règles à respecter absolument (sécurité de l'OP-Z)

Lisez [`CLAUDE.md`](CLAUDE.md). En résumé :

- **Ne jamais modifier les sons** chargés sur l'OP-Z (slotConfiguration, sample packs, moteurs).
- **Toute écriture de patterns passe par `src/device/pushToOpz.ts`** (sauvegarde → écriture → relecture → retour arrière). Aucun autre chemin d'écriture.
- **`$07` en écriture est interdit** : il a fait planter un OP-Z réel. Liste complète des messages interdits dans `CLAUDE.md`.
- Contrôle en direct uniquement par les messages MIDI officiels de `src/sequencer/liveControl.ts`.
- Les octets non documentés sont recopiés tels quels, jamais modifiés.
- Toute nouvelle sérialisation arrive avec ses tests ; les tests comparent le contenu décompressé, jamais les octets zlib.
- TypeScript strict, pas de `any`, erreurs renvoyées en `Result`.
- Ne publiez jamais de fichiers personnels (`.opzproject`, `plugs.json`, dumps) : ils sont exclus par `.gitignore`.

## Licences

Le projet est sous licence MIT. `op-z-sysex` (MIT) peut être porté avec mention ; le code de `libopz` (licence Prosperity, non commerciale) **ne doit pas être copié** — il sert seulement de documentation.
