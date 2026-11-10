import type { Express } from 'express';
import { Types } from 'mongoose';
import request from 'supertest';
import { vi } from 'vitest';
import {
  gateAttemptResultSchema,
  gateStatusSchema,
  type GateAttemptResultDTO,
  type GateStatusDTO,
} from '@csense/shared';
import { createApp, type AppOptions } from '../../src/app.js';
import type { GamificationServices } from '../../src/features/gamification/services.js';
import type { Shuffle } from '../../src/features/learning/shuffle.js';
import { Employee, Escalation, GateQuestion, GateRun } from '../../src/models/index.js';
import {
  bearer,
  createAdmin,
  createEmployee,
  loginOk,
  makeCredentials,
  type SeedUser,
} from './fixtures.js';
import { controllableClock, silentLogger, testConfig } from './testConfig.js';

export const identityShuffle: Shuffle = <T>(items: readonly T[]): T[] => [...items];

/** A fixed start so "same organisation day" assertions never depend on when the suite runs. */
export const GATE_TEST_START = new Date('2026-03-10T08:00:00.000Z');

export interface GateApp {
  app: Express;
  config: ReturnType<typeof testConfig>;
  clock: () => Date;
  advance: (ms: number) => void;
  g: GamificationServices;
  notifier: {
    escalationOpened: ReturnType<typeof vi.fn>;
    escalationRetriggered: ReturnType<typeof vi.fn>;
  };
}

/** The real app with a fixed, movable clock, an identity shuffle and a notifier spy. */
export async function buildGateApp(
  overrides: Parameters<typeof testConfig>[0] = {},
  options: Partial<Omit<AppOptions, 'config' | 'logger' | 'clock'>> = {},
): Promise<GateApp> {
  const config = testConfig(overrides);
  const { clock, advance } = controllableClock(GATE_TEST_START);
  const notifier = { escalationOpened: vi.fn(), escalationRetriggered: vi.fn() };
  const app = await createApp({
    logger: silentLogger,
    config,
    clock,
    shuffle: identityShuffle,
    notifier,
    ...options,
  });
  return {
    app,
    config,
    clock,
    advance,
    g: app.locals.gamification as GamificationServices,
    notifier,
  };
}

export const HOUR_MS = 3_600_000;

/** Active gate questions with known keys: question i has `correctAnswer = i % 4`. */
export async function createGateQuestions(count = 8): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await GateQuestion.create({
      prompt: `Gate question ${String(i)}: which action is safe?`,
      options: ['Option A', 'Option B', 'Option C', 'Option D'],
      correctAnswer: i % 4,
      explanation: `Reason ${String(i)}: the safe habit protects everyone.`,
      topic: 'test',
      isActive: true,
    });
  }
}

export interface GateEmployee extends SeedUser {
  token: string;
}

export async function gateEmployee(
  app: Express,
  creds: Awaited<ReturnType<typeof makeCredentials>>,
): Promise<GateEmployee> {
  const user = await createEmployee(creds);
  const { accessToken } = await loginOk(app, user);
  return { ...user, token: accessToken };
}

export async function gateAdmin(
  app: Express,
  creds: Awaited<ReturnType<typeof makeCredentials>>,
): Promise<GateEmployee> {
  const user = await createAdmin(creds);
  const { accessToken } = await loginOk(app, user);
  return { ...user, token: accessToken };
}

const API = '/api/v1';

export async function getStatus(app: Express, token: string) {
  return request(app)
    .get(`${API}/gate/status`)
    .set(...bearer(token));
}

export async function postChallenge(app: Express, token: string) {
  return request(app)
    .post(`${API}/gate/challenge`)
    .set(...bearer(token))
    .send({});
}

export async function postAttempt(app: Express, token: string, body: Record<string, unknown>) {
  return request(app)
    .post(`${API}/gate/attempts`)
    .set(...bearer(token))
    .send(body);
}

/** Open a challenge and parse the response with the strict shared schema. */
export async function openChallenge(app: Express, token: string): Promise<GateStatusDTO> {
  const res = await postChallenge(app, token);
  if (res.status !== 200) throw new Error(`challenge failed: ${String(res.status)}`);
  return gateStatusSchema.parse(res.body);
}

/** The server-held key of the employee's open run (tests read it straight from the database). */
export async function keyFor(userId: string): Promise<number> {
  const run = await GateRun.findOne({ userId: new Types.ObjectId(userId), status: 'open' })
    .select('+current.correctAnswer')
    .lean<{ current?: { correctAnswer: number } | null }>();
  if (!run?.current) throw new Error('no open challenge');
  return run.current.correctAnswer;
}

export async function answerRight(app: Express, e: GateEmployee, challengeId: string) {
  return postAttempt(app, e.token, { challengeId, selectedIndex: await keyFor(e.id) });
}

export async function answerWrong(app: Express, e: GateEmployee, challengeId: string) {
  const key = await keyFor(e.id);
  return postAttempt(app, e.token, { challengeId, selectedIndex: (key + 1) % 4 });
}

export function parseResult(body: unknown): GateAttemptResultDTO {
  return gateAttemptResultSchema.parse(body);
}

/** Fail the gate: answer wrong until restricted. Returns the final result. */
export async function failGate(app: Express, e: GateEmployee): Promise<GateAttemptResultDTO> {
  let status = await openChallenge(app, e.token);
  let result: GateAttemptResultDTO | null = null;
  for (let i = 0; i < status.maxAttempts; i += 1) {
    if (!status.challenge) break;
    const res = await answerWrong(app, e, status.challenge.challengeId);
    if (res.status !== 201) throw new Error(`attempt failed: ${String(res.status)}`);
    result = parseResult(res.body);
    status = result.status;
  }
  if (!result || result.status.state !== 'restricted') throw new Error('gate was not failed');
  return result;
}

export async function passGate(app: Express, e: GateEmployee): Promise<GateAttemptResultDTO> {
  const status = await openChallenge(app, e.token);
  if (!status.challenge) throw new Error('no challenge');
  const res = await answerRight(app, e, status.challenge.challengeId);
  if (res.status !== 201) throw new Error(`attempt failed: ${String(res.status)}`);
  return parseResult(res.body);
}

export async function escalationFor(userId: string) {
  return Escalation.findOne({
    userId: new Types.ObjectId(userId),
    reason: 'gate_access_restricted',
  }).lean();
}

export async function gateFlag(userId: string) {
  const row = await Employee.findById(userId).select('gateRestriction').lean<{
    gateRestriction?: { runId: Types.ObjectId; restrictedAt: Date } | null;
  }>();
  return row?.gateRestriction ?? null;
}

/** All own and nested keys of a JSON value (for the "no key leaks" deep scan). */
export function allKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) allKeys(v, out);
  } else if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      allKeys(v, out);
    }
  }
  return out;
}
