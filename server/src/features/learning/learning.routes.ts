import {
  attemptParamsSchema,
  exerciseAnswerRequestSchema,
  exerciseParamsSchema,
  listAttemptsQuerySchema,
  moduleParamsSchema,
  moduleSessionParamsSchema,
  sessionParamsSchema,
  submitAttemptRequestSchema,
} from '@csense/shared';
import {
  EMPLOYEE_ONLY,
  defineRoute,
  requireAuth,
  type RouteContext,
  type RouteDef,
} from '../../http/routeRegistry.js';
import {
  abandonSession,
  getFinalTestOverview,
  getQuizOverview,
  startSession,
  submitAttempt,
} from './assessment.service.js';
import { getAttempt, listAttempts } from './attempts.service.js';
import type { LearningDeps } from './deps.js';
import {
  answerExercise,
  completeContent,
  getModuleDetail,
  getOverview,
  startModule,
} from './modules.service.js';

/**
 * Thin controllers (Phase 3 inventory, 15 routes). Every route is EMPLOYEE_ONLY: the caller's
 * identity comes from the token, and no route takes a user id. All decisions live in the services.
 */
export function learningRoutes(deps: LearningDeps): RouteDef[] {
  const who = (ctx: RouteContext) => ({
    userId: requireAuth(ctx).userId,
    info: { requestId: ctx.requestId },
  });

  return [
    defineRoute({
      method: 'get',
      path: '/modules',
      access: EMPLOYEE_ONLY,
      handler: (ctx) => getOverview(who(ctx).userId),
    }),
    defineRoute({
      method: 'get',
      path: '/modules/:moduleId',
      access: EMPLOYEE_ONLY,
      schemas: { params: moduleParamsSchema },
      handler: (ctx) => getModuleDetail(deps, who(ctx).userId, ctx.params.moduleId),
    }),
    defineRoute({
      method: 'post',
      path: '/modules/:moduleId/start',
      access: EMPLOYEE_ONLY,
      schemas: { params: moduleParamsSchema },
      handler: (ctx) => startModule(deps, who(ctx).userId, ctx.params.moduleId),
    }),
    defineRoute({
      method: 'post',
      path: '/modules/:moduleId/exercises/:exerciseId/answers',
      access: EMPLOYEE_ONLY,
      schemas: { params: exerciseParamsSchema, body: exerciseAnswerRequestSchema },
      handler: (ctx) =>
        answerExercise(
          deps,
          who(ctx).userId,
          ctx.params.moduleId,
          ctx.params.exerciseId,
          ctx.body.selectedIndex,
        ),
    }),
    defineRoute({
      method: 'post',
      path: '/modules/:moduleId/content/complete',
      access: EMPLOYEE_ONLY,
      schemas: { params: moduleParamsSchema },
      handler: (ctx) => completeContent(deps, who(ctx).userId, ctx.params.moduleId),
    }),

    // --- Module quiz ---
    defineRoute({
      method: 'get',
      path: '/modules/:moduleId/quiz',
      access: EMPLOYEE_ONLY,
      schemas: { params: moduleParamsSchema },
      handler: (ctx) => getQuizOverview(deps, who(ctx).userId, ctx.params.moduleId),
    }),
    defineRoute({
      method: 'post',
      path: '/modules/:moduleId/quiz/sessions',
      access: EMPLOYEE_ONLY,
      limiter: 'sessionStart',
      schemas: { params: moduleParamsSchema },
      handler: async (ctx, _req, res) => {
        const { userId, info } = who(ctx);
        const session = await startSession(
          deps,
          userId,
          { kind: 'Quiz', moduleId: ctx.params.moduleId },
          info,
        );
        res.status(201).json(session);
      },
    }),
    defineRoute({
      method: 'post',
      path: '/modules/:moduleId/quiz/sessions/:sessionId/abandon',
      access: EMPLOYEE_ONLY,
      schemas: { params: moduleSessionParamsSchema },
      handler: async (ctx, _req, res) => {
        const { userId, info } = who(ctx);
        const result = await abandonSession(
          deps,
          userId,
          { kind: 'Quiz', moduleId: ctx.params.moduleId },
          ctx.params.sessionId,
          info,
        );
        res.status(201).json(result);
      },
    }),
    defineRoute({
      method: 'post',
      path: '/modules/:moduleId/quiz/attempts',
      access: EMPLOYEE_ONLY,
      schemas: { params: moduleParamsSchema, body: submitAttemptRequestSchema },
      handler: async (ctx, _req, res) => {
        const { userId, info } = who(ctx);
        const result = await submitAttempt(
          deps,
          userId,
          { kind: 'Quiz', moduleId: ctx.params.moduleId },
          ctx.body,
          info,
        );
        res.status(201).json(result);
      },
    }),

    // --- Final assessment ---
    defineRoute({
      method: 'get',
      path: '/final-test',
      access: EMPLOYEE_ONLY,
      handler: (ctx) => getFinalTestOverview(deps, who(ctx).userId),
    }),
    defineRoute({
      method: 'post',
      path: '/final-test/sessions',
      access: EMPLOYEE_ONLY,
      limiter: 'sessionStart',
      handler: async (ctx, _req, res) => {
        const { userId, info } = who(ctx);
        res.status(201).json(await startSession(deps, userId, { kind: 'FinalTest' }, info));
      },
    }),
    defineRoute({
      method: 'post',
      path: '/final-test/sessions/:sessionId/abandon',
      access: EMPLOYEE_ONLY,
      schemas: { params: sessionParamsSchema },
      handler: async (ctx, _req, res) => {
        const { userId, info } = who(ctx);
        res
          .status(201)
          .json(
            await abandonSession(deps, userId, { kind: 'FinalTest' }, ctx.params.sessionId, info),
          );
      },
    }),
    defineRoute({
      method: 'post',
      path: '/final-test/attempts',
      access: EMPLOYEE_ONLY,
      schemas: { body: submitAttemptRequestSchema },
      handler: async (ctx, _req, res) => {
        const { userId, info } = who(ctx);
        res
          .status(201)
          .json(await submitAttempt(deps, userId, { kind: 'FinalTest' }, ctx.body, info));
      },
    }),

    // --- Attempt history: always the caller's own (IDOR-safe by construction) ---
    defineRoute({
      method: 'get',
      path: '/me/attempts',
      access: EMPLOYEE_ONLY,
      schemas: { query: listAttemptsQuerySchema },
      handler: (ctx) => listAttempts(who(ctx).userId, ctx.query),
    }),
    defineRoute({
      method: 'get',
      path: '/me/attempts/:attemptId',
      access: EMPLOYEE_ONLY,
      schemas: { params: attemptParamsSchema },
      handler: (ctx) => getAttempt(who(ctx).userId, ctx.params.attemptId),
    }),
  ];
}
