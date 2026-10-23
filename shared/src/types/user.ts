import type { Level } from '../constants/levels.js';
import type { Role } from '../constants/roles.js';

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
}

export interface AdministratorDTO extends UserDTO {
  role: 'administrator';
}
