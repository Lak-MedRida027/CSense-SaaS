/**
 * The closed table of API operations main may call (plan 5.2, ADR 0014). The renderer can never
 * name a path: IPC handlers reference an entry here, path parameters are validated ObjectIds, and
 * every response is parsed by a schema before it is used.
 */
import {
  assessmentSessionSchema,
  attemptResultSchema,
  gateAttemptRequestSchema,
  gateAttemptResultSchema,
  gateOfflineReleaseRequestSchema,
  gateOfflineReleaseResultSchema,
  gateStatusSchema,
  learningOverviewSchema,
  loginRequestSchema,
  objectIdSchema,
  quizOverviewSchema,
  refreshRequestSchema,
  submitAttemptRequestSchema,
} from '@csense/shared';
import { z } from 'zod';

export type AuthMode = 'none' | 'bearer' | 'refresh';

export interface Operation<
  P extends z.ZodType = z.ZodType,
  B extends z.ZodType = z.ZodType,
  R extends z.ZodType = z.ZodType,
> {
  id: string;
  method: 'GET' | 'POST';
  path: (params: z.output<P>) => string;
  params: P;
  body: B;
  response: R;
  auth: AuthMode;
  /** HTTP statuses that carry a body matching `response`. */
  success: readonly number[];
  timeoutMs: number;
}

const noParams = z.object({}).strict();
const noBody = z.undefined();
const id = objectIdSchema.transform((v) => v.toLowerCase());
const moduleParams = z.object({ moduleId: id }).strict();
const moduleSessionParams = z.object({ moduleId: id, sessionId: id }).strict();
const sessionParams = z.object({ sessionId: id }).strict();
const empty = z.undefined();

const enc = encodeURIComponent;

/** Bounded, non-strict view of the user the server returns on login and /auth/me. */
export const userResponseSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
  role: z.enum(['employee', 'administrator']),
  level: z.string().max(40).optional(),
  totalXP: z.number().int().min(0).optional(),
});
export type UserResponse = z.infer<typeof userResponseSchema>;

const tokenFields = {
  tokenType: z.literal('Bearer'),
  accessToken: z.string().min(1).max(4096),
  accessTokenExpiresIn: z.number().int().min(1).max(86_400),
  refreshToken: z.string().min(1).max(200),
  refreshTokenExpiresAt: z.string().min(1).max(40),
};
export const tokenResponseSchema = z.object(tokenFields);
export const loginResponseSchema = z.object({ ...tokenFields, user: userResponseSchema });

const DEFAULT_TIMEOUT_MS = 15_000;

function op<P extends z.ZodType, B extends z.ZodType, R extends z.ZodType>(
  o: Omit<Operation<P, B, R>, 'timeoutMs' | 'success'> & {
    timeoutMs?: number;
    success?: readonly number[];
  },
): Operation<P, B, R> {
  return { timeoutMs: DEFAULT_TIMEOUT_MS, success: [200], ...o };
}

export const OPERATIONS = {
  'auth.login': op({
    id: 'auth.login',
    method: 'POST',
    path: () => '/auth/login',
    params: noParams,
    body: loginRequestSchema,
    response: loginResponseSchema,
    auth: 'none',
    // Covers the server's failed-login time floor.
    timeoutMs: 30_000,
  }),
  'auth.refresh': op({
    id: 'auth.refresh',
    method: 'POST',
    path: () => '/auth/refresh',
    params: noParams,
    body: refreshRequestSchema,
    response: tokenResponseSchema,
    auth: 'refresh',
  }),
  'auth.logout': op({
    id: 'auth.logout',
    method: 'POST',
    path: () => '/auth/logout',
    params: noParams,
    body: refreshRequestSchema,
    response: empty,
    auth: 'refresh',
    success: [204],
    timeoutMs: 5_000,
  }),
  'auth.me': op({
    id: 'auth.me',
    method: 'GET',
    path: () => '/auth/me',
    params: noParams,
    body: noBody,
    response: userResponseSchema,
    auth: 'bearer',
  }),
  'gate.status': op({
    id: 'gate.status',
    method: 'GET',
    path: () => '/gate/status',
    params: noParams,
    body: noBody,
    response: gateStatusSchema,
    auth: 'bearer',
  }),
  'gate.challenge': op({
    id: 'gate.challenge',
    method: 'POST',
    path: () => '/gate/challenge',
    params: noParams,
    body: noBody,
    response: gateStatusSchema,
    auth: 'bearer',
  }),
  'gate.attempt': op({
    id: 'gate.attempt',
    method: 'POST',
    path: () => '/gate/attempts',
    params: noParams,
    body: gateAttemptRequestSchema,
    response: gateAttemptResultSchema,
    auth: 'bearer',
    success: [201],
  }),
  'gate.offlineRelease': op({
    id: 'gate.offlineRelease',
    method: 'POST',
    path: () => '/gate/offline-releases',
    params: noParams,
    body: gateOfflineReleaseRequestSchema,
    response: gateOfflineReleaseResultSchema,
    auth: 'bearer',
    success: [200, 201],
  }),
  'modules.list': op({
    id: 'modules.list',
    method: 'GET',
    path: () => '/modules',
    params: noParams,
    body: noBody,
    response: learningOverviewSchema,
    auth: 'bearer',
  }),
  'modules.quizOverview': op({
    id: 'modules.quizOverview',
    method: 'GET',
    path: (p) => `/modules/${enc(p.moduleId)}/quiz`,
    params: moduleParams,
    body: noBody,
    response: quizOverviewSchema,
    auth: 'bearer',
  }),
  'quiz.startSession': op({
    id: 'quiz.startSession',
    method: 'POST',
    path: (p) => `/modules/${enc(p.moduleId)}/quiz/sessions`,
    params: moduleParams,
    body: noBody,
    response: assessmentSessionSchema,
    auth: 'bearer',
    success: [201],
  }),
  'quiz.submit': op({
    id: 'quiz.submit',
    method: 'POST',
    path: (p) => `/modules/${enc(p.moduleId)}/quiz/attempts`,
    params: moduleParams,
    body: submitAttemptRequestSchema,
    response: attemptResultSchema,
    auth: 'bearer',
    success: [201],
  }),
  'quiz.abandon': op({
    id: 'quiz.abandon',
    method: 'POST',
    path: (p) => `/modules/${enc(p.moduleId)}/quiz/sessions/${enc(p.sessionId)}/abandon`,
    params: moduleSessionParams,
    body: noBody,
    response: attemptResultSchema,
    auth: 'bearer',
    success: [201],
  }),
  'final.startSession': op({
    id: 'final.startSession',
    method: 'POST',
    path: () => '/final-test/sessions',
    params: noParams,
    body: noBody,
    response: assessmentSessionSchema,
    auth: 'bearer',
    success: [201],
  }),
  'final.submit': op({
    id: 'final.submit',
    method: 'POST',
    path: () => '/final-test/attempts',
    params: noParams,
    body: submitAttemptRequestSchema,
    response: attemptResultSchema,
    auth: 'bearer',
    success: [201],
  }),
  'final.abandon': op({
    id: 'final.abandon',
    method: 'POST',
    path: (p) => `/final-test/sessions/${enc(p.sessionId)}/abandon`,
    params: sessionParams,
    body: noBody,
    response: attemptResultSchema,
    auth: 'bearer',
    success: [201],
  }),
} as const;

export type OperationId = keyof typeof OPERATIONS;
