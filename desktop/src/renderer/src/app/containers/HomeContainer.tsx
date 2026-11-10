import { useCallback, useEffect, useState } from 'react';
import type { LearningOverviewDTO, QuizOverviewDTO } from '../../../../shared/dto';
import { TrainingHomeScreen, type TrainingHomeModule } from '../../screens/TrainingHome';
import { useAppState, useBridge } from '../AppProvider';
import type { QuizTarget } from './QuizContainer';

type Loaded = { overview: LearningOverviewDTO; quizzes: Map<string, QuizOverviewDTO> };

function quizNote(q: QuizOverviewDTO | undefined): string | undefined {
  if (!q || q.canStart) return undefined;
  switch (q.blockedReason) {
    case 'cooldown': {
      const t = q.cooldownUntil ? new Date(q.cooldownUntil) : null;
      return t && !Number.isNaN(t.getTime())
        ? `Quiz available again at ${t.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}.`
        : 'Quiz available again shortly.';
    }
    case 'content_incomplete':
      return 'Finish the module content to unlock the quiz.';
    default:
      return undefined;
  }
}

/** Phase 5 landing page: module list from `learning.getOverview`, quiz availability per module. */
export function HomeContainer({ onStart }: { onStart: (target: QuizTarget) => void }) {
  const bridge = useBridge();
  const { session, gate, appVersion } = useAppState();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  const isAdmin = session.user?.role === 'administrator';

  useEffect(() => {
    // Administrators have no learning content here (the console arrives in a later release).
    if (isAdmin) return undefined;
    const ctl = new AbortController();
    const stale = (): boolean => ctl.signal.aborted;
    void (async () => {
      setState('loading');
      try {
        const res = await bridge.learning.getOverview();
        if (stale()) return;
        if (!res.ok) {
          setState('error');
          return;
        }
        const quizzes = new Map<string, QuizOverviewDTO>();
        const open = res.data.modules.filter(
          (m) => m.status === 'unlocked' || m.status === 'in_progress',
        );
        for (const m of open) {
          const q = await bridge.learning.getQuizOverview({ moduleId: m.id });
          if (stale()) return;
          if (q.ok) quizzes.set(m.id, q.data);
        }
        setLoaded({ overview: res.data, quizzes });
        setState('ready');
      } catch {
        if (!stale()) setState('error');
      }
    })();
    return () => {
      ctl.abort();
    };
  }, [bridge, attempt, isAdmin]);

  const retry = useCallback(() => {
    setAttempt((a) => a + 1);
  }, []);

  const user = session.user;
  const modules: TrainingHomeModule[] =
    loaded?.overview.modules.map((m) => {
      const q = loaded.quizzes.get(m.id);
      return {
        id: m.id,
        order: m.position,
        title: m.title,
        status: m.status,
        lockedReason: m.lockedBy
          ? `Pass the Module ${String(m.lockedBy.position)} quiz first`
          : undefined,
        bestScore: m.bestScore,
        quizAvailable: q?.canStart === true,
        quizNote: quizNote(q),
      };
    }) ?? [];

  const final = loaded?.overview.finalTest ?? null;
  const open = loaded?.overview;

  return (
    <TrainingHomeScreen
      userName={user?.name ?? ''}
      role={user?.role ?? 'employee'}
      level={user?.level}
      state={isAdmin ? 'ready' : state}
      modules={modules}
      finalTest={
        final
          ? {
              status: final.status,
              title: final.title,
              available:
                (final.status === 'unlocked' || final.status === 'in_progress') && !final.passed,
              note:
                final.status === 'locked'
                  ? `Pass ${String(final.remainingModules)} more module${final.remainingModules === 1 ? '' : 's'} to unlock.`
                  : undefined,
            }
          : undefined
      }
      notice={
        gate?.releasedOffline
          ? {
              tone: 'caution',
              text: 'You are working offline. CSense will lock again when it reconnects.',
            }
          : undefined
      }
      onStartQuiz={(moduleId) => {
        const q = loaded?.quizzes.get(moduleId);
        const m = open?.modules.find((x) => x.id === moduleId);
        if (!q || !m) return;
        onStart({
          kind: 'quiz',
          moduleId,
          title: `Module ${String(m.position)} quiz: ${m.title}`,
          questionCount: q.questionCount,
          passingScore: q.passingScore,
          attemptNumber: q.nextAttemptNumber,
        });
      }}
      onStartFinal={() => {
        if (!final) return;
        onStart({
          kind: 'final',
          title: final.title,
          questionCount: final.questionCount,
          passingScore: final.passingScore,
          attemptNumber: final.attempts + 1,
        });
      }}
      onRetry={retry}
      onSignOut={() => {
        void bridge.session.logout();
      }}
      appVersion={appVersion}
    />
  );
}
