/**
 * Bridge v1 handlers (plan 4.4). Thin adapters from validated IPC input to the controllers. Nothing
 * here takes a path, a URL or a token: every API call goes through the operations table.
 */
import type { ApiClient } from '../api/client';
import { OPERATIONS } from '../api/operations';
import type { DesktopConfig } from '../config';
import type { GateController } from '../gate/gateController';
import type { LockdownController } from '../lockdown/lockdownController';
import type { ReminderScheduler } from '../notifications/reminderScheduler';
import { toResult, type SessionService } from '../session/sessionService';
import type { IpcHandlers } from './registry';

export interface HandlerDeps {
  config: Pick<DesktopConfig, 'apiBaseUrl'>;
  api: ApiClient;
  session: SessionService;
  gate: GateController;
  lockdown: LockdownController;
  reminders: Pick<ReminderScheduler, 'noteCooldown' | 'noteLearningActivity'>;
}

const misconfigured = {
  ok: false,
  error: { code: 'MISCONFIGURED', message: 'CSense is misconfigured. Contact IT.' },
} as const;
const locked = {
  ok: false,
  error: { code: 'GATE_LOCKED', message: 'Complete the security check first.' },
} as const;

export function buildHandlers(deps: HandlerDeps): IpcHandlers {
  const { api, session, gate, lockdown, reminders, config } = deps;
  return {
    'session.getState': () => session.getView(),
    'session.login': async (input) => {
      if (config.apiBaseUrl === null) return misconfigured;
      return session.login(input);
    },
    'session.logout': async () => {
      // Sign-out during a quiz leaves lockdown first (never a trap).
      lockdown.leaveForSignOut();
      return session.logout();
    },

    'gate.getView': () => gate.getView(),
    'gate.requestChallenge': () => gate.requestChallenge(),
    'gate.submitAnswer': (input) => gate.submitAnswer(input),
    'gate.continue': () => gate.continue(),
    'gate.continueOffline': () => gate.continueOffline(),

    'assessment.startSecure': async (input) => {
      reminders.noteLearningActivity();
      const res = await lockdown.startSecure(input);
      if (!res.ok && res.error.details?.retryAt) reminders.noteCooldown(res.error.details.retryAt);
      return res;
    },
    'assessment.resume': () => lockdown.resume(),
    'assessment.submit': (input) => lockdown.submit(input),
    'assessment.exit': (input) => lockdown.exit(input),

    'learning.getOverview': async () => {
      if (!gate.isReleased()) return locked;
      reminders.noteLearningActivity();
      return toResult(await api.call(OPERATIONS['modules.list']));
    },
    'learning.getQuizOverview': async (input) => {
      if (!gate.isReleased()) return locked;
      reminders.noteLearningActivity();
      const res = await api.call(OPERATIONS['modules.quizOverview'], {
        params: { moduleId: input.moduleId },
      });
      if (res.ok && res.data.cooldownUntil) reminders.noteCooldown(res.data.cooldownUntil);
      return toResult(res);
    },
  };
}
