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
import type { ModuleDetailView } from '../../shared/ipcChannels';
import type { ModuleDetailDTO } from '../../shared/dto';
import { IPC_CHANNEL_POLICY } from './policy';
import type { IpcHandlers } from './registry';

export interface HandlerDeps {
  config: Pick<DesktopConfig, 'apiBaseUrl'>;
  api: ApiClient;
  session: SessionService;
  gate: GateController;
  lockdown: LockdownController;
  reminders: Pick<ReminderScheduler, 'noteCooldown' | 'noteLearningActivity'>;
  /** Content URL to `app://csense/media/<file>` or null (ADR 0019). The renderer never sees the original. */
  resolveMedia: (url: string | null | undefined) => string | null;
}

const misconfigured = {
  ok: false,
  error: { code: 'MISCONFIGURED', message: 'CSense is misconfigured. Contact IT.' },
} as const;
const locked = {
  ok: false,
  error: { code: 'GATE_LOCKED', message: 'Complete the security check first.' },
} as const;
const closedBook = {
  ok: false,
  error: { code: 'LOCKDOWN_ACTIVE', message: 'Finish or leave the quiz first.' },
} as const;

/** Maps authored media URLs to bundled media; nothing remote reaches the renderer. */
export function toModuleView(
  detail: ModuleDetailDTO,
  resolve: (url: string | null | undefined) => string | null,
): ModuleDetailView {
  const { video, ...content } = detail.content;
  return {
    ...detail,
    content: {
      ...content,
      video: video
        ? {
            src: resolve(video.url),
            captionsSrc: resolve(video.captionsUrl),
            transcript: video.transcript,
          }
        : null,
    },
  };
}

export function buildHandlers(deps: HandlerDeps): IpcHandlers {
  return applyPolicy(deps, rawHandlers(deps));
}

/**
 * Enforces the channel policy table on every handler (ADR 0020): `GATE_LOCKED` before release,
 * `LOCKDOWN_ACTIVE` during a quiz for the closed-book channels, and an `ACCESS_RESTRICTED` answer to
 * a journey call re-locks the workstation (D6-19). The checks run before any request is made.
 */
function applyPolicy(deps: HandlerDeps, handlers: IpcHandlers): IpcHandlers {
  const { gate, lockdown } = deps;
  const out: Record<string, (input: unknown) => unknown> = {};
  for (const key of Object.keys(handlers) as (keyof IpcHandlers)[]) {
    const policy = IPC_CHANNEL_POLICY[key];
    const handler = handlers[key] as (input: unknown) => unknown;
    out[key] = async (input: unknown) => {
      if (policy.requiresRelease && !gate.isReleased()) return locked;
      if (policy.duringLockdown === 'deny' && lockdown.isActive()) return closedBook;
      const res = (await handler(input)) as {
        ok?: boolean;
        error?: { code?: string };
      };
      if (policy.requiresRelease && res.ok === false && res.error?.code === 'ACCESS_RESTRICTED') {
        gate.noteRestricted();
      }
      return res;
    };
  }
  return out as unknown as IpcHandlers;
}

function rawHandlers(deps: HandlerDeps): IpcHandlers {
  const { api, session, gate, lockdown, reminders, config } = deps;
  return {
    'session.getState': () => session.getView(),
    'session.login': async (input) => {
      if (config.apiBaseUrl === null) return misconfigured;
      // P5-L2: signing in is a Login-step action. While released (or mid-gate) it would swap identity
      // without a challenge, so it is refused unless main's gate is waiting for credentials.
      if (gate.getView().phase !== 'signed_out') return locked;
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
      reminders.noteLearningActivity();
      return toResult(await api.call(OPERATIONS['modules.list']));
    },
    'learning.getQuizOverview': async (input) => {
      reminders.noteLearningActivity();
      const res = await api.call(OPERATIONS['modules.quizOverview'], {
        params: { moduleId: input.moduleId },
      });
      if (res.ok && res.data.cooldownUntil) reminders.noteCooldown(res.data.cooldownUntil);
      return toResult(res);
    },

    'learning.getModule': async (input) => {
      reminders.noteLearningActivity();
      const res = await api.call(OPERATIONS['modules.detail'], {
        params: { moduleId: input.moduleId },
      });
      if (!res.ok) return toResult(res);
      if (res.data.quiz?.cooldownUntil) reminders.noteCooldown(res.data.quiz.cooldownUntil);
      return { ok: true, data: toModuleView(res.data, deps.resolveMedia) };
    },
    'learning.startModule': async (input) => {
      reminders.noteLearningActivity();
      return toResult(
        await api.call(OPERATIONS['modules.start'], { params: { moduleId: input.moduleId } }),
      );
    },
    'learning.answerExercise': async (input) => {
      reminders.noteLearningActivity();
      return toResult(
        await api.call(OPERATIONS['modules.answerExercise'], {
          params: { moduleId: input.moduleId, exerciseId: input.exerciseId },
          body: { selectedIndex: input.selectedIndex },
        }),
      );
    },
    'learning.completeContent': async (input) => {
      reminders.noteLearningActivity();
      return toResult(
        await api.call(OPERATIONS['modules.completeContent'], {
          params: { moduleId: input.moduleId },
        }),
      );
    },
    'learning.getFinalTestOverview': async () => {
      reminders.noteLearningActivity();
      const res = await api.call(OPERATIONS['final.overview']);
      if (res.ok && res.data.cooldownUntil) reminders.noteCooldown(res.data.cooldownUntil);
      return toResult(res);
    },

    'me.getXp': async () => toResult(await api.call(OPERATIONS['me.xp'])),
    'me.getBadges': async () => toResult(await api.call(OPERATIONS['me.badges'])),
    'me.completeOnboarding': async (input) => {
      const res = await api.call(OPERATIONS['me.onboarding'], { body: input });
      if (res.ok) session.markOnboardingDone();
      return toResult(res);
    },
  };
}
