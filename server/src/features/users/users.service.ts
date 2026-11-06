import type { AdministratorDTO, AuthContext, EmployeeDTO } from '@csense/shared';
import type { z } from 'zod';
import type { createUserRequestSchema } from '@csense/shared';
import { conflict } from '../../lib/httpError.js';
import { Administrator, Employee, User } from '../../models/index.js';
import { audit, type AuditContext } from '../audit/audit.service.js';
import { hashPassword } from '../auth/password.js';
import { toUserDTO } from './user.mapper.js';

export type CreateUserInput = z.infer<typeof createUserRequestSchema>;

const DUPLICATE_KEY = 11000;

function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { code?: unknown }).code === DUPLICATE_KEY
  );
}

/**
 * Administrator.createUser (Class UML). `createdBy` is always the calling admin, never the body.
 * Insert, then audit; if the audit write fails the new user is deleted again (no transactions
 * without a replica set) and the request fails.
 */
export async function createUser(
  deps: { bcryptCost: number },
  actor: AuthContext,
  input: CreateUserInput,
  meta: AuditContext,
): Promise<EmployeeDTO | AdministratorDTO> {
  const passwordHash = await hashPassword(input.password, deps.bcryptCost);
  const fields = {
    name: input.name,
    email: input.email,
    passwordHash,
    createdBy: actor.userId,
    ...(input.department === undefined ? {} : { department: input.department }),
  };

  let created;
  try {
    // Duplicate-key (11000) is mapped to 409 here and nowhere else.
    created =
      input.role === 'administrator'
        ? await Administrator.create(fields)
        : await Employee.create(fields);
  } catch (err) {
    if (isDuplicateKey(err)) throw conflict('An account with this email already exists');
    throw err;
  }

  try {
    await audit.record({
      action: 'user.created',
      outcome: 'success',
      severity: input.role === 'administrator' ? 'warning' : 'info',
      actor: { id: actor.userId, role: actor.role },
      target: { type: 'user', id: created.id },
      ctx: meta,
      metadata: { role: input.role },
    });
  } catch (err) {
    await User.collection.deleteOne({ _id: created._id });
    throw err;
  }
  return toUserDTO(created);
}
