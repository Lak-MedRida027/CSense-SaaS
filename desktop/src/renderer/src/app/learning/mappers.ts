/**
 * Pure mappers from bridge DTOs to screen props (plan 7.6). No React, no bridge calls.
 * Authored strings stay strings here; components render them as text nodes only.
 */
import { LEVELS, type Level } from '@csense/shared';
import type {
  AttemptResultDTO,
  BadgeProgressDTO,
  FinalTestOverviewDTO,
  LearningOverviewDTO,
  ModuleSummaryDTO,
  QuizOverviewDTO,
} from '../../../../shared/dto';
import { BADGE_MOTIFS, type AchievementBadgeData } from '../../components/AchievementBadge';
import type { ModuleCardData } from '../../components/ModuleCard';
import type { ModuleListItem } from '../../components/ModuleList';
import type { QuizQuestionData } from '../../screens/Quiz';
import type { QuizTarget } from './quizTarget';

export function lockedReasonText(lockedBy: ModuleSummaryDTO['lockedBy']): string | undefined {
  return lockedBy ? `Pass the Module ${String(lockedBy.position)} quiz to unlock` : undefined;
}

export const isLevel = (v: string | undefined): v is Level => LEVELS.some((l) => l === v);

export function toModuleCardData(m: ModuleSummaryDTO, badgeName?: string): ModuleCardData {
  return {
    id: m.id,
    order: m.position,
    title: m.title,
    description: m.description,
    format: m.format,
    durationMinutes: m.durationMinutes,
    status: m.status,
    ...(m.bestScore !== null && m.passed ? { scorePercent: m.bestScore } : {}),
    ...(badgeName ? { badgeName } : {}),
  };
}

/**
 * The unlock rule of a locked module: it opens when the PREVIOUS module's quiz is passed (N1), even
 * when the server reports an earlier unpassed module as the blocker.
 */
export function lockReasonFor(m: ModuleSummaryDTO): string | undefined {
  if (!m.lockedBy) return undefined;
  const position = m.position > 1 ? m.position - 1 : m.lockedBy.position;
  return `Pass the Module ${String(position)} quiz to unlock`;
}

export function toModuleListItem(m: ModuleSummaryDTO): ModuleListItem {
  const lockedReason = lockReasonFor(m);
  return {
    id: m.id,
    order: m.position,
    title: m.title,
    status: m.status,
    ...(lockedReason ? { lockedReason } : {}),
  };
}

export function lockedReasonsById(modules: readonly ModuleSummaryDTO[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of modules) {
    const r = lockReasonFor(m);
    if (m.status === 'locked' && r) out[m.id] = r;
  }
  return out;
}

/** An `iconMotif` outside the known set falls back to a generic motif (never a broken icon). */
export const FALLBACK_MOTIF = 'trophy';
export function safeMotif(motif: string): string {
  return Object.prototype.hasOwnProperty.call(BADGE_MOTIFS, motif) ? motif : FALLBACK_MOTIF;
}

export function toBadgeData(b: BadgeProgressDTO): AchievementBadgeData {
  return {
    id: b.badgeId,
    name: b.name,
    motif: safeMotif(b.iconMotif),
    moduleTitle: b.moduleTitle,
    earned: b.earned,
    ...(b.earnedAt ? { earnedAt: b.earnedAt } : {}),
  };
}

export interface FinalCard {
  status: 'locked' | 'unlocked' | 'in_progress' | 'completed';
  lockedReason?: string;
  scorePercent?: number;
  questionCount?: number;
}

export function toFinalCard(
  finalTest: LearningOverviewDTO['finalTest'] | FinalTestOverviewDTO,
  totalModules: number,
): FinalCard {
  if (!finalTest) return { status: 'locked' };
  const done = finalTest.passed || finalTest.status === 'completed';
  const remaining = finalTest.remainingModules;
  return {
    status: done ? 'completed' : finalTest.status,
    ...(finalTest.status === 'locked'
      ? {
          lockedReason:
            remaining > 0
              ? `Pass ${String(remaining)} more module${remaining === 1 ? '' : 's'} to unlock`
              : `Unlocks after all ${String(totalModules)} modules`,
        }
      : {}),
    ...(done && finalTest.bestScore !== null ? { scorePercent: finalTest.bestScore } : {}),
    ...(finalTest.questionCount > 0 ? { questionCount: finalTest.questionCount } : {}),
  };
}

const timeFmt = (iso: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

export function startBlockedReason(q: {
  blockedReason: string | null;
  cooldownUntil: string | null;
  passed: boolean;
}): string | undefined {
  if (q.passed || q.blockedReason === 'already_passed') {
    return 'You have already passed this quiz.';
  }
  if (q.blockedReason === 'cooldown' || q.cooldownUntil) {
    const at = timeFmt(q.cooldownUntil);
    return at ? `You can try again at ${at}.` : 'You can try again a little later.';
  }
  return undefined;
}

export function toQuizTarget(q: QuizOverviewDTO, moduleOrder: number, title: string): QuizTarget {
  const reason = startBlockedReason(q);
  return {
    kind: 'quiz',
    moduleId: q.moduleId,
    title: `Module ${String(moduleOrder)} quiz: ${title}`,
    questionCount: q.questionCount,
    passingScore: q.passingScore,
    attemptNumber: q.nextAttemptNumber,
    ...(reason ? { startBlocked: { reason } } : {}),
  };
}

export function toFinalTarget(f: FinalTestOverviewDTO): QuizTarget {
  const reason = startBlockedReason(f);
  return {
    kind: 'final',
    title: f.title,
    questionCount: f.questionCount,
    passingScore: f.passingScore,
    attemptNumber: f.nextAttemptNumber,
    ...(reason ? { startBlocked: { reason } } : {}),
  };
}

export interface QuizReviewData {
  questions: QuizQuestionData[];
  /** questionId -> option id (the option index as a string) or null. */
  answers: Record<string, string | null>;
}

/**
 * Review rows from an attempt (plan 7.5). `correctOptionId` is set only when the server sent
 * `correctIndex` (after a pass, D3-13); explanations only when sent. Abandoned and expired attempts
 * come back with an empty review.
 */
export function toQuizReview(result: AttemptResultDTO): QuizReviewData {
  const answers: Record<string, string | null> = {};
  const questions = result.review.map((item): QuizQuestionData => {
    answers[item.questionId] = item.selectedIndex === null ? null : String(item.selectedIndex);
    return {
      id: item.questionId,
      stem: item.text,
      options: item.options.map((text, i) => ({ id: String(i), text })),
      wasCorrect: item.correct,
      ...(item.correctIndex !== undefined ? { correctOptionId: String(item.correctIndex) } : {}),
      ...(item.explanation !== undefined ? { explanation: item.explanation } : {}),
    };
  });
  return { questions, answers };
}
