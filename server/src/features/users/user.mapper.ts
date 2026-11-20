import type { AdministratorDTO, EmployeeDTO, Level, OnboardingOutcome, Role } from '@csense/shared';

interface UserLike {
  _id: { toHexString(): string };
  name: string;
  email: string;
  role: Role;
  department?: string | null | undefined;
  isActive: boolean;
  createdBy?: { toHexString(): string } | null | undefined;
  createdAt: Date;
  totalXP?: number | null | undefined;
  level?: Level | null | undefined;
  onboarding?: { outcome: OnboardingOutcome; at: Date } | null | undefined;
}

/** Explicit allow-list mapping: passwordHash and any unknown field can never leak. */
export function toUserDTO(user: UserLike): EmployeeDTO | AdministratorDTO {
  const base = {
    id: user._id.toHexString(),
    name: user.name,
    email: user.email,
    ...(user.department ? { department: user.department } : {}),
    isActive: user.isActive,
    createdBy: user.createdBy ? user.createdBy.toHexString() : null,
    createdAt: user.createdAt.toISOString(),
  };
  if (user.role === 'employee') {
    return {
      ...base,
      role: 'employee',
      totalXP: user.totalXP ?? 0,
      level: user.level ?? 'Apprentice',
      onboarding: user.onboarding
        ? { outcome: user.onboarding.outcome, at: user.onboarding.at.toISOString() }
        : null,
    };
  }
  return { ...base, role: 'administrator' };
}
