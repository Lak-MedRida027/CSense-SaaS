import type { ModulePlayerScreenProps } from './ModulePlayer.types';
import {
  fixtureModuleList,
  fixtureModules,
  lockedReasonFor,
  placeholder,
} from '../shared.fixtures';

const total = fixtureModules.length;

const base: Omit<ModulePlayerScreenProps, 'module' | 'stage'> = {
  totalModules: total,
  modules: fixtureModuleList,
  finalAssessment: { status: 'locked', lockedReason: `Unlocks after all ${total} modules` },
  canStartQuiz: false,
  quizLockedReason: 'Finish the lesson to continue',
  onSelectModule: placeholder,
  onStartQuiz: placeholder,
  onBackToDashboard: placeholder,
  onExerciseAnswer: placeholder,
  onExerciseNext: placeholder,
};

/** Video variant. No media URL yet (engineers wire CDN URLs); the player chrome still renders. */
export const modulePlayerVideoFixture: ModulePlayerScreenProps = {
  ...base,
  modules: fixtureModuleList.map((m) =>
    m.order === 3
      ? { ...m, status: 'in_progress' as const }
      : m.order > 3
        ? { ...m, status: 'locked' as const, lockedReason: lockedReasonFor(m.order) }
        : m,
  ),
  module: { id: 'm3', order: 3, title: 'Phishing', format: 'video', durationMinutes: 12 },
  stage: 'lesson',
  video: {
    state: 'ready',
    transcript: [
      { id: 'c1', startSeconds: 0, text: 'Phishing is the most common way attackers get in.' },
      { id: 'c2', startSeconds: 14, text: 'Check the sender address, not just the display name.' },
      { id: 'c3', startSeconds: 31, text: 'Hover over links to see where they really go.' },
    ],
  },
  keyTakeaways: [
    'Check the real sender address, not the display name.',
    'Hover to preview links; never trust link text alone.',
    'Report, do not reply. Use the Report Phishing button.',
  ],
  onContinueToPractice: placeholder,
};

/** Interactive variant with immediate feedback shown. */
export const modulePlayerInteractiveFixture: ModulePlayerScreenProps = {
  ...base,
  module: {
    id: 'm4',
    order: 4,
    title: 'Social engineering',
    format: 'interactive',
    durationMinutes: 10,
  },
  stage: 'practice',
  exercise: {
    scenarioNumber: 2,
    totalScenarios: 4,
    artifact:
      'SMS from +44 7700 900123: "Your parcel is held. Pay the 1.99 fee at dhl-redelivery.co"',
    prompt: 'What should you do with this message?',
    choices: [
      { id: 'a', text: 'Tap the link and pay the small fee' },
      { id: 'b', text: 'Check the parcel on the official courier website instead' },
      { id: 'c', text: 'Reply STOP to unsubscribe' },
    ],
    selectedChoiceId: 'b',
    feedback: {
      correct: true,
      explanation:
        "The domain isn't the courier's. Go to the official site directly rather than following the link.",
    },
  },
  canStartQuiz: true,
  quizLockedReason: undefined,
};
