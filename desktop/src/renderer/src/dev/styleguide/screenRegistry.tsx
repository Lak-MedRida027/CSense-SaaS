import type { ReactNode } from 'react';
import {
  AdminDashboardScreen,
  EmployeeDashboardScreen,
  LoginScreen,
  ModulePlayerScreen,
  OnboardingScreen,
  QuizScreen,
  GateBootScreen,
  GateMisconfiguredScreen,
  GateOfflineScreen,
  SecurityGateScreen,
  ModulesScreen,
  BadgesScreen,
  FinalAssessmentScreen,
  AdminHomeScreen,
} from '../../screens';
import * as admin from '../../screens/AdminDashboard/AdminDashboard.fixtures';
import * as employee from '../../screens/EmployeeDashboard/EmployeeDashboard.fixtures';
import * as login from '../../screens/Login/Login.fixtures';
import * as player from '../../screens/ModulePlayer/ModulePlayer.fixtures';
import * as onboarding from '../../screens/Onboarding/Onboarding.fixtures';
import * as quiz from '../../screens/Quiz/Quiz.fixtures';
import * as gateStates from '../../screens/SecurityGate/GateStates.fixtures';
import * as gate from '../../screens/SecurityGate/SecurityGate.fixtures';
import * as modulesFx from '../../screens/Modules/Modules.fixtures';
import * as badgesFx from '../../screens/Badges/Badges.fixtures';
import * as finalFx from '../../screens/FinalAssessment/FinalAssessment.fixtures';

export interface ScreenVariant {
  id: string;
  label: string;
  render: () => ReactNode;
}

export interface ScreenEntry {
  id: string;
  label: string;
  variants: readonly ScreenVariant[];
}

/** Every core screen with its fixture variants. The a11y e2e iterates this list. */
export const SCREENS: readonly ScreenEntry[] = [
  {
    id: 'security-gate',
    label: 'Security gate',
    variants: [
      {
        id: 'challenge',
        label: 'Challenge',
        render: () => <SecurityGateScreen {...gate.securityGateChallengeFixture} />,
      },
      {
        id: 'retry',
        label: 'Wrong answer, last attempt',
        render: () => <SecurityGateScreen {...gate.securityGateRetryFixture} />,
      },
      {
        id: 'granted',
        label: 'Access granted',
        render: () => <SecurityGateScreen {...gate.securityGateGrantedFixture} />,
      },
      {
        id: 'restricted',
        label: 'Restricted',
        render: () => <SecurityGateScreen {...gate.securityGateRestrictedFixture} />,
      },
      {
        id: 'offline',
        label: 'Offline, retrying',
        render: () => <GateOfflineScreen {...gateStates.gateOfflineFixture} />,
      },
      {
        id: 'offline-continue',
        label: 'Offline, grace elapsed',
        render: () => <GateOfflineScreen {...gateStates.gateOfflineGraceElapsedFixture} />,
      },
      {
        id: 'misconfigured',
        label: 'Misconfigured',
        render: () => <GateMisconfiguredScreen appVersion="0.1.0" />,
      },
      {
        id: 'checking',
        label: 'Checking access',
        render: () => <GateBootScreen appVersion="0.1.0" />,
      },
    ],
  },
  {
    id: 'login',
    label: 'Login',
    variants: [
      { id: 'idle', label: 'Idle', render: () => <LoginScreen {...login.loginIdleFixture} /> },
      { id: 'error', label: 'Error', render: () => <LoginScreen {...login.loginErrorFixture} /> },
      {
        id: 'submitting',
        label: 'Submitting',
        render: () => <LoginScreen {...login.loginSubmittingFixture} />,
      },
    ],
  },
  {
    id: 'onboarding',
    label: 'Onboarding',
    variants: [
      {
        id: 'default',
        label: 'Guided intro',
        render: () => <OnboardingScreen {...onboarding.onboardingFixture} />,
      },
    ],
  },
  {
    id: 'module-player',
    label: 'Module player',
    variants: [
      {
        id: 'video',
        label: 'Video',
        render: () => <ModulePlayerScreen {...player.modulePlayerVideoFixture} />,
      },
      {
        id: 'interactive',
        label: 'Interactive',
        render: () => <ModulePlayerScreen {...player.modulePlayerInteractiveFixture} />,
      },
      {
        id: 'video-ready',
        label: 'Video, can continue',
        render: () => <ModulePlayerScreen {...player.modulePlayerVideoReadyFixture} />,
      },
      {
        id: 'video-unavailable',
        label: 'Video unavailable, transcript',
        render: () => <ModulePlayerScreen {...player.modulePlayerVideoUnavailableFixture} />,
      },
      {
        id: 'interactive-lesson',
        label: 'Interactive lesson',
        render: () => <ModulePlayerScreen {...player.modulePlayerInteractiveLessonFixture} />,
      },
      {
        id: 'practice-wrong',
        label: 'Practice, wrong answer',
        render: () => <ModulePlayerScreen {...player.modulePlayerInteractiveWrongFixture} />,
      },
      {
        id: 'practice-pending',
        label: 'Practice, saving',
        render: () => <ModulePlayerScreen {...player.modulePlayerInteractivePendingFixture} />,
      },
      {
        id: 'completed',
        label: 'Completed module',
        render: () => <ModulePlayerScreen {...player.modulePlayerCompletedFixture} />,
      },
      {
        id: 'loading',
        label: 'Loading',
        render: () => <ModulePlayerScreen {...player.modulePlayerLoadingFixture} />,
      },
      {
        id: 'error',
        label: 'Error',
        render: () => <ModulePlayerScreen {...player.modulePlayerErrorFixture} />,
      },
      {
        id: 'locked',
        label: 'Locked',
        render: () => <ModulePlayerScreen {...player.modulePlayerLockedFixture} />,
      },
      {
        id: 'not-found',
        label: 'Not found',
        render: () => <ModulePlayerScreen {...player.modulePlayerNotFoundFixture} />,
      },
    ],
  },
  {
    id: 'quiz',
    label: 'Quiz',
    variants: [
      { id: 'intro', label: 'Intro', render: () => <QuizScreen {...quiz.quizIntroFixture} /> },
      {
        id: 'entering',
        label: 'Entering lockdown',
        render: () => <QuizScreen {...quiz.quizEnteringFixture} />,
      },
      {
        id: 'active',
        label: 'Lockdown active',
        render: () => <QuizScreen {...quiz.quizActiveFixture} />,
      },
      {
        id: 'focus-warning',
        label: 'Lockdown active, focus-loss warning',
        render: () => (
          <QuizScreen
            {...quiz.quizActiveFixture}
            lockdownWarning="You left secure mode. Leaving 2 more times ends this attempt."
          />
        ),
      },
      {
        id: 'confirm',
        label: 'Review and submit',
        render: () => <QuizScreen {...quiz.quizConfirmSubmitFixture} />,
      },
      { id: 'passed', label: 'Passed', render: () => <QuizScreen {...quiz.quizPassedFixture} /> },
      {
        id: 'failed',
        label: 'Not passed',
        render: () => <QuizScreen {...quiz.quizFailedFixture} />,
      },
      {
        id: 'review',
        label: 'Answer review',
        render: () => <QuizScreen {...quiz.quizReviewFixture} />,
      },
      {
        id: 'final',
        label: 'Final assessment',
        render: () => <QuizScreen {...quiz.finalAssessmentFixture} />,
      },
      {
        id: 'intro-blocked',
        label: 'Intro, cannot start',
        render: () => <QuizScreen {...quiz.quizIntroBlockedFixture} />,
      },
      {
        id: 'failed-review',
        label: 'Not passed, review available',
        render: () => <QuizScreen {...quiz.quizFailedWithReviewFixture} />,
      },
      {
        id: 'review-no-key',
        label: 'Review without answer key',
        render: () => <QuizScreen {...quiz.quizReviewNoKeyFixture} />,
      },
    ],
  },
  {
    id: 'employee-dashboard',
    label: 'Employee dashboard',
    variants: [
      {
        id: 'default',
        label: 'In progress',
        render: () => <EmployeeDashboardScreen {...employee.employeeDashboardFixture} />,
      },
      {
        id: 'first-run',
        label: 'First run',
        render: () => <EmployeeDashboardScreen {...employee.employeeDashboardFirstRunFixture} />,
      },
      {
        id: 'loading',
        label: 'Loading',
        render: () => <EmployeeDashboardScreen {...employee.employeeDashboardLoadingFixture} />,
      },
      {
        id: 'empty',
        label: 'Empty',
        render: () => <EmployeeDashboardScreen {...employee.employeeDashboardEmptyFixture} />,
      },
      {
        id: 'offline',
        label: 'Offline error',
        render: () => <EmployeeDashboardScreen {...employee.employeeDashboardOfflineFixture} />,
      },
      {
        id: 'complete',
        label: 'Training complete',
        render: () => <EmployeeDashboardScreen {...employee.employeeDashboardCompleteFixture} />,
      },
    ],
  },
  {
    id: 'admin-dashboard',
    label: 'Admin dashboard',
    variants: [
      {
        id: 'default',
        label: 'Overview',
        render: () => <AdminDashboardScreen {...admin.adminDashboardFixture} />,
      },
      {
        id: 'loading',
        label: 'Loading',
        render: () => <AdminDashboardScreen {...admin.adminDashboardLoadingFixture} />,
      },
      {
        id: 'phishing-flag',
        label: 'Phishing flag on',
        render: () => <AdminDashboardScreen {...admin.adminDashboardPhishingFlagFixture} />,
      },
    ],
  },
  {
    id: 'modules',
    label: 'Modules page',
    variants: [
      {
        id: 'default',
        label: 'Modules',
        render: () => <ModulesScreen {...modulesFx.modulesFixture} />,
      },
      {
        id: 'loading',
        label: 'Loading',
        render: () => <ModulesScreen {...modulesFx.modulesLoadingFixture} />,
      },
      {
        id: 'empty',
        label: 'Empty',
        render: () => <ModulesScreen {...modulesFx.modulesEmptyFixture} />,
      },
      {
        id: 'error',
        label: 'Offline error',
        render: () => <ModulesScreen {...modulesFx.modulesErrorFixture} />,
      },
    ],
  },
  {
    id: 'badges',
    label: 'Badges page',
    variants: [
      {
        id: 'default',
        label: 'Badges',
        render: () => <BadgesScreen {...badgesFx.badgesFixture} />,
      },
      {
        id: 'loading',
        label: 'Loading',
        render: () => <BadgesScreen {...badgesFx.badgesLoadingFixture} />,
      },
      {
        id: 'empty',
        label: 'Empty',
        render: () => <BadgesScreen {...badgesFx.badgesEmptyFixture} />,
      },
      {
        id: 'error',
        label: 'Error',
        render: () => <BadgesScreen {...badgesFx.badgesErrorFixture} />,
      },
    ],
  },
  {
    id: 'final-assessment',
    label: 'Final assessment entry',
    variants: [
      {
        id: 'locked',
        label: 'Locked',
        render: () => <FinalAssessmentScreen {...finalFx.finalLockedFixture} />,
      },
      {
        id: 'available',
        label: 'Available',
        render: () => <FinalAssessmentScreen {...finalFx.finalAvailableFixture} />,
      },
      {
        id: 'cooldown',
        label: 'Cooldown',
        render: () => <FinalAssessmentScreen {...finalFx.finalCooldownFixture} />,
      },
      {
        id: 'completed',
        label: 'Completed',
        render: () => <FinalAssessmentScreen {...finalFx.finalCompletedFixture} />,
      },
      {
        id: 'none',
        label: 'Not configured',
        render: () => <FinalAssessmentScreen {...finalFx.finalNoneFixture} />,
      },
      {
        id: 'loading',
        label: 'Loading',
        render: () => <FinalAssessmentScreen {...finalFx.finalLoadingFixture} />,
      },
      {
        id: 'error',
        label: 'Error',
        render: () => <FinalAssessmentScreen {...finalFx.finalErrorFixture} />,
      },
    ],
  },
  {
    id: 'admin-home',
    label: 'Administrator home',
    variants: [
      {
        id: 'default',
        label: 'Placeholder',
        render: () => <AdminHomeScreen name="Sam Admin" onSignOut={() => undefined} />,
      },
    ],
  },
];
