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
