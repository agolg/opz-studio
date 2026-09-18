/**
 * Télémétrie `$07` (OP-Z → hôte, lecture seule). op-z-sysex docs/sysex-app-protocol.md :
 *   0..15 chaîne active (quartets), 16 longueur, 17 adresse du pattern (quartet bas = pattern),
 *   18 index de l'entrée suivante, 19 projet.
 * Observée peu fiable pour le projet (18/09/2026) : sert d'alarme, jamais de vérité.
 * (Le changement de pattern / projet par MIDI est dans liveControl.ts.)
 */
export interface DevicePosition { project: number; pattern: number; chainLength: number }

export function decodeChainTelemetry(payload: Uint8Array): DevicePosition | null {
  if (payload.length < 20) return null;
  const chainLength = payload[16];
  const pattern = payload[17] & 0x0f;
  const project = payload[19];
  if (project > 15 || chainLength > 32) return null;
  return { project, pattern, chainLength };
}
