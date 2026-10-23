import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

describe('loadEnv', () => {
  it('parses a valid environment and applies defaults', () => {
    const env = loadEnv({ MONGODB_URI: 'mongodb://127.0.0.1:27017/csense' });
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4000,
      LOG_LEVEL: 'info',
      JSON_BODY_LIMIT: '100kb',
      FEATURE_PHISHING: false,
      FEATURE_CONTINUOUS_REVIEW: false,
    });
  });

  it('parses feature flags strictly', () => {
    const env = loadEnv({ MONGODB_URI: 'mongodb://h/db', FEATURE_PHISHING: 'true' });
    expect(env.FEATURE_PHISHING).toBe(true);
    expect(() => loadEnv({ MONGODB_URI: 'mongodb://h/db', FEATURE_PHISHING: 'yes' })).toThrow(
      /FEATURE_PHISHING/,
    );
  });

  it('fails fast when MONGODB_URI is missing or malformed, without echoing values', () => {
    expect(() => loadEnv({})).toThrow(/MONGODB_URI/);
    const secretish = 'postgres://user:hunter2@host/db';
    let message = '';
    try {
      loadEnv({ MONGODB_URI: secretish });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/MONGODB_URI/);
    expect(message).not.toContain('hunter2');
  });

  it('rejects an invalid port', () => {
    expect(() => loadEnv({ MONGODB_URI: 'mongodb://h/db', PORT: '70000' })).toThrow(/PORT/);
  });
});
