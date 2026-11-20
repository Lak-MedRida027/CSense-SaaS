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
  onSelectModule: placeholder,
  onBackToDashboard: placeholder,
  onExerciseAnswer: placeholder,
  onExerciseNext: placeholder,
  onLessonAction: placeholder,
  onSelectStage: placeholder,
  onRetry: placeholder,
};

const sidebarAtModule3 = fixtureModuleList.map((m) =>
  m.order === 3
    ? { ...m, status: 'in_progress' as const }
    : m.order > 3
      ? { ...m, status: 'locked' as const, lockedReason: lockedReasonFor(m.order) }
      : m,
);

const lessonBody =
  'Phishing is the most common way attackers get in. A message pretends to come from someone you trust and asks you to act quickly.\n\nCheck the real sender address and hover over links before you click. When unsure, report the message instead of acting on it.';

const video = {
  state: 'ready' as const,
  transcript: [
    { id: 'c1', startSeconds: 0, text: 'Phishing is the most common way attackers get in.' },
    { id: 'c2', startSeconds: 14, text: 'Check the sender address, not just the display name.' },
    { id: 'c3', startSeconds: 31, text: 'Hover over links to see where they really go.' },
  ],
};

const takeaways = [
  'Check the real sender address, not the display name.',
  'Hover to preview links; never trust link text alone.',
  'Report, do not reply. Use the Report Phishing button.',
];

/** Video lesson, quiz action disabled until the video is watched or the transcript read. */
export const modulePlayerVideoFixture: ModulePlayerScreenProps = {
  ...base,
  modules: sidebarAtModule3,
  module: { id: 'm3', order: 3, title: 'Phishing', format: 'video', durationMinutes: 12 },
  stage: 'lesson',
  video,
  lessonBody,
  keyTakeaways: takeaways,
  lessonAction: {
    label: 'Continue to practice',
    enabled: false,
    reason: 'Watch the video or read the transcript to continue',
  },
};

/** Video lesson, requirement met. */
export const modulePlayerVideoReadyFixture: ModulePlayerScreenProps = {
  ...modulePlayerVideoFixture,
  lessonAction: { label: 'Continue to quiz', enabled: true },
};

/** Video unavailable: the transcript opens by itself and is the lesson. */
export const modulePlayerVideoUnavailableFixture: ModulePlayerScreenProps = {
  ...modulePlayerVideoFixture,
  video: { ...video, state: 'error' },
};

/** Interactive module, lesson text first. */
export const modulePlayerInteractiveLessonFixture: ModulePlayerScreenProps = {
  ...base,
  module: {
    id: 'm4',
    order: 4,
    title: 'Social engineering',
    format: 'interactive',
    durationMinutes: 10,
  },
  stage: 'lesson',
  lessonBody,
  keyTakeaways: takeaways,
  lessonAction: { label: 'Continue to practice', enabled: true },
};

const practiceExercise = {
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
};

/** Practice, answered right: choices locked, correct option tagged, explanation shown. */
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
    ...practiceExercise,
    selectedChoiceId: 'b',
    correctChoiceId: 'b',
    feedback: {
      correct: true,
      title: 'Correct',
      explanation:
        "The domain isn't the courier's. Go to the official site directly rather than following the link.",
    },
  },
};

/** Practice, answered wrong. */
export const modulePlayerInteractiveWrongFixture: ModulePlayerScreenProps = {
  ...modulePlayerInteractiveFixture,
  exercise: {
    ...practiceExercise,
    selectedChoiceId: 'a',
    correctChoiceId: 'b',
    feedback: {
      correct: false,
      title: 'Not quite',
      explanation:
        "The domain isn't the courier's. Go to the official site directly rather than following the link.",
    },
  },
};

/** Practice, answer being saved. */
export const modulePlayerInteractivePendingFixture: ModulePlayerScreenProps = {
  ...modulePlayerInteractiveFixture,
  exercise: { ...practiceExercise, selectedChoiceId: 'b', pending: true },
};

/** Completed module: the quiz stage shows the result instead of starting a session. */
export const modulePlayerCompletedFixture: ModulePlayerScreenProps = {
  ...modulePlayerInteractiveLessonFixture,
  stage: 'quiz',
  quizSummary: { passed: true, bestScore: 80, attempts: 2 },
};

export const modulePlayerLoadingFixture: ModulePlayerScreenProps = {
  ...base,
  state: 'loading',
  stage: 'lesson',
};

export const modulePlayerErrorFixture: ModulePlayerScreenProps = {
  ...base,
  state: 'error',
  stage: 'lesson',
};

export const modulePlayerLockedFixture: ModulePlayerScreenProps = {
  ...base,
  state: 'locked',
  stage: 'lesson',
  lockedReason: 'Pass the Module 3 quiz to unlock',
};

export const modulePlayerNotFoundFixture: ModulePlayerScreenProps = {
  ...base,
  state: 'not_found',
  stage: 'lesson',
};
