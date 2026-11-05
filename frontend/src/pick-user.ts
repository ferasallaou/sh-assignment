import type { DemoUser } from './api-types';

/** Keeps the current choice if that user still exists, otherwise picks the first user ('' if none). */
export function pickUser(users: DemoUser[], current: string): string {
  return users.some((u) => u.id === current) ? current : (users[0]?.id ?? '');
}
