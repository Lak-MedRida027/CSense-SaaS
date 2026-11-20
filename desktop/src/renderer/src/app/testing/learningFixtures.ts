import type {
  LearningOverviewDTO,
  ModuleSummaryDTO,
  MyBadgesDTO,
  QuizOverviewDTO,
  XpSummaryDTO,
} from '../../../../shared/dto';
import type { ModuleDetailView } from '../../../../shared/ipcChannels';

export const M1 = 'b'.repeat(24);
export const M2 = 'e'.repeat(24);
export const EX1 = '3'.repeat(24);
export const EX2 = '4'.repeat(24);

export const summary = (over: Partial<ModuleSummaryDTO> = {}): ModuleSummaryDTO => ({
  id: M1,
  position: 1,
  title: 'Welcome to CSense',
  description: 'What this programme is.',
  format: 'video',
  durationMinutes: 6,
  status: 'unlocked',
  lockedBy: null,
  attempts: 0,
  bestScore: null,
  passed: false,
  completedAt: null,
  ...over,
});

export const overviewDto = (over: Partial<LearningOverviewDTO> = {}): LearningOverviewDTO => ({
  modules: [
    summary(),
    summary({
      id: M2,
      position: 2,
      title: 'Passwords',
      format: 'interactive',
      status: 'locked',
      lockedBy: { moduleId: M1, position: 1, title: 'Welcome to CSense' },
    }),
  ],
  totalModules: 7,
  completedCount: 0,
  nextModuleId: M1,
  finalTest: null,
  ...over,
});

export const xpDto = (over: Partial<XpSummaryDTO> = {}): XpSummaryDTO => ({
  totalXP: 10,
  level: 'Apprentice',
  tier: 1,
  currentLevelFloorXP: 0,
  nextLevel: 'Aware',
  nextLevelXP: 300,
  xpToNextLevel: 290,
  thresholds: { Apprentice: 0, Aware: 300, Practitioner: 900, Guardian: 2000, Defender: 3500 },
  ...over,
});

export const badgesDto = (earned = 0): MyBadgesDTO => ({
  items: [
    {
      badgeId: 'ba'.repeat(12),
      name: 'First Steps',
      iconMotif: 'welcome',
      moduleId: M1,
      moduleTitle: 'Welcome to CSense',
      position: 1,
      earned: earned > 0,
      earnedAt: earned > 0 ? '2026-11-10T09:00:00.000Z' : null,
    },
    {
      badgeId: 'bb'.repeat(12),
      name: 'Odd One',
      iconMotif: 'not-a-known-motif',
      moduleId: M2,
      moduleTitle: 'Passwords',
      position: 2,
      earned: false,
      earnedAt: null,
    },
  ],
  earnedCount: earned,
  totalCount: 2,
});

export const quizDto = (over: Partial<QuizOverviewDTO> = {}): QuizOverviewDTO => ({
  quizId: 'f'.repeat(24),
  moduleId: M1,
  title: 'Quiz',
  questionCount: 5,
  passingScore: 70,
  attempts: 0,
  nextAttemptNumber: 1,
  bestScore: null,
  passed: false,
  canStart: true,
  blockedReason: null,
  cooldownUntil: null,
  ...over,
});

export const detailView = (over: Partial<ModuleDetailView> = {}): ModuleDetailView => ({
  module: summary({ status: 'in_progress' }),
  content: {
    body: 'First paragraph.\n\nSecond paragraph.',
    keyTakeaways: ['Take one'],
    video: {
      src: 'app://csense/media/placeholder-lesson.webm',
      captionsSrc: 'app://csense/media/m1.vtt',
      transcript: [
        { id: 0, startSeconds: 0, text: 'Welcome.' },
        { id: 1, startSeconds: 25, text: 'Goodbye.' },
      ],
    },
    exercises: [],
  },
  progress: {
    moduleId: M1,
    status: 'in_progress',
    startedAt: '2026-11-10T09:00:00.000Z',
    contentCompletedAt: null,
    exerciseAnswers: [],
  },
  quiz: quizDto(),
  ...over,
});

export const interactiveDetail = (): ModuleDetailView =>
  detailView({
    module: summary({
      id: M2,
      position: 2,
      format: 'interactive',
      status: 'in_progress',
      title: 'Passwords',
    }),
    content: {
      body: 'Use long passphrases.',
      keyTakeaways: [],
      video: null,
      exercises: [
        {
          exerciseId: EX1,
          prompt: 'Pick a password',
          artifact: null,
          options: ['abc', 'long passphrase here'],
        },
        {
          exerciseId: EX2,
          prompt: 'Approve a prompt?',
          artifact: 'Push: approve?',
          options: ['Yes', 'No'],
        },
      ],
    },
    progress: {
      moduleId: M2,
      status: 'in_progress',
      startedAt: '2026-11-10T09:00:00.000Z',
      contentCompletedAt: null,
      exerciseAnswers: [],
    },
    quiz: quizDto({ moduleId: M2 }),
  });
