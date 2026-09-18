# Fonctionnement de l'OP-Z — et ce que fait l'éditeur

> Décision du 18/09 : **patterns oui, sons non**. Le studio applique vos modifications aux patterns de l'OP-Z (réglages en direct, puis patterns écrits automatiquement avec sauvegarde et relecture) ; il ne modifie jamais les sons des touches noires.

Source : guide officiel Teenage Engineering (teenage.engineering/guides/op-z). État au 18/09/2026.
✅ fait · 🟡 partiel · ⬜ à faire · ⛔ volontairement exclu

| Principe OP-Z | Détail | Éditeur |
|---|---|---|
| Projets | 10 projets × 16 patterns | ✅ choix du projet (MIDI officiel, puis chargement) ; noms donnés dans l'éditeur |
| Patterns | 16 par projet ; chaque piste a son nombre de pas (1–16) et sa vitesse | ✅ grille, pas, vitesse, par piste et par pattern |
| Sons d'un pattern | Chaque pattern mémorise le son (plug) et les paramètres de chaque piste | ✅ onglets Son / Réglages, envoi vérifié |
| Changer de pattern sur l'appareil | MIDI officiel (CC 103 ou Program Change, réglage touche 8) | ✅ « L'OP-Z suit le pattern choisi » (activé par défaut) ; pastille verte = pattern actif sur l'OP-Z. `$07` interdit (plantage) |
| Noms | l'OP-Z n'a pas de noms de projets ni de patterns | ✅ noms propres à l'éditeur |
| Chaînes | jusqu'à 32 patterns enchaînés | 🟡 chaîne composée dans l'éditeur pour l'écoute (reprise possible d'une chaîne de l'OP-Z) ; écriture des chaînes dans l'OP-Z à faire |
| Plugs (sons) | 10 par piste, touche piste + touches noires | ✅ liste, choix, installation vérifiée dans un emplacement |
| Presets | 14 max par plug, touche piste + touches blanches, rangés dans l'OP-Z | ⬜ non lus (pas dans le pattern) |
| Batterie (kick, snare, perc) | kit de 24 sons, un par touche ; 2 sons simultanés | ✅ 24 pads ; ⚠ correspondance note ↔ pad (53–76) à confirmer sur l'appareil |
| Sample | 1 sample joué sur le clavier | 🟡 |
| Polyphonie | basse 1 note, lead 3, accord 4, arp arpège | ✅ limitée dans l'onglet Pas |
| Pages de paramètres | P1 son (hauteur/inversion/filtre/résonance pour la batterie), P2 enveloppe ADSR, P3 LFO (arp : vitesse, motif, style, étendue), P4 FX1/FX2/pan/niveau | ✅ adaptées au type de piste |
| Effets FX1 / FX2 | pistes d'effet qui reçoivent les envois des instruments ; 2 pages : param 1, param 2, filtre, résonance, puis LFO | ✅ résumés sous la grille (« Effets et sortie »), pas comme des instruments |
| Bande (tape) | vitesse grossière / fine, filtre, résonance | ✅ |
| Master | chorus, drive, filtre HP/LP ; styles Latch / Libre | ✅ |
| Lumières, module, perform | couleurs, vitesse, intensité… | 🟡 réglages bruts |
| Step components | 1–0 par pas (pulse, ratchet, pitch, bend, tonalité, jump…) | ✅ onglet Pas |
| Mixeur | volume et envois FX par piste ; niveaux batterie / synthé / punch / master | 🟡 volume et envois FX par instrument (Mixage et effets) ; niveaux de groupe à faire |
| Mute groups | 10 par projet, mémorisés par pattern ; coupent le son, pas le séquenceur | ✅ bouton M par piste |
| Tempo / swing | 40–200 BPM ; swing 50 % = aucun | ✅ tempo ; swing ⬜ |
| Métronome | 6 sons | ⛔ |
| Réglages MIDI | tempo + écran, touches 1–8 : canal 1 → piste active, entrée, sortie, clock in/out, alt program change, écho, program change | 🟡 lus et signalés, pas modifiés |
| Lecture depuis l'éditeur | notes MIDI vers l'OP-Z, avec les sons du pattern actif de l'appareil | ✅ notes uniquement (jamais start/stop ni clock) |
| Sampling / samples perso | enregistrement, packs .aif | ⬜ |

## À savoir pour que ça sonne juste

1. **Canal 1 → piste active** (touche 1 des réglages MIDI) : s'il est allumé, les notes du Kick (canal 1) sont jouées par la piste sélectionnée sur l'OP-Z. Résultat : couper le snare semble couper le kick. L'éteindre : maintenir tempo + écran, appuyer sur 1.
2. **Les changements s'appliquent tout seuls** : réglages immédiatement, le reste 1,5 s après la dernière modification (bouton en haut : « ✓ OP-Z à jour »).
3. **Le son joué est celui du pattern actif de l'OP-Z.** Avec « L'OP-Z suit le pattern choisi », le studio l'y amène.
   - Mode standard : programme = projet × 16 + pattern, sur le canal 1 (au-delà de 128 : canal 2).
   - Mode alt (touche 6) : canal = projet, programme = pattern.
   - Cette lecture du guide reste à confirmer sur l'appareil.

## Contrôle en direct (MIDI officiel)

- Pattern : CC 103, canal = projet (1–10), valeur = pattern (0–15).
- Paramètres : CC 1–18 sur le canal de la piste (P1, P2, filtre, résonance, A, D, S, R, LFO profondeur / vitesse / cible / forme, envoi FX 1, envoi FX 2, pan, volume, portamento, style de note).
- Muet : CC 53 sur le canal de la piste.
- Ces messages agissent sur le pattern actif de l'OP-Z : l'éditeur ne les envoie que s'il est sur le projet et le pattern affichés. Le changement de son (kit, moteur, effet) passe par l'application automatique des patterns.

## Accords et arpèges

- Piste Chord : toutes les notes posées sur un même pas sonnent ensemble (4 max). Onglet Pas : fondamentale + type d'accord.
- Piste Arp : les notes d'un même pas (8 max) sont jouées l'une après l'autre ; vitesse, motif, style, étendue dans Réglages → Arpège (vitesse 0 = pas d'arpège).
- Lead : jusqu'à 3 notes par pas ; Bass : 1.
