/**
 * Result type used by every function that touches MIDI or the project file.
 * CLAUDE.md: no silent exceptions in those layers — failures are values.
 */
export type Result<T, E = Error> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E = Error>(error: E): Result<never, E> => ({ ok: false, error });

/** Protocol-level failure: malformed frame, unexpected size, out-of-range value… */
export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

export const protocolError = (message: string): Result<never, ProtocolError> => err(new ProtocolError(message));

/** Unwrap for tests and for places where a failure is a programming error. */
export function unwrap<T, E extends Error>(result: Result<T, E>): T {
  if (!result.ok) throw result.error;
  return result.value;
}
