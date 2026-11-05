import { describe, expect, it } from 'vitest';
import type { AgentRun, AskStreamEvent } from '../src/api-types';
import { applyEvent, initialRunState, type RunState } from '../src/run-state';

const play = (events: AskStreamEvent[]): RunState => events.reduce(applyEvent, initialRunState);
const call = (step: number, name: string): AskStreamEvent => ({
  type: 'step',
  event: { type: 'tool_call', step, name, args: { q: name } },
});
const result = (step: number, name: string, isError = false, recordIds = ['ENG-51']): AskStreamEvent => ({
  type: 'step',
  event: { type: 'tool_result', step, name, isError, recordIds },
});
const run: AgentRun = { answer: 'Yes', citations: [], unverifiedCitations: [], toolCalls: 1, stoppedByLimit: false };

describe('applyEvent: turning live updates into what the page shows', () => {
  it('starts as running with no steps', () => {
    expect(initialRunState).toEqual({ status: 'running', steps: [] });
  });

  it('remembers which assistant the router picked', () => {
    const state = play([{ type: 'routed', agentId: 'hr-agent', reason: 'leave question' }]);
    expect(state.route).toEqual({ agentId: 'hr-agent', reason: 'leave question' });
    expect(state.status).toBe('running');
  });

  it('adds a step per lookup and attaches its result', () => {
    const state = play([call(1, 'search_knowledge'), result(1, 'search_knowledge')]);
    expect(state.steps).toEqual([
      {
        step: 1,
        name: 'search_knowledge',
        args: { q: 'search_knowledge' },
        result: { isError: false, recordIds: ['ENG-51'] },
      },
    ]);
  });

  it('matches results to the earliest waiting call of the same tool', () => {
    const state = play([
      call(1, 'search_knowledge'),
      call(1, 'get_feature_context'),
      call(1, 'search_knowledge'),
      result(1, 'search_knowledge', false, ['A']),
      result(1, 'get_feature_context', true, []),
      result(1, 'search_knowledge', false, ['B']),
    ]);
    expect(state.steps.map((s) => s.result)).toEqual([
      { isError: false, recordIds: ['A'] },
      { isError: true, recordIds: [] },
      { isError: false, recordIds: ['B'] },
    ]);
  });

  it('ignores a result with no matching call', () => {
    const before = play([call(1, 'search_knowledge')]);
    expect(applyEvent(before, result(1, 'get_salary'))).toBe(before);
  });

  it('records when a limit stopped the run', () => {
    expect(play([{ type: 'step', event: { type: 'limit_reached', reason: 'tool_calls' } }]).limitReached).toBe(
      'tool_calls',
    );
  });

  it('waits for done to show the answer', () => {
    const state = play([{ type: 'step', event: { type: 'answer', text: 'draft' } }]);
    expect(state.run).toBeUndefined();
    expect(state.status).toBe('running');
  });

  it('finishes with the run and keeps the steps', () => {
    const state = play([call(1, 'search_knowledge'), result(1, 'search_knowledge'), { type: 'done', run }]);
    expect(state.status).toBe('done');
    expect(state.run).toEqual(run);
    expect(state.steps).toHaveLength(1);
  });

  it('shows the error message', () => {
    const state = play([{ type: 'error', message: 'Something went wrong. Please try again.' }]);
    expect(state).toMatchObject({ status: 'error', error: 'Something went wrong. Please try again.' });
  });
});
