/**
 * Enum values for string attributes the Class UML leaves untyped (decision U9, proposed values).
 */
export const PROGRESS_STATUSES = ['locked', 'unlocked', 'in_progress', 'completed'] as const;
export type ProgressStatus = (typeof PROGRESS_STATUSES)[number];

export const MODULE_FORMATS = ['video', 'interactive'] as const;
export type ModuleFormat = (typeof MODULE_FORMATS)[number];

export const PHISHING_STATUSES = ['draft', 'scheduled', 'deployed', 'completed'] as const;
export type PhishingStatus = (typeof PHISHING_STATUSES)[number];
