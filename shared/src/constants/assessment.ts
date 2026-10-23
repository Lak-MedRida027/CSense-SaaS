/** Default pass mark, as an integer percent; configurable per assessment (CLAUDE.md open question). */
export const DEFAULT_PASSING_SCORE = 70;

/** Seven sequentially locked modules is the working assumption (CLAUDE.md open question). */
export const EXPECTED_MODULE_COUNT = 7;

export const ASSESSMENT_KINDS = ['Quiz', 'FinalTest'] as const;
export type AssessmentKind = (typeof ASSESSMENT_KINDS)[number];

export const MIN_QUESTION_OPTIONS = 2;
