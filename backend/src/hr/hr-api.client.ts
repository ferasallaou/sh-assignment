import type { HrSystem, LeaveBalance, Salary } from '../types';
import { HR_SERVICE_KEY_HEADER } from './hr-api.server';

/** Talks to the HR web service over HTTP. Every call is live; nothing is cached or stored. */
export class HrApiClient implements HrSystem {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceKey: string,
    private readonly timeoutMs = 5000,
  ) {}

  getLeaveBalance(userId: string): Promise<LeaveBalance | null> {
    return this.get(`/employees/${encodeURIComponent(userId)}/leave`);
  }

  getSalary(userId: string): Promise<Salary | null> {
    return this.get(`/employees/${encodeURIComponent(userId)}/salary`);
  }

  private async get<T>(path: string): Promise<T | null> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        headers: { [HR_SERVICE_KEY_HEADER]: this.serviceKey },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new Error(`Could not reach the HR system at ${this.baseUrl}. Is "npm run hr-api" running?`);
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`The HR system answered ${response.status}`);
    return (await response.json()) as T;
  }
}
