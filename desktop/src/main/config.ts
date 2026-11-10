/**
 * Desktop configuration and the API URL policy (plan 4.2, ADR 0013 items 7-8).
 *
 * Pure: `loadDesktopConfig(source, { isPackaged })` never reads `process.env` itself. Development
 * relaxations (http to loopback, `CSENSE_*` runtime overrides, devtools) are keyed on
 * `isPackaged === false` only. A packaged build ignores every `CSENSE_*` variable.
 */

export interface ConfigSource {
  /** Build-time `MAIN_VITE_*` values (import.meta.env). */
  build: Readonly<Record<string, string | undefined>>;
  /** Runtime environment (process.env). Only honoured when unpackaged. */
  env: Readonly<Record<string, string | undefined>>;
}

export type GateOfflinePolicy = 'open_after_grace' | 'closed';

export interface DesktopConfig {
  /** Validated base URL without a trailing slash, or null when the configuration was refused. */
  apiBaseUrl: string | null;
  /** Why the configuration was refused (never shown verbatim to the user). */
  configError: string | null;
  userDataDir: string | null;
  gateOfflinePolicy: GateOfflinePolicy;
  gateOfflineGraceSeconds: number;
  gateRestrictedPollSeconds: number;
  lockdownMaxFocusLosses: number;
  lockdownFocusAwaySeconds: number;
  autoStart: boolean;
  reminders: { firstDelayMinutes: number; intervalMinutes: number; maxPerDay: number };
  devToolsInDev: boolean;
  externalLinkHosts: readonly string[];
}

export const API_PATH_SUFFIX = '/api/v1';
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

export type UrlCheck = { ok: true; url: string } | { ok: false; reason: string };

export function validateApiBaseUrl(raw: string | undefined, isPackaged: boolean): UrlCheck {
  if (raw === undefined || raw.trim() === '') return { ok: false, reason: 'API base URL not set' };
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'API base URL is not a valid URL' };
  }
  if (u.username !== '' || u.password !== '') {
    return { ok: false, reason: 'API base URL must not contain credentials' };
  }
  if (u.search !== '' || u.hash !== '') {
    return { ok: false, reason: 'API base URL must not contain a query or fragment' };
  }
  const path = u.pathname.replace(/\/+$/, '');
  if (!path.endsWith(API_PATH_SUFFIX)) {
    return { ok: false, reason: `API base URL path must end with ${API_PATH_SUFFIX}` };
  }
  if (u.protocol === 'https:') {
    return { ok: true, url: `${u.origin}${path}` };
  }
  if (u.protocol === 'http:' && !isPackaged && LOOPBACK_HOSTS.has(u.hostname)) {
    return { ok: true, url: `${u.origin}${path}` };
  }
  return {
    ok: false,
    reason: isPackaged
      ? 'API base URL must use https in packaged builds'
      : 'API base URL must use https (http is only allowed to localhost in development)',
  };
}

function intInRange(raw: string | undefined, min: number, max: number, fallback: number): number {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return fallback;
  const n = Number(raw.trim());
  return n >= min && n <= max ? n : fallback;
}

function bool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return fallback;
}

export function loadDesktopConfig(
  source: ConfigSource,
  opts: { isPackaged: boolean },
): DesktopConfig {
  const { build } = source;
  // Runtime overrides exist only for unpackaged builds (e2e). Packaged builds see an empty env.
  const env: Readonly<Record<string, string | undefined>> = opts.isPackaged ? {} : source.env;

  const rawUrl = env.CSENSE_API_BASE_URL ?? build.MAIN_VITE_API_BASE_URL;
  const url = validateApiBaseUrl(rawUrl, opts.isPackaged);

  const policyRaw = build.MAIN_VITE_GATE_OFFLINE_POLICY?.trim();
  const policy: GateOfflinePolicy = policyRaw === 'closed' ? 'closed' : 'open_after_grace';

  const userDataDir = env.CSENSE_USER_DATA_DIR?.trim();

  return {
    apiBaseUrl: url.ok ? url.url : null,
    configError: url.ok ? null : url.reason,
    userDataDir: userDataDir ? userDataDir : null,
    gateOfflinePolicy: policy,
    gateOfflineGraceSeconds: intInRange(build.MAIN_VITE_GATE_OFFLINE_GRACE_SECONDS, 30, 900, 120),
    gateRestrictedPollSeconds: intInRange(env.CSENSE_GATE_POLL_SECONDS, 2, 600, 60),
    lockdownMaxFocusLosses: intInRange(build.MAIN_VITE_LOCKDOWN_MAX_FOCUS_LOSSES, 1, 10, 3),
    lockdownFocusAwaySeconds: intInRange(build.MAIN_VITE_LOCKDOWN_FOCUS_AWAY_SECONDS, 5, 120, 15),
    autoStart: opts.isPackaged && bool(build.MAIN_VITE_AUTOSTART, true),
    reminders: {
      firstDelayMinutes: intInRange(build.MAIN_VITE_REMINDER_FIRST_DELAY_MINUTES, 1, 1440, 120),
      intervalMinutes: intInRange(build.MAIN_VITE_REMINDER_INTERVAL_MINUTES, 1, 1440, 240),
      maxPerDay: intInRange(build.MAIN_VITE_REMINDER_MAX_PER_DAY, 0, 10, 2),
    },
    devToolsInDev: opts.isPackaged ? false : bool(env.CSENSE_DEVTOOLS, true),
    externalLinkHosts: [],
  };
}
