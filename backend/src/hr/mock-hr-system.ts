import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { HrSystem, LeaveBalance } from '../types';

export const DEFAULT_HR_DATA_PATH = join(__dirname, '..', '..', 'data', 'live', 'hr-system.json');

const employeeSchema = z.object({
  user_id: z.string().min(1),
  employee_number: z.number().int(),
  year: z.number().int(),
  annual_days: z.number().min(0),
  carried_over_days: z.number().min(0),
  taken_days: z.number().min(0),
  booked_days: z.number().min(0),
  next_booked_leave: z.string().nullable(),
  updated_at: z.iso.datetime(),
});
const fileSchema = z.object({ employees: z.array(employeeSchema) });

/**
 * A pretend HR system. It stands in for a live API call, so it:
 *   - reads the file on EVERY call (nothing is cached or copied into the knowledge base),
 *   - waits a little, like a network call,
 *   - only answers for the one user it is asked about.
 */
export class MockHrSystem implements HrSystem {
  constructor(
    private readonly path: string = DEFAULT_HR_DATA_PATH,
    private readonly delayMs = 150,
  ) {}

  async getLeaveBalance(userId: string): Promise<LeaveBalance | null> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const { employees } = fileSchema.parse(JSON.parse(readFileSync(this.path, 'utf8')));
    const e = employees.find((employee) => employee.user_id === userId);
    if (!e) return null;
    return {
      userId: e.user_id,
      employeeNumber: e.employee_number,
      year: e.year,
      annualDays: e.annual_days,
      carriedOverDays: e.carried_over_days,
      takenDays: e.taken_days,
      bookedDays: e.booked_days,
      remainingDays: e.annual_days + e.carried_over_days - e.taken_days - e.booked_days,
      nextBookedLeave: e.next_booked_leave,
      updatedAt: e.updated_at,
    };
  }
}
