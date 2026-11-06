/**
 * Primitive colour ramps. Raw values only: components must never reference these directly.
 * The semantic layer (`semantic.ts`) maps them to roles. This file has no imports so the
 * Electron main process can read it too (see `electron.ts`).
 *
 * Step numbers increase with darkness. Ramps only contain the steps the system uses.
 */
export const neutral = {
  0: '#FFFFFF',
  25: '#F6F8FB',
  50: '#EEF2F7',
  100: '#E6EDF3',
  150: '#E3E8F0',
  200: '#DCE2EA',
  300: '#A9B4C4',
  325: '#A3B1C6',
  350: '#8B97AB',
  400: '#8A94A6',
  450: '#6F7B90',
  500: '#6E7B94',
  550: '#5C677A',
  590: '#55657D',
  600: '#556274',
  700: '#3E4A5E',
  725: '#1F2735',
  750: '#2A3447',
  800: '#232C3F',
  850: '#1A2233',
  900: '#121826',
  950: '#0F172A',
  975: '#0B0F17',
} as const;

export const blue = {
  50: '#E3EEFF',
  200: '#8CC4FF',
  400: '#5AA9FF',
  600: '#2F6FDB',
  700: '#1F63C7',
  800: '#174EA6',
  900: '#10284A',
} as const;

export const indigo = {
  50: '#E8E9FD',
  200: '#9DB7FF',
  300: '#8B93FF',
  600: '#4F56D6',
  700: '#2B4FD8',
  900: '#1E2150',
} as const;

export const green = {
  50: '#DDF5E8',
  200: '#6EE0A1',
  400: '#3FCB7E',
  600: '#1E9E5A',
  700: '#13784A',
  750: '#11704A',
  800: '#0F6B40',
  900: '#0D3122',
  975: '#06140C',
} as const;

export const amber = {
  50: '#FFF1D1',
  200: '#FFD27A',
  400: '#F5B83D',
  700: '#8A5A00',
  800: '#7A4F00',
  900: '#3A2A06',
  975: '#1A1200',
} as const;

export const red = {
  50: '#FDE3E3',
  200: '#FF9A9A',
  400: '#FF6B6B',
  600: '#D23B3B',
  700: '#C2272D',
  800: '#A61E24',
  900: '#3D1416',
} as const;

export const teal = {
  50: '#DDF5F1',
  400: '#2DD4BF',
  700: '#0B7366',
  900: '#0B2E2B',
} as const;

export const violet = {
  50: '#F1E8FD',
  400: '#B98AF8',
  700: '#7D45C9',
  900: '#2A1A45',
} as const;

export const fuchsia = {
  50: '#FBE6F7',
  400: '#E879D9',
  700: '#A8338F',
  900: '#3A1434',
} as const;
