import { describe, expect, it } from 'vitest';
import { scrubBootstrapEnv, scrubServerSecrets } from '../src/config/scrubEnv.js';

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

describe('scrubServerSecrets', () => {
  it('SE3: removes the three signing secrets from the environment and returns only their names', () => {
    const env: NodeJS.ProcessEnv = {
      JWT_ACCESS_SECRET: 'access-value',
      REFRESH_TOKEN_SECRET: 'refresh-value',
      AUDIT_CHAIN_SECRET: 'chain-value',
      PORT: '4000',
    };
    const removed = scrubServerSecrets(env);
    expect(removed).toEqual(['AUDIT_CHAIN_SECRET', 'JWT_ACCESS_SECRET', 'REFRESH_TOKEN_SECRET']);
    expect(JSON.stringify(removed)).not.toContain('value');
    expect(env).toEqual({ PORT: '4000' });
    expect(scrubServerSecrets(env)).toEqual([]);
  });
});
