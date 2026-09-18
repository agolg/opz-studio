import { err, ok, type Result } from '../lib/result';

/**
 * Minimal byte transport. The session only depends on this interface, so it
 * can be driven by Web MIDI in the browser and by a fake OP-Z in tests.
 */
export interface MidiTransport {
  readonly name: string;
  send(data: Uint8Array): void;
  /** Envoi horodaté (DOMHighResTimeStamp, même base que performance.now()). Optionnel. */
  sendAt?(data: Uint8Array, timestampMs: number): void;
  /** Subscribe to complete incoming MIDI messages. Returns an unsubscribe function. */
  subscribe(listener: (data: Uint8Array) => void): () => void;
  close(): void;
}

export class MidiAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MidiAccessError';
  }
}

export function webMidiSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
}

/** Asks the browser for MIDI + SysEx access (Chrome/Edge show a permission prompt). */
export async function requestMidiAccess(): Promise<Result<MIDIAccess, MidiAccessError>> {
  if (!webMidiSupported()) return err(new MidiAccessError('Web MIDI indisponible : utilisez Chrome ou Edge, en HTTPS ou sur localhost.'));
  try {
    return ok(await navigator.requestMIDIAccess({ sysex: true }));
  } catch (e) {
    return err(new MidiAccessError(`Accès MIDI/SysEx refusé : ${e instanceof Error ? e.message : String(e)}`));
  }
}

/** Finds exactly one input and one output whose name contains `match` (opzsysex/device.py find_port). */
export function openOpzTransport(access: MIDIAccess, match = 'OP-Z'): Result<MidiTransport, MidiAccessError> {
  const inputs = [...access.inputs.values()].filter((p) => p.name?.toLowerCase().includes(match.toLowerCase()));
  const outputs = [...access.outputs.values()].filter((p) => p.name?.toLowerCase().includes(match.toLowerCase()));
  if (inputs.length !== 1 || outputs.length !== 1) {
    return err(new MidiAccessError(`OP-Z introuvable : ${inputs.length} entrée(s) et ${outputs.length} sortie(s) correspondent à « ${match} ».`));
  }
  const input = inputs[0];
  const output = outputs[0];
  const listeners = new Set<(data: Uint8Array) => void>();
  const onMessage = (event: MIDIMessageEvent): void => {
    if (!event.data) return;
    const data = new Uint8Array(event.data);
    for (const l of listeners) l(data);
  };
  input.addEventListener('midimessage', onMessage);
  return ok({
    name: output.name ?? 'OP-Z',
    send: (data) => output.send(data),
    sendAt: (data, timestampMs) => output.send(data, timestampMs),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      input.removeEventListener('midimessage', onMessage);
      listeners.clear();
      // Les ports ne sont pas fermés : Chrome les partage dans la page, et une
      // fermeture asynchrone suivie d'une reconnexion rapide peut les laisser muets.
    },
  });
}
