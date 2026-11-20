import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { DisplaySettingsDialog } from '../components/DisplaySettingsDialog';
import { AchievementDialog } from '../components/AchievementDialog';
import { ToastRegion, type ToastItem } from '../components/Toast';
import type { StatusTone } from '../design/tokens';
import { AdminHomeScreen } from '../screens/AdminHome';
import { useAppState, useBridge, useLearningStore } from './AppProvider';
import { BadgesContainer } from './containers/BadgesContainer';
import { DashboardContainer } from './containers/DashboardContainer';
import { FinalAssessmentContainer } from './containers/FinalAssessmentContainer';
import { ModulePlayerContainer } from './containers/ModulePlayerContainer';
import { ModulesContainer } from './containers/ModulesContainer';
import { OnboardingContainer } from './containers/OnboardingContainer';
import { QuizContainer, targetFromSession } from './containers/QuizContainer';
import { hasAchievements, type Achievements } from './learning/achievements';
import { initialView, reduceView, type NavAction, type View } from './navigation';
import { WorkspaceContext, type WorkspaceActions } from './WorkspaceContext';

/** Moves keyboard focus to the new view's heading so screen readers announce the change. */
function focusHeading(): void {
  const h1 = document.querySelector<HTMLElement>('h1');
  if (!h1) return;
  if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1');
  h1.focus({ preventScroll: true });
}

function viewKey(v: View): string {
  switch (v.name) {
    case 'module':
      return `module:${v.moduleId}:${v.stage}`;
    case 'quiz':
      return `quiz:${v.target.kind}`;
    default:
      return v.name;
  }
}

/**
 * The released workstation: a small view state machine (plan 7.1) over onboarding, dashboard,
 * modules, badges, final assessment, the module player and the quiz flow (including crash-recovery
 * resume). Administrators get a placeholder until the console ships.
 */
export function Workspace() {
  const { session, resume, lockdown, navRequest } = useAppState();
  const bridge = useBridge();
  const learning = useLearningStore();
  const user = session.user;

  const [view, dispatch] = useReducer(reduceView, undefined, (): View =>
    initialView({
      resumeTarget: resume ? targetFromSession(resume.session) : null,
      onboardingRequired: user?.role === 'employee' && user.onboardingRequired === true,
    }),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pending, setPending] = useState<Achievements | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastSeq = useRef(0);
  const lastKey = useRef(viewKey(view));

  // Notification clicks (main's `navigate` event): never out of a running quiz; deep links only to
  // modules that are known and not locked (the server enforces the real lock).
  const seenNav = useRef(navRequest?.id ?? 0);
  useEffect(() => {
    if (!navRequest || navRequest.id === seenNav.current) return;
    seenNav.current = navRequest.id;
    if (navRequest.to === 'home') {
      dispatch({ type: 'home', lockdownActive: lockdown.state !== 'inactive' });
      return;
    }
    const id = navRequest.to.module;
    const m = learning.getState().overview.data?.modules.find((x) => x.id === id);
    dispatch({
      type: 'deepLink',
      moduleId: id,
      openable: m !== undefined && m.status !== 'locked',
    });
  }, [navRequest, lockdown.state, learning]);

  useEffect(() => {
    const key = viewKey(view);
    if (key === lastKey.current) return;
    lastKey.current = key;
    // After the new view has rendered.
    const t = window.setTimeout(focusHeading, 0);
    return () => {
      window.clearTimeout(t);
    };
  }, [view]);

  const actions = useMemo<WorkspaceActions>(
    () => ({
      dispatch: (a: NavAction) => {
        dispatch(a);
      },
      openSettings: () => {
        setSettingsOpen(true);
      },
      signOut: () => {
        void bridge.session.logout();
      },
      queueAchievements: (a) => {
        setPending(hasAchievements(a) ? a : null);
      },
      toast: (tone: StatusTone, message: string) => {
        toastSeq.current += 1;
        const id = `t${String(toastSeq.current)}`;
        setToasts((t) => [...t, { id, tone, message }]);
      },
    }),
    [bridge],
  );

  let screen;
  if (user?.role === 'administrator') {
    screen = (
      <AdminHomeScreen
        name={user.name}
        onSignOut={actions.signOut}
        onOpenSettings={actions.openSettings}
      />
    );
  } else {
    switch (view.name) {
      case 'onboarding':
        screen = <OnboardingContainer />;
        break;
      case 'dashboard':
        screen = <DashboardContainer />;
        break;
      case 'modules':
        screen = <ModulesContainer />;
        break;
      case 'badges':
        screen = <BadgesContainer />;
        break;
      case 'final':
        screen = <FinalAssessmentContainer />;
        break;
      case 'module':
        screen = (
          <ModulePlayerContainer key={view.moduleId} moduleId={view.moduleId} stage={view.stage} />
        );
        break;
      case 'quiz':
        screen = (
          <QuizContainer
            target={view.target}
            resume={resume}
            onDone={(passed) => {
              dispatch({ type: 'quizDone', passed });
            }}
          />
        );
        break;
    }
  }

  const closeAchievements = useCallback(() => {
    setPending(null);
    window.setTimeout(focusHeading, 0);
  }, []);
  const showAchievements = view.name === 'dashboard' && pending !== null;

  return (
    <WorkspaceContext.Provider value={actions}>
      {screen}
      <DisplaySettingsDialog
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
        }}
      />
      <AchievementDialog
        open={showAchievements}
        badge={
          pending?.badge
            ? {
                id: pending.badge.id,
                name: pending.badge.name,
                motif: pending.badge.motif,
                moduleTitle: '',
                earned: true,
              }
            : undefined
        }
        levelUp={pending?.levelUp}
        trainingComplete={pending?.trainingComplete}
        onClose={closeAchievements}
      />
      <ToastRegion
        toasts={toasts}
        onDismiss={(id) => {
          setToasts((t) => t.filter((x) => x.id !== id));
        }}
      />
    </WorkspaceContext.Provider>
  );
}
