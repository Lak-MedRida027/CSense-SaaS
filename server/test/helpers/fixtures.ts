import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import { Types } from 'mongoose';
import request from 'supertest';
import type { LoginResponse } from '@csense/shared';
import { createApp, type AppOptions } from '../../src/app.js';
import type { AppConfig } from '../../src/config/appConfig.js';
import { hashPassword } from '../../src/features/auth/password.js';
import { Administrator, Employee } from '../../src/models/index.js';
import { controllableClock, silentLogger, testConfig } from './testConfig.js';

/** Random per run; it is a test credential, not a secret, but nothing is hard-coded anyway. */
export const randomPassword = (): string => `Pw-${randomBytes(12).toString('base64url')}`;

let counter = 0;
export const uniqueEmail = (prefix = 'user'): string => {
  counter += 1;
  return `${prefix}${String(counter)}.${randomBytes(3).toString('hex')}@example.com`;
};

export interface TestApp {
  app: Express;
  config: AppConfig;
  clock: () => Date;
  advance: (ms: number) => void;
}

export async function buildTestApp(
  overrides: Parameters<typeof testConfig>[0] = {},
  options: Partial<Omit<AppOptions, 'config' | 'logger' | 'clock'>> = {},
): Promise<TestApp> {
  const config = testConfig(overrides);
  const { clock, advance } = controllableClock();
  const app = await createApp({ logger: silentLogger, config, clock, ...options });
  return { app, config, clock, advance };
}

/** A cost-12 bcrypt hash is slow (~250 ms): compute once per file and reuse it. */
export async function makeCredentials(): Promise<{ password: string; hash: string }> {
  const password = randomPassword();
  return { password, hash: await hashPassword(password, 12) };
}

export interface SeedUser {
  id: string;
  email: string;
  password: string;
}

export async function createEmployee(
  creds: { password: string; hash: string },
  overrides: { email?: string; isActive?: boolean; createdBy?: Types.ObjectId } = {},
): Promise<SeedUser> {
  const email = overrides.email ?? uniqueEmail('emp');
  const doc = await Employee.create({
    name: 'Test Employee',
    email,
    passwordHash: creds.hash,
    isActive: overrides.isActive ?? true,
    createdBy: overrides.createdBy ?? new Types.ObjectId(),
  });
  return { id: doc.id, email, password: creds.password };
}

export async function createAdmin(
  creds: { password: string; hash: string },
  overrides: { email?: string } = {},
): Promise<SeedUser> {
  const email = overrides.email ?? uniqueEmail('adm');
  const doc = await Administrator.create({
    name: 'Test Admin',
    email,
    passwordHash: creds.hash,
    createdBy: new Types.ObjectId(),
  });
  return { id: doc.id, email, password: creds.password };
}

export async function login(app: Express, user: { email: string; password: string }) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: user.password });
  return { res, body: res.body as LoginResponse };
}

export async function loginOk(app: Express, user: { email: string; password: string }) {
  const { res, body } = await login(app, user);
  if (res.status !== 200) throw new Error(`login failed in fixture: ${String(res.status)}`);
  return body;
}

export const bearer = (token: string): [string, string] => ['Authorization', `Bearer ${token}`];
