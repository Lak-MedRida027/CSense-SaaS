import type { Level } from '../constants/levels.js';
import type { OnboardingOutcome } from '../constants/onboarding.js';
import type { Role } from '../constants/roles.js';

/** First-run onboarding state (FR4). Mirrors `onboardingStateSchema`. */
export interface OnboardingStateDTO {
  outcome: OnboardingOutcome;
  at: string;
}

/** Public shape of a User (Class UML). `passwordHash` never leaves the server. */
export interface UserDTO {
  id: string;
  name: string;
  email: string;
  role: Role;
  department?: string;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
}

export interface EmployeeDTO extends UserDTO {
  role: 'employee';
  totalXP: number;
  level: Level;
  /** `null` until the employee has completed or skipped the onboarding (first write wins). */
  onboarding: OnboardingStateDTO | null;
}

export interface AdministratorDTO extends UserDTO {
  role: 'administrator';
}
