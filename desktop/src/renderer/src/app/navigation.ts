/**
 * Workspace navigation (plan 7.1): a pure reducer over a small `View` union, no router library.
 * The renderer never decides access; locked modules are refused by the server and, as a courtesy,
 * here (a deep link to a locked or unknown module goes to the dashboard).
 */
import type { QuizTarget } from './learning/quizTarget';

export type ModuleStageName = 'lesson' | 'practice' | 'quiz';

export type View =
  | { name: 'onboarding' }
  | { name: 'dashboard' }
  | { name: 'modules' }
  | { name: 'badges' }
  | { name: 'final' }
  | { name: 'module'; moduleId: string; stage: ModuleStageName }
  | { name: 'quiz'; target: QuizTarget; returnTo: View };

export type NavAction =
  | { type: 'nav'; navId: string }
  | { type: 'openModule'; moduleId: string }
  | { type: 'setStage'; stage: ModuleStageName }
  | { type: 'startQuiz'; target: QuizTarget; returnTo: View }
  /** A `navigate` event from main (notification click). */
  | { type: 'home'; lockdownActive: boolean }
  | { type: 'deepLink'; moduleId: string; openable: boolean }
  | { type: 'quizDone'; passed: boolean }
  | { type: 'onboardingDone'; openModuleId: string | null };

export const NAV_IDS = ['dashboard', 'modules', 'badges', 'final'] as const;

export function initialView(opts: {
  resumeTarget: QuizTarget | null;
  onboardingRequired: boolean;
}): View {
  if (opts.resumeTarget) {
    // A session main still holds goes straight back to the quiz; leaving it returns to the dashboard.
    return { name: 'quiz', target: opts.resumeTarget, returnTo: { name: 'dashboard' } };
  }
  return opts.onboardingRequired ? { name: 'onboarding' } : { name: 'dashboard' };
}

export function reduceView(view: View, action: NavAction): View {
  switch (action.type) {
    case 'nav':
      return (NAV_IDS as readonly string[]).includes(action.navId)
        ? ({ name: action.navId } as View)
        : view;
    case 'openModule':
      return { name: 'module', moduleId: action.moduleId, stage: 'lesson' };
    case 'setStage':
      return view.name === 'module' ? { ...view, stage: action.stage } : view;
    case 'startQuiz':
      return { name: 'quiz', target: action.target, returnTo: action.returnTo };
    case 'home':
      // A notification click never pulls the user out of a running quiz, or out of onboarding.
      if (action.lockdownActive || view.name === 'quiz' || view.name === 'onboarding') return view;
      return { name: 'dashboard' };
    case 'deepLink':
      if (view.name === 'quiz' || view.name === 'onboarding') return view;
      return action.openable
        ? { name: 'module', moduleId: action.moduleId, stage: 'lesson' }
        : { name: 'dashboard' };
    case 'quizDone':
      if (view.name !== 'quiz') return view;
      return action.passed ? { name: 'dashboard' } : view.returnTo;
    case 'onboardingDone':
      return action.openModuleId
        ? { name: 'module', moduleId: action.openModuleId, stage: 'lesson' }
        : { name: 'dashboard' };
  }
}

/** The AppShell nav item that stays highlighted for a view. */
export function navIdFor(view: View): (typeof NAV_IDS)[number] {
  switch (view.name) {
    case 'modules':
    case 'module':
      return 'modules';
    case 'badges':
      return 'badges';
    case 'final':
      return 'final';
    default:
      return 'dashboard';
  }
}
