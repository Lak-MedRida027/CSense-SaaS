import { z } from 'zod';
import { LEVEL_THRESHOLDS, levelProgress, type XpSummaryDTO } from '@csense/shared';
import {
  EMPLOYEE_ONLY,
  defineRoute,
  requireAuth,
  type RouteDef,
} from '../../http/routeRegistry.js';
import { notFoundError } from '../../lib/httpError.js';
import { Employee } from '../../models/index.js';
import type { BadgesService } from './badges.service.js';

/** No parameters are accepted; any query key is a 400. */
const noQuery = z.object({}).strict();

/**
 * Employee gamification (Phase 4). Identity comes from the token only: no route takes a user id,
 * so there is nothing to tamper with. Employees never see a risk score (D4-22).
 */
export function gamificationRoutes(deps: { badges: BadgesService }): RouteDef[] {
  return [
    defineRoute({
      method: 'get',
      path: '/me/xp',
      access: EMPLOYEE_ONLY,
      schemas: { query: noQuery },
      handler: async (ctx): Promise<XpSummaryDTO> => {
        const user = await Employee.findById(requireAuth(ctx).userId).select('totalXP').lean();
        if (!user) throw notFoundError();
        const totalXP = (user.totalXP as number | undefined) ?? 0;
        const p = levelProgress(totalXP);
        return {
          totalXP,
          level: p.level,
          tier: p.tier,
          currentLevelFloorXP: p.currentLevelFloorXP,
          nextLevel: p.nextLevel,
          nextLevelXP: p.nextLevelXP,
          xpToNextLevel: p.xpToNextLevel,
          thresholds: { ...LEVEL_THRESHOLDS },
        };
      },
    }),
    defineRoute({
      method: 'get',
      path: '/me/badges',
      access: EMPLOYEE_ONLY,
      schemas: { query: noQuery },
      handler: (ctx) => deps.badges.listForEmployee(requireAuth(ctx).userId),
    }),
  ];
}
