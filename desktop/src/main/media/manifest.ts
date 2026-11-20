/**
 * Bundled media manifest (ADR 0019, plan 5.1). Loaded once at start-up with a strict schema. A bad
 * manifest disables media (logged); it never crashes the app. Entries whose file is missing are
 * dropped, so the resolver can only ever point at files that exist.
 */
import { join } from 'node:path';
import { z } from 'zod';
import type { Logger } from '../log';
import type { MediaEntry, MediaManifest } from './mediaResolver';

export const MEDIA_TYPES = ['video/webm', 'video/mp4', 'text/vtt'] as const;
const FILE_RE = /^[a-z0-9-]+\.(webm|mp4|vtt)$/;
const KEY_RE = /^[a-z0-9][a-z0-9/_.-]{0,120}$/;

export const manifestSchema = z
  .object({
    v: z.literal(1),
    entries: z.record(
      z.string().regex(KEY_RE),
      z.object({ file: z.string().regex(FILE_RE), type: z.enum(MEDIA_TYPES) }).strict(),
    ),
  })
  .strict();

export const EMPTY_MANIFEST: MediaManifest = { entries: new Map() };

export function parseManifest(raw: unknown): MediaManifest | null {
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) return null;
  for (const key of Object.keys(parsed.data.entries)) {
    if (key.split('/').some((s) => s === '..' || s === '.' || s === '')) return null;
  }
  return { entries: new Map(Object.entries(parsed.data.entries)) };
}

export interface ManifestFs {
  readFile(path: string, enc: 'utf8'): Promise<string>;
  exists(path: string): Promise<boolean>;
}

export async function loadManifest(
  root: string,
  fs: ManifestFs,
  log: Logger,
): Promise<MediaManifest> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(join(root, 'manifest.json'), 'utf8'));
  } catch {
    log.warn('media.manifest_unreadable');
    return EMPTY_MANIFEST;
  }
  const parsed = parseManifest(raw);
  if (!parsed) {
    log.warn('media.manifest_invalid');
    return EMPTY_MANIFEST;
  }
  const kept = new Map<string, MediaEntry>();
  for (const [key, entry] of parsed.entries) {
    if (await fs.exists(join(root, entry.file))) kept.set(key, entry);
    else log.warn('media.file_missing', { file: entry.file });
  }
  return { entries: kept };
}

/** Files the protocol may serve, with their MIME types (exact match against manifest values). */
export function servableFiles(manifest: MediaManifest): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const e of manifest.entries.values()) out.set(e.file, e.type);
  return out;
}
