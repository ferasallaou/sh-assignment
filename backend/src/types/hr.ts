/** One person's leave for the current year, as the HR system reports it. Never stored by us. */
export interface LeaveBalance {
  userId: string;
  employeeNumber: number;
  year: number;
  annualDays: number;
  carriedOverDays: number;
  takenDays: number;
  /** Approved future leave. It counts as used. */
  bookedDays: number;
  /** annualDays + carriedOverDays - takenDays - bookedDays */
  remainingDays: number;
  nextBookedLeave: string | null;
  /** When the HR system last changed this balance (ISO 8601). */
  updatedAt: string;
}

/** One person's pay, as the HR system reports it. Never stored by us. */
export interface Salary {
  userId: string;
  employeeNumber: number;
  jobTitle: string;
  baseSalaryEur: number;
  bonusTargetPercent: number;
  effectiveFrom: string;
  updatedAt: string;
}

/**
 * The HR system's API, reached live at question time (over HTTP: src/hr/hr-api.client.ts).
 * It answers for exactly the user it is asked about. Deciding WHO may ask about whom is the
 * MCP service's job (src/policy/hr-access.ts), not the HR client's.
 */
export interface HrSystem {
  /** null if the HR system has no record for this user. */
  getLeaveBalance(userId: string): Promise<LeaveBalance | null>;
  getSalary(userId: string): Promise<Salary | null>;
}
