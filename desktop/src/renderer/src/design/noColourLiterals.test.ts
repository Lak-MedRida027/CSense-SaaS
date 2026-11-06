/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Gate check: components, screens and layouts take every colour from tokens. ESLint covers
 * TS/TSX; this covers the CSS modules. (Runs in Node under Vitest; Vite stubs CSS imports, so
 * the files are read from disk.)
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['components', 'screens', 'layouts'];
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|hsl)a?\(|\b(?:white|black)\b(?!-)/;

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return cssFiles(full);
    return name.endsWith('.css') ? [full] : [];
  });
}

describe('no hardcoded colours in UI stylesheets', () => {
  const files = DIRS.flatMap((d) => cssFiles(join(ROOT, d)));

  it('finds the stylesheets', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it.each(files.map((f) => [relative(ROOT, f), f] as const))(
    '%s uses tokens only',
    (_name, file) => {
      const offending = readFileSync(file, 'utf8')
        .split('\n')
        .map((line, i) => ({ line: line.replace(/\/\*.*?\*\//g, ''), no: i + 1 }))
        .filter(({ line }) => COLOUR_LITERAL.test(line));
      expect(offending.map((o) => `${o.no}: ${o.line.trim()}`)).toEqual([]);
    },
  );
});
