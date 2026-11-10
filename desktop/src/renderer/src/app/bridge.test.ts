import { describe, expect, it } from 'vitest';
import type { CSenseBridgeV1 } from '../../../shared/ipcChannels';
import { getBridge } from './bridge';
import { createFakeBridge } from './testing/fakeBridge';

describe('getBridge', () => {
  it('returns the bridge only when it speaks version 1', () => {
    const { bridge } = createFakeBridge();
    expect(getBridge({ csense: bridge })).toBe(bridge);
    expect(
      getBridge({ csense: { ...bridge, bridgeVersion: 2 } as unknown as CSenseBridgeV1 }),
    ).toBeNull();
    expect(getBridge({})).toBeNull();
  });
});
