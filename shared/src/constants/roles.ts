/** User roles from the Class UML (User -> Employee | Administrator). */
export const ROLES = ['employee', 'administrator'] as const;
export type Role = (typeof ROLES)[number];
