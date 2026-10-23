import type { AssessmentKind } from '../constants/assessment.js';

/** Question as shown to an employee: no answer key. */
export interface QuestionDTO {
  questionId: string;
  text: string;
  options: string[];
}

/** Question as managed by an administrator. `correctAnswer` is an index into `options` (U10). */
export interface QuestionWithAnswerDTO extends QuestionDTO {
  correctAnswer: number;
}

/** Abstract Assessment (Class UML); `kind` is the discriminator (U2). */
export interface AssessmentDTO<Q extends QuestionDTO = QuestionDTO> {
  id: string;
  kind: AssessmentKind;
  title: string;
  questions: Q[];
  /** Integer percent 0-100. */
  passingScore: number;
  updatedAt: string;
}

export interface QuizDTO<Q extends QuestionDTO = QuestionDTO> extends AssessmentDTO<Q> {
  kind: 'Quiz';
  moduleId: string;
}

export interface FinalTestDTO<Q extends QuestionDTO = QuestionDTO> extends AssessmentDTO<Q> {
  kind: 'FinalTest';
}

/** One answer inside a QuizAttempt (U3). */
export interface AnswerDTO {
  questionId: string;
  selectedIndex: number;
  correct: boolean;
}

export interface QuizAttemptDTO {
  id: string;
  userId: string;
  type: AssessmentKind;
  refId: string;
  answers: AnswerDTO[];
  score: number;
  passed: boolean;
  attemptedAt: string;
}
