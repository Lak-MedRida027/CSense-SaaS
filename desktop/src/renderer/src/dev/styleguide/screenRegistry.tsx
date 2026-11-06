import type { ReactNode } from 'react';
import {
  AdminDashboardScreen,
  EmployeeDashboardScreen,
  LoginScreen,
  ModulePlayerScreen,
  OnboardingScreen,
  QuizScreen,
  SecurityGateScreen,
} from '../../screens';
import * as admin from '../../screens/AdminDashboard/AdminDashboard.fixtures';
import * as employee from '../../screens/EmployeeDashboard/EmployeeDashboard.fixtures';
import * as login from '../../screens/Login/Login.fixtures';
import * as player from '../../screens/ModulePlayer/ModulePlayer.fixtures';
import * as onboarding from '../../screens/Onboarding/Onboarding.fixtures';
import * as quiz from '../../screens/Quiz/Quiz.fixtures';
import * as gate from '../../screens/SecurityGate/SecurityGate.fixtures';

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
];
