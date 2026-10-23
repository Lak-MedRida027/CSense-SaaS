/** Feature flags (CLAUDE.md open question: phishing + continuous review behind flags, default off). */
export const FEATURE_FLAGS = ['phishing', 'continuousReview'] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];
export type FeatureFlags = Readonly<Record<FeatureFlag, boolean>>;
