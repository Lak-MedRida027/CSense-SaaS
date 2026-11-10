import { Types } from 'mongoose';
import { formatGateReference, type GateRunStatus, type GateStatusDTO } from '@csense/shared';

/** A gate run as read with `.lean()`. The key snapshot is present only after an explicit select. */
export interface GateRunRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  status: GateRunStatus;
  maxAttempts: number;
  attemptsUsed: number;
  current?: {
    challengeId: Types.ObjectId;
    questionId: Types.ObjectId;
    prompt: string;
    options: string[];
    optionCount: number;
    correctAnswer?: number;
    servedAt: Date;
  } | null;
  servedQuestionIds: Types.ObjectId[];
  firstAnswerCorrect?: boolean | null;
  openedAt: Date;
  closedAt?: Date | null;
  clearedUntil?: Date | null;
  escalationId?: Types.ObjectId | null;
  restoredAt?: Date | null;
  restoredBy?: Types.ObjectId | null;
  version: number;
}

export interface GateQuestionView {
  prompt: string;
  options: string[];
}

export const requiredStatus = (maxAttempts: number): GateStatusDTO => ({
  state: 'required',
  maxAttempts,
  attemptsRemaining: maxAttempts,
  challenge: null,
  clearedUntil: null,
  restricted: null,
});

export const challengeStatus = (
  run: Pick<GateRunRow, 'maxAttempts' | 'attemptsUsed'>,
  challengeId: Types.ObjectId,
  question: GateQuestionView,
): GateStatusDTO => ({
  state: 'challenge',
  maxAttempts: run.maxAttempts,
  attemptsRemaining: Math.max(0, run.maxAttempts - run.attemptsUsed),
  challenge: {
    challengeId: challengeId.toHexString(),
    prompt: question.prompt,
    options: [...question.options],
  },
  clearedUntil: null,
  restricted: null,
});

export const grantedStatus = (
  run: Pick<GateRunRow, 'maxAttempts'>,
  until: Date,
): GateStatusDTO => ({
  state: 'granted',
  maxAttempts: run.maxAttempts,
  attemptsRemaining: run.maxAttempts,
  challenge: null,
  clearedUntil: until.toISOString(),
  restricted: null,
});

export const restrictedStatus = (
  run: Pick<GateRunRow, '_id' | 'maxAttempts' | 'closedAt' | 'openedAt'>,
  timeZone: string,
): GateStatusDTO => {
  const since = run.closedAt ?? run.openedAt;
  return {
    state: 'restricted',
    maxAttempts: run.maxAttempts,
    attemptsRemaining: 0,
    challenge: null,
    clearedUntil: null,
    restricted: {
      referenceId: formatGateReference(run._id.toHexString(), since, timeZone),
      since: since.toISOString(),
    },
  };
};
