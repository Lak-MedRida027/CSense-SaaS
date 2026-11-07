import { describe, expect, it } from 'vitest';
import { scrubBootstrapEnv } from '../src/config/scrubEnv.js';

describe('scrubBootstrapEnv', () => {
  it('SE1: removes BOOTSTRAP_ADMIN_* keys, returns only their names and keeps everything else', () => {
    const secretValue = 'Pw-super-secret-value';
    const env: NodeJS.ProcessEnv = {
      BOOTSTRAP_ADMIN_EMAIL: 'a@example.com',
      BOOTSTRAP_ADMIN_NAME: 'A',
      BOOTSTRAP_ADMIN_PASSWORD: secretValue,
      PORT: '4000',
    };
    const removed = scrubBootstrapEnv(env);
    expect(removed).toEqual([
      'BOOTSTRAP_ADMIN_EMAIL',
      'BOOTSTRAP_ADMIN_NAME',
      'BOOTSTRAP_ADMIN_PASSWORD',
    ]);
    expect(JSON.stringify(removed)).not.toContain(secretValue);
    expect(env).toEqual({ PORT: '4000' });
  });

  it('SE2: is a no-op when none are present', () => {
    const env: NodeJS.ProcessEnv = { PORT: '4000' };
    expect(scrubBootstrapEnv(env)).toEqual([]);
    expect(env).toEqual({ PORT: '4000' });
  });
});
