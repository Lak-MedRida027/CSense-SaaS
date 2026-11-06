import { DEFAULT_PASSING_SCORE } from '@csense/shared';
import type { QuizQuestionData, QuizScreenProps } from './Quiz.types';
import { fixtureBadges, placeholder } from '../shared.fixtures';

const questions: readonly QuizQuestionData[] = [
  {
    id: 'q1',
    stem: 'Which sign most strongly suggests an email is phishing?',
    options: [
      { id: 'a', text: "The sender's display name matches a colleague" },
      { id: 'b', text: "The link text and the link's real address don't match" },
      { id: 'c', text: 'It was sent during working hours' },
      { id: 'd', text: 'It has your company logo in the signature' },
    ],
    correctOptionId: 'b',
    explanation: 'Attackers disguise malicious links behind trustworthy text. Hover to check.',
  },
  {
    id: 'q2',
    stem: 'An email asks you to urgently buy gift cards for the CEO. What do you do?',
    options: [
      { id: 'a', text: 'Buy them quickly; the CEO is busy' },
      { id: 'b', text: 'Reply to ask if it is genuine' },
      { id: 'c', text: 'Verify through a known phone number and report it' },
    ],
    correctOptionId: 'c',
    explanation: 'Verify using a channel you already trust, never the one in the message.',
  },
  {
    id: 'q3',
    stem: 'What should you do after clicking a suspicious link by mistake?',
    options: [
      { id: 'a', text: 'Nothing, if the page looked normal' },
      { id: 'b', text: 'Report it to the security team immediately' },
      { id: 'c', text: 'Clear your browser history' },
    ],
    correctOptionId: 'b',
    explanation: 'Fast reporting limits damage. You will not be blamed for reporting.',
  },
  {
    id: 'q4',
    stem: 'Which attachment type is the riskiest to open from an unknown sender?',
    options: [
      { id: 'a', text: 'invoice.pdf.exe' },
      { id: 'b', text: 'agenda.txt' },
      { id: 'c', text: 'photo.jpg' },
    ],
    correctOptionId: 'a',
    explanation: 'Double extensions hide executables. Never run unexpected attachments.',
  },
  {
    id: 'q5',
    stem: 'Where is the safest place to check an account alert you received by email?',
    options: [
      { id: 'a', text: 'The link in the email' },
      { id: 'b', text: 'The official website, typed into the browser yourself' },
      { id: 'c', text: 'A search engine ad' },
    ],
    correctOptionId: 'b',
    explanation: 'Typing the address yourself avoids look-alike domains.',
  },
];

const callbacks = {
  onRequestStartLockdown: placeholder,
  onAnswer: placeholder,
  onNavigate: placeholder,
  onRequestSubmitReview: placeholder,
  onBackToQuestions: placeholder,
  onSubmit: placeholder,
  onConfirmExit: placeholder,
  onReviewAnswers: placeholder,
  onBackToResult: placeholder,
  onRetry: placeholder,
  onContinue: placeholder,
  onBackToModule: placeholder,
};

export const quizIntroFixture: QuizScreenProps = {
  ...callbacks,
  kind: 'module',
  title: 'Module 3 quiz: Phishing',
  phase: 'intro',
  lockdownState: 'entering',
  questions,
  answers: {},
  currentIndex: 0,
  passMarkPercent: DEFAULT_PASSING_SCORE,
};

export const quizActiveFixture: QuizScreenProps = {
  ...quizIntroFixture,
  phase: 'answering',
  lockdownState: 'active',
  currentIndex: 1,
  answers: { q1: 'b', q2: 'c' },
};

export const quizEnteringFixture: QuizScreenProps = {
  ...quizActiveFixture,
  lockdownState: 'entering',
};

export const quizConfirmSubmitFixture: QuizScreenProps = {
  ...quizActiveFixture,
  phase: 'confirm-submit',
  answers: { q1: 'b', q2: 'c', q3: 'b', q5: 'a' },
};

export const quizPassedFixture: QuizScreenProps = {
  ...quizActiveFixture,
  phase: 'result',
  lockdownState: 'exiting',
  answers: { q1: 'b', q2: 'c', q3: 'b', q4: 'a', q5: 'a' },
  result: {
    scorePercent: 80,
    passed: true,
    correctCount: 4,
    totalCount: 5,
    xpEarned: 150,
    badge: fixtureBadges[2],
  },
  continueLabel: 'Continue to Module 4',
};

export const quizFailedFixture: QuizScreenProps = {
  ...quizPassedFixture,
  answers: { q1: 'a', q2: 'c', q3: 'b', q4: 'c', q5: 'a' },
  result: { scorePercent: 40, passed: false, correctCount: 2, totalCount: 5 },
};

export const quizReviewFixture: QuizScreenProps = {
  ...quizFailedFixture,
  phase: 'review',
};

export const finalAssessmentFixture: QuizScreenProps = {
  ...quizActiveFixture,
  kind: 'final',
  title: 'Final assessment',
  questions: Array.from({ length: 15 }, (_, i) => {
    const q = questions[i % questions.length] ?? questions[0];
    return { ...(q as QuizQuestionData), id: `f${i + 1}` };
  }),
  currentIndex: 3,
  answers: { f1: 'b', f2: 'c', f3: 'b' },
};
