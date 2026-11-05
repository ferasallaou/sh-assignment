import type { HrSystem } from '../types';

/**
 * For setups that never call the HR tools (some tests, the roadmap demo). Fails loudly if
 * an HR tool is used anyway, instead of quietly connecting to whatever the settings point at.
 */
export const hrNotConnected: HrSystem = {
  getLeaveBalance: () => Promise.reject(new Error('HR system is not connected')),
  getSalary: () => Promise.reject(new Error('HR system is not connected')),
};
