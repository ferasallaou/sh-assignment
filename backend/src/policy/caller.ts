import type { AccessScope, VerifiedCaller } from '../types';

/** What a verified caller may read: its agent's sources and its user's groups (see AccessScope). */
export function accessScopeOf(caller: VerifiedCaller): AccessScope {
  return { sources: [...caller.agent.allowed_sources], groups: [...caller.user.groups] };
}
