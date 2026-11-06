import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import {
  ADMIN_ONLY,
  PUBLIC,
  assertRouteDefs,
  defineRoute,
  type RouteDef,
} from '../src/http/routeRegistry.js';
import { silentLogger, testConfig } from './helpers/testConfig.js';

const handler = () => ({ ok: true });
const good = (): RouteDef => defineRoute({ method: 'get', path: '/x', access: PUBLIC, handler });
// Simulates untyped input reaching the registry (e.g. a def built from a loosely typed module).
const untyped = (value: object): RouteDef => value as unknown as RouteDef;

describe('assertRouteDefs', () => {
  it('accepts well-formed definitions', () => {
    expect(() => {
      assertRouteDefs([
        good(),
        defineRoute({ method: 'post', path: '/y', access: ADMIN_ONLY, handler }),
      ]);
    }).not.toThrow();
  });

  it('R1: a def without access throws', () => {
    expect(() => {
      assertRouteDefs([untyped({ method: 'get', path: '/x', handler })]);
    }).toThrow(/access/);
  });

  it('R2: an unknown access kind throws', () => {
    expect(() => {
      assertRouteDefs([
        untyped({ method: 'get', path: '/x', handler, access: { kind: 'anyone' } }),
      ]);
    }).toThrow(/access/);
  });

  it('R3: empty roles or an unknown role throws', () => {
    expect(() => {
      assertRouteDefs([
        untyped({ method: 'get', path: '/x', handler, access: { kind: 'role', roles: [] } }),
      ]);
    }).toThrow(/access/);
    expect(() => {
      assertRouteDefs([
        untyped({ method: 'get', path: '/x', handler, access: { kind: 'role', roles: ['root'] } }),
      ]);
    }).toThrow(/access/);
  });

  it('R4: duplicate method+path throws, and a path without a leading slash throws', () => {
    expect(() => {
      assertRouteDefs([good(), good()]);
    }).toThrow(/Duplicate/);
    expect(() => {
      assertRouteDefs([untyped({ method: 'get', path: 'x', handler, access: PUBLIC })]);
    }).toThrow(/path/);
  });

  it('R5: createApp rejects when given an unannotated route', async () => {
    const bad = untyped({ method: 'get', path: '/sneaky', handler });
    await expect(
      createApp({ logger: silentLogger, config: testConfig(), routes: [bad] }),
    ).rejects.toThrow(/access/);
  });
});
