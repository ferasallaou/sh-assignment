import { describe, expect, it } from 'vitest';
import { agentName, joinOr } from '../src/agent-names';
import { pickUser } from '../src/pick-user';

const users = [
  { id: 'sam', name: 'Sam', groups: ['sales'] },
  { id: 'eli', name: 'Eli', groups: ['engineering'] },
];

describe('pickUser', () => {
  it('starts as the first user in the list, not a fixed name', () => {
    expect(pickUser(users, '')).toBe('sam');
    expect(pickUser(users, 'paula')).toBe('sam');
  });
  it('keeps the current user if they are in the list', () => {
    expect(pickUser(users, 'eli')).toBe('eli');
  });
  it('picks nobody when there are no users', () => {
    expect(pickUser([], 'paula')).toBe('');
  });
});

describe('assistant names', () => {
  it('uses friendly names, falling back to the ID', () => {
    expect(agentName('hr-agent')).toBe('HR assistant');
    expect(agentName('new-agent')).toBe('new-agent assistant');
  });
  it('joins names the way people write them', () => {
    expect(joinOr([])).toBe('');
    expect(joinOr(['HR'])).toBe('HR');
    expect(joinOr(['Roadmap', 'HR'])).toBe('Roadmap or HR');
    expect(joinOr(['Roadmap', 'Product FAQ', 'HR'])).toBe('Roadmap, Product FAQ or HR');
  });
});
