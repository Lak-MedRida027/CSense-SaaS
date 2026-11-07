import { Types } from 'mongoose';
import type { AttemptFact, XpFacts, ModuleXpFacts, AttemptEndReason } from '@csense/shared';
import { QuizAttempt, UserProgress } from '../../models/index.js';

interface AttemptRow {
  _id: Types.ObjectId;
  type: 'Quiz' | 'FinalTest';
  refId: Types.ObjectId;
  moduleId?: Types.ObjectId | null | undefined;
  attemptNumber: number;
  endReason: AttemptEndReason;
  score: number;
  passed: boolean;
  attemptedAt: Date;
}

const MAX_ATTEMPTS = 5000;

const toFact = (a: AttemptRow): AttemptFact => ({
  attemptId: a._id.toHexString(),
  attemptNumber: a.attemptNumber,
  endReason: a.endReason,
  score: a.score,
  passed: a.passed,
});

/** Order attempts by attempt number, then by time, then by id: the first is the "first attempt". */
const byOrder = (a: AttemptRow, b: AttemptRow): number =>
  a.attemptNumber - b.attemptNumber ||
  a.attemptedAt.getTime() - b.attemptedAt.getTime() ||
  a._id.toHexString().localeCompare(b._id.toHexString());

/**
 * Build the XP facts from the append-only history (ADR 0009). Facts only grow, so recomputing from
 * them at any time converges on the same answer. Passes on modules that are no longer published
 * still count (ADR 0006).
 */
export async function loadXpFacts(userId: string): Promise<XpFacts> {
  const owner = new Types.ObjectId(userId);
  const [rows, progress] = await Promise.all([
    QuizAttempt.find({ userId: owner })
      .select('type refId moduleId attemptNumber endReason score passed attemptedAt')
      .limit(MAX_ATTEMPTS)
      .lean<AttemptRow[]>(),
    UserProgress.find({ userId: owner }).select('moduleId exerciseAnswers').lean(),
  ]);

  const byModule = new Map<string, AttemptRow[]>();
  const finals: AttemptRow[] = [];
  for (const row of rows) {
    if (row.type === 'FinalTest') finals.push(row);
    else if (row.moduleId) {
      const key = row.moduleId.toHexString();
      const list = byModule.get(key);
      if (list) list.push(row);
      else byModule.set(key, [row]);
    }
  }

  const practice = new Map<string, number>(
    progress.map((p): [string, number] => [
      p.moduleId.toHexString(),
      p.exerciseAnswers.filter((a) => a.correct).length,
    ]),
  );

  const modules: ModuleXpFacts[] = [...byModule].map(([moduleId, list]) => {
    const sorted = [...list].sort(byOrder);
    const passing = sorted.find((a) => a.passed && a.endReason === 'submitted') ?? null;
    const first = sorted[0];
    return {
      moduleId,
      firstAttempt: first ? toFact(first) : null,
      passingAttempt: passing ? toFact(passing) : null,
      practiceFirstTryCorrect: practice.get(moduleId) ?? 0,
    };
  });

  const sortedFinals = [...finals].sort(byOrder);
  const finalPass = sortedFinals.find((a) => a.passed && a.endReason === 'submitted') ?? null;
  const finalFirst = sortedFinals[0];
  return {
    modules,
    finalTest: finalFirst
      ? {
          firstAttempt: toFact(finalFirst),
          passingAttempt: finalPass ? toFact(finalPass) : null,
        }
      : null,
  };
}
