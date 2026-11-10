import { Types, trusted } from 'mongoose';
import { vi } from 'vitest';
import type { Express } from 'express';
import type { AttemptEndReason } from '@csense/shared';
import type { AppOptions } from '../../src/app.js';
import { verifyChain, type StoredChainEntry } from '../../src/features/audit/chain.js';
import type { GamificationServices } from '../../src/features/gamification/services.js';
import { AuditLog, Badge, Escalation, QuizAttempt } from '../../src/models/index.js';
import { buildTestApp, createAdmin, createEmployee, loginOk, type TestApp } from './fixtures.js';
import {
  clientFor,
  createCurriculum,
  createFinalTest,
  type Client,
  type TestCurriculum,
} from './learningFixtures.js';
import { testChainSecret } from './testConfig.js';

export interface AttemptSpec {
  assessmentId: string;
  moduleId?: string | null;
  kind?: 'Quiz' | 'FinalTest';
  attemptNumber: number;
  endReason?: AttemptEndReason;
  correct: number;
  total?: number;
  attemptedAt?: Date;
}

/** Insert attempts straight into the database (no session flow), for risk and XP scenarios. */
export async function insertAttempts(userId: string, specs: AttemptSpec[]): Promise<string[]> {
  const ids: string[] = [];
  for (const [i, s] of specs.entries()) {
    const total = s.total ?? 5;
    const endReason = s.endReason ?? 'submitted';
    const submitted = endReason === 'submitted';
    const score = submitted ? Math.round((s.correct / total) * 100) : 0;
    const doc = await QuizAttempt.create({
      userId: new Types.ObjectId(userId),
      type: s.kind ?? 'Quiz',
      refId: new Types.ObjectId(s.assessmentId),
      answers: Array.from({ length: total }, (_, n) => ({
        questionId: new Types.ObjectId(),
        selectedIndex: submitted ? 0 : null,
        correct: submitted && n < s.correct,
      })),
      score,
      passed: submitted && score >= 70,
      sessionId: new Types.ObjectId(),
      moduleId: s.moduleId ? new Types.ObjectId(s.moduleId) : null,
      attemptNumber: s.attemptNumber,
      endReason,
      correctCount: submitted ? s.correct : 0,
      totalCount: total,
      passingScore: 70,
      attemptedAt: s.attemptedAt ?? new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
    });
    ids.push(doc.id);
  }
  return ids;
}

/** The crafted high-risk history of the plan: K 100, B 25, S disabled, E 88 -> composite 71. */
export function craftedHighRiskSpecs(curriculum: TestCurriculum): AttemptSpec[] {
  const [m1, m2] = curriculum.modules;
  if (!m1 || !m2) throw new Error('needs two modules');
  const base = (m: typeof m1) => ({ assessmentId: m.quizId, moduleId: m.id });
  return [
    { ...base(m1), attemptNumber: 1, endReason: 'abandoned', correct: 0 },
    { ...base(m1), attemptNumber: 2, correct: 1 },
    { ...base(m1), attemptNumber: 3, correct: 4 },
    { ...base(m2), attemptNumber: 1, endReason: 'abandoned', correct: 0 },
  ];
}

/** One badge per module in the curriculum, as the badge seed would create them. */
export async function seedBadgesFor(curriculum: TestCurriculum): Promise<void> {
  for (const m of curriculum.modules) {
    await Badge.create({
      name: `Badge ${String(m.order)}`,
      moduleId: new Types.ObjectId(m.id),
      iconMotif: 'shield',
    });
  }
}

export async function verifyAuditChain(secret = testChainSecret) {
  const cursor = AuditLog.find({ seq: trusted({ $gte: 1 }) })
    .sort({ seq: 1 })
    .lean<StoredChainEntry[]>()
    .cursor();
  return verifyChain(cursor, secret);
}

/** Audit entries about one target (user or escalation), oldest first. */
export async function auditEntriesFor(targetId: string) {
  return AuditLog.find({ targetId: new Types.ObjectId(targetId) })
    .sort({ seq: 1 })
    .lean();
}

export interface GamificationApp extends TestApp {
  g: GamificationServices;
  notifier: {
    escalationOpened: ReturnType<typeof vi.fn>;
    escalationRetriggered: ReturnType<typeof vi.fn>;
  };
}

/** A test app with the real XP, badge, risk and governance services and a notifier spy. */
export async function buildGamificationApp(
  overrides: Parameters<typeof buildTestApp>[0] = {},
  options: Partial<Omit<AppOptions, 'config' | 'logger' | 'clock'>> = {},
): Promise<GamificationApp> {
  const notifier = { escalationOpened: vi.fn(), escalationRetriggered: vi.fn() };
  const t = await buildTestApp(overrides, { notifier, ...options });
  return { ...t, g: t.app.locals.gamification as GamificationServices, notifier };
}

export async function adminClient(
  app: Express,
  creds: { password: string; hash: string },
): Promise<Client> {
  const admin = await createAdmin(creds);
  const { accessToken } = await loginOk(app, admin);
  return clientFor(app, admin, accessToken);
}

export async function employeeClient(
  app: Express,
  creds: { password: string; hash: string },
): Promise<Client> {
  const user = await createEmployee(creds);
  const { accessToken } = await loginOk(app, user);
  return clientFor(app, user, accessToken);
}

/** Seven modules with quizzes and a final test, as in the seed. */
export async function createFullCurriculum(): Promise<TestCurriculum> {
  const curriculum = await createCurriculum({ count: 7 });
  await createFinalTest(curriculum.keys, 15);
  return curriculum;
}

export interface CraftedEmployee {
  id: string;
  email: string;
  password: string;
  curriculum: TestCurriculum;
  escalationId: string;
}

/**
 * Employee with the crafted history (K 100, B 25, S disabled, E 88 -> composite 71, High) whose
 * profile has been recomputed, so one risk_level_high escalation is open.
 */
export async function craftHighRiskEmployee(
  g: GamificationServices,
  creds: { password: string; hash: string },
  curriculum?: TestCurriculum,
): Promise<CraftedEmployee> {
  const cur = curriculum ?? (await createFullCurriculum());
  const user = await createEmployee(creds);
  await insertAttempts(user.id, craftedHighRiskSpecs(cur));
  await g.risk.recomputeForUser(user.id, { type: 'reconcile' });
  const esc = await Escalation.findOne({ userId: new Types.ObjectId(user.id) }).lean();
  if (!esc) throw new Error('crafted employee did not produce an escalation');
  return { ...user, curriculum: cur, escalationId: esc._id.toHexString() };
}
