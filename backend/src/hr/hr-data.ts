import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { LeaveBalance, Salary } from '../types';

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
  salary: z.object({
    job_title: z.string(),
    base_salary_eur: z.number().min(0),
    bonus_target_percent: z.number().min(0),
    effective_from: z.string(),
  }),
});
const fileSchema = z.object({ employees: z.array(employeeSchema) });
type Employee = z.infer<typeof employeeSchema>;

/**
 * The pretend HR system's data, read from the JSON file on EVERY call (no cache),
 * so an edit to the file shows up on the next request. Used only by the HR web service.
 */
export class HrData {
  constructor(private readonly path: string = DEFAULT_HR_DATA_PATH) {}

  leave(userId: string): LeaveBalance | null {
    const e = this.find(userId);
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

  salary(userId: string): Salary | null {
    const e = this.find(userId);
    if (!e) return null;
    return {
      userId: e.user_id,
      employeeNumber: e.employee_number,
      jobTitle: e.salary.job_title,
      baseSalaryEur: e.salary.base_salary_eur,
      bonusTargetPercent: e.salary.bonus_target_percent,
      effectiveFrom: e.salary.effective_from,
      updatedAt: e.updated_at,
    };
  }

  private find(userId: string): Employee | undefined {
    const { employees } = fileSchema.parse(JSON.parse(readFileSync(this.path, 'utf8')));
    return employees.find((employee) => employee.user_id === userId);
  }
}
