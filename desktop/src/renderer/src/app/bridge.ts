import type { CSenseBridgeV1 } from '../../../shared/ipcChannels';

/** The bridge version this renderer build speaks. */
export const SUPPORTED_BRIDGE_VERSION = 1;

/**
 * Typed accessor for `window.csense`. Returns null outside the desktop shell (a plain browser, the
 * styleguide in a test runner) or when the preload speaks a different version, so the UI can show a
 * clear "unsupported" state instead of failing on a missing method.
 */
export function getBridge(
  source: { csense?: CSenseBridgeV1 | undefined } = window,
): CSenseBridgeV1 | null {
  const b = source.csense;
  return b?.bridgeVersion === SUPPORTED_BRIDGE_VERSION ? b : null;
}
