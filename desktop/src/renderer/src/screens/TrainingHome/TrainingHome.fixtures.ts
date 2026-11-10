import type { TrainingHomeProps } from './TrainingHome.types';

const placeholder = (): void => undefined;

export const trainingHomeFixture: TrainingHomeProps = {
  userName: 'Amina Benali',
  role: 'employee',
  level: 'Aware',
  state: 'ready',
  modules: [
    { id: 'm1', order: 1, title: 'Spotting phishing', status: 'completed', bestScore: 90 },
    {
      id: 'm2',
      order: 2,
      title: 'Strong passwords',
      status: 'in_progress',
      quizAvailable: true,
    },
    {
      id: 'm3',
      order: 3,
      title: 'Safe browsing',
      status: 'locked',
      lockedReason: 'Pass the Module 2 quiz first',
    },
  ],
  finalTest: {
    status: 'locked',
    title: 'Final assessment',
    available: false,
    note: 'Pass 5 more modules to unlock.',
  },
  onStartQuiz: placeholder,
  onStartFinal: placeholder,
  onRetry: placeholder,
  onSignOut: placeholder,
  appVersion: '0.1.0',
};

export const trainingHomeOfflineFixture: TrainingHomeProps = {
  ...trainingHomeFixture,
  notice: {
    tone: 'caution',
    text: 'You are working offline. CSense will lock again when it reconnects.',
  },
};

export const trainingHomeErrorFixture: TrainingHomeProps = {
  ...trainingHomeFixture,
  state: 'error',
  modules: [],
};

export const trainingHomeAdminFixture: TrainingHomeProps = {
  ...trainingHomeFixture,
  userName: 'Ada Admin',
  role: 'administrator',
  level: undefined,
  modules: [],
  finalTest: undefined,
};
