/** What the quiz flow needs to know about the assessment it is about to start (plan 7.5). */
export type QuizTarget =
  | {
      kind: 'quiz';
      moduleId: string;
      title: string;
      questionCount: number;
      passingScore: number;
      attemptNumber: number;
      /** Set when a new session cannot start now (cooldown, already passed); the intro says why. */
      startBlocked?: { reason: string } | undefined;
    }
  | {
      kind: 'final';
      title: string;
      questionCount: number;
      passingScore: number;
      attemptNumber: number;
      startBlocked?: { reason: string } | undefined;
    };
