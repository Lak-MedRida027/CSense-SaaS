import type { AttemptEndReason } from '../constants/learning.js';

export interface RevealPolicy {
  showCorrectness: boolean;
  showExplanation: boolean;
  showCorrectOption: boolean;
}

/**
 * What a review may disclose (D3-13). A submitted attempt shows right/wrong and the explanation;
 * the correct option is shown only once the assessment has been passed. Abandoned and expired
 * attempts have nothing to review.
 */
export function revealPolicy(
  attempt: { endReason: AttemptEndReason; passed: boolean },
  assessmentPassed: boolean,
): RevealPolicy {
  if (attempt.endReason !== 'submitted') {
    return { showCorrectness: false, showExplanation: false, showCorrectOption: false };
  }
  return {
    showCorrectness: true,
    showExplanation: true,
    showCorrectOption: assessmentPassed || attempt.passed,
  };
}
