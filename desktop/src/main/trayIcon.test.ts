import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PACKAGED_FUSES } from '../../build/fuses.config';
import { makeTrayPng } from './trayIcon';

describe('tray icon', () => {
  it('is a valid RGBA PNG of the requested size with a visible disc', () => {
    const png = makeTrayPng(32);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(32);
    expect(png.readUInt32BE(20)).toBe(32);
    expect(png[24]).toBe(8);
    expect(png[25]).toBe(6);
    // Find IDAT and check the pixel data decodes to the right amount.
    const idatAt = png.indexOf(Buffer.from('IDAT'));
    const len = png.readUInt32BE(idatAt - 4);
    const raw = inflateSync(png.subarray(idatAt + 4, idatAt + 4 + len));
    expect(raw.length).toBe(32 * (1 + 32 * 4));
    const centre = 16 * (1 + 128) + 1 + 16 * 4;
    expect(raw[centre + 3]).toBe(255); // opaque at the centre
    expect(raw[1 + 3]).toBe(0); // transparent corner
  });
});

describe('fuses config (applied by the Phase 10 packaging step)', () => {
  it('disables the escape hatches and enforces ASAR integrity', () => {
    expect(PACKAGED_FUSES).toEqual({
      RunAsNode: false,
      EnableNodeOptionsEnvironmentVariable: false,
      EnableNodeCliInspectArguments: false,
      OnlyLoadAppFromAsar: true,
      EnableEmbeddedAsarIntegrityValidation: true,
      EnableCookieEncryption: true,
      GrantFileProtocolExtraPrivileges: false,
    });
  });
});
