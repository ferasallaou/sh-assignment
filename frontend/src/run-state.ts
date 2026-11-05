import type { AgentRun, AskStreamEvent, RouteDecision } from './api-types';

/** One tool call as shown on the page: what was asked, and what came back. */
export interface StepView {
  step: number;
  name: string;
  args: unknown;
  result?: { isError: boolean; recordIds: string[] };
}

export interface RunState {
  status: 'running' | 'done' | 'error';
  /** Which agent the router chose, once it has decided. */
  route?: RouteDecision;
  steps: StepView[];
  limitReached?: 'steps' | 'tool_calls';
  run?: AgentRun;
  error?: string;
}

export const initialRunState: RunState = { status: 'running', steps: [] };

/** Folds one streamed event into the page state. Pure, so it is easy to follow and test. */
export function applyEvent(state: RunState, event: AskStreamEvent): RunState {
  if (event.type === 'done') return { ...state, status: 'done', run: event.run };
  if (event.type === 'error') return { ...state, status: 'error', error: event.message };
  if (event.type === 'routed') return { ...state, route: { agentId: event.agentId, reason: event.reason } };

  const step = event.event;
  switch (step.type) {
    case 'tool_call':
      return { ...state, steps: [...state.steps, { step: step.step, name: step.name, args: step.args }] };
    case 'tool_result': {
      // Results arrive in call order, so attach this one to the earliest call still waiting.
      const index = state.steps.findIndex((s) => !s.result && s.name === step.name);
      if (index === -1) return state;
      const steps = [...state.steps];
      steps[index] = { ...steps[index], result: { isError: step.isError, recordIds: step.recordIds } };
      return { ...state, steps };
    }
    case 'limit_reached':
      return { ...state, limitReached: step.reason };
    case 'answer':
      return state; // the full answer arrives with `done`, together with its checked citations
  }
}
