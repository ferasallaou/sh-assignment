import type { PolicyConfig, UserPolicy, VerifiedCaller } from '../types';

/** The group whose members may see colleagues' HR data (here: salaries). */
export const HR_GROUP = 'hr';

/** Thrown when the caller may not see what they asked for. The MCP service logs it as refused. */
export class AccessDeniedError extends Error {}

/**
 * Who a salary request is about. `employee` is whatever the model passed (a name or ID); it is
 * only a request. Returns the user it names, or null if it names nobody we know.
 */
export function findEmployee(policies: PolicyConfig, employee: string): UserPolicy | null {
  const wanted = employee.trim().toLowerCase();
  return (
    policies.users.find(
      (u) => u.id === wanted || u.name.toLowerCase() === wanted || u.name.toLowerCase().split(' ')[0] === wanted,
    ) ?? null
  );
}

/**
 * Salary rule, enforced in code by the MCP service (never by the model):
 *   - your own pay: always,
 *   - someone else's: only if you are in the HR group.
 */
export function canSeeSalaryOf(caller: VerifiedCaller, target: UserPolicy): boolean {
  return target.id === caller.user.id || caller.user.groups.includes(HR_GROUP);
}
