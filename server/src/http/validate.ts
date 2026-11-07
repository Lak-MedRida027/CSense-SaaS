import type { Request } from 'express';
import { z, type ZodType } from 'zod';
import { validation, type ValidationIssue } from '../lib/httpError.js';
import type { RouteDef } from './routeRegistry.js';

const EMPTY = z.object({}).strict();
const BODY_METHODS = new Set(['post', 'put', 'patch']);

type Location = ValidationIssue['location'];

function run(location: Location, schema: ZodType, input: unknown, issues: ValidationIssue[]) {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  // Only location, path and message: never the submitted value.
  for (const issue of result.error.issues) {
    issues.push({ location, path: issue.path.map(String).join('.'), message: issue.message });
  }
  return undefined;
}

/**
 * Validate body, params and query against the route schemas (strict empty object when absent).
 * Output goes to the handler context, never back onto `req` (req.query is read-only in Express 5).
 */
export function validateRequest(
  def: RouteDef,
  req: Request,
): { body: unknown; params: unknown; query: unknown } {
  const issues: ValidationIssue[] = [];
  const carriesBody = BODY_METHODS.has(def.method);

  const bodyInput: unknown = req.body;
  let body: unknown;
  if (carriesBody) {
    body = run('body', def.schemas?.body ?? z.undefined().or(EMPTY), bodyInput, issues);
  } else {
    // Methods without a body: tolerate none or `{}`, reject anything else.
    body = run('body', z.undefined().or(EMPTY), bodyInput, issues);
  }
  const params = run('params', def.schemas?.params ?? EMPTY, req.params, issues);
  const query = run('query', def.schemas?.query ?? EMPTY, req.query, issues);

  if (issues.length > 0) throw validation(issues);
  return { body, params, query };
}
