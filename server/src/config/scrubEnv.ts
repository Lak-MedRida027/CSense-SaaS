/**
 * `loadEnv()` copies the repo-root `.env` into `process.env`, which would put the one-off
 * BOOTSTRAP_ADMIN_* values (including the password) into the long-running API process. The API
 * calls this right after `loadEnv()`. The bootstrap script does not, because it needs them.
 * Returns the removed key names (never values).
 */
export function scrubBootstrapEnv(env: NodeJS.ProcessEnv): string[] {
  const keys = Object.keys(env).filter((k) => k.startsWith('BOOTSTRAP_ADMIN_'));
  for (const key of keys) Reflect.deleteProperty(env, key);
  return keys.sort();
}

/** Secrets the API copies into its config at start-up; the process environment keeps no second copy. */
export const SERVER_SECRET_KEYS = [
  'JWT_ACCESS_SECRET',
  'REFRESH_TOKEN_SECRET',
  'AUDIT_CHAIN_SECRET',
] as const;

/**
 * Called after `loadEnv()` has been turned into the app config. Removing the signing secrets from
 * `process.env` keeps them out of any child process and out of crash dumps of the environment.
 * Returns the removed key names (never values).
 */
export function scrubServerSecrets(env: NodeJS.ProcessEnv): string[] {
  const removed: string[] = [];
  for (const key of SERVER_SECRET_KEYS) {
    if (key in env) {
      Reflect.deleteProperty(env, key);
      removed.push(key);
    }
  }
  return removed.sort();
}
