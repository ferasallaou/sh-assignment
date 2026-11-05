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

/**
 * The HR system's API, reached live at question time.
 * The mock reads a JSON file (src/hr/mock-hr-system.ts); production would call the HR
 * system (Workday, Personio, ...) with the user's own token.
 */
export interface HrSystem {
  /** The balance of exactly this user, or null if the HR system has no record for them. */
  getLeaveBalance(userId: string): Promise<LeaveBalance | null>;
}
