import { useEffect, useState } from 'react';
import type { AskStreamEvent } from './api-types';
import { applyEvent, initialRunState, type RunState } from './run-state';

export interface AskParams {
  user: string;
  agent: string;
  question: string;
  /** Changes on every "Ask", so asking the same question again starts a new run. */
  runId: number;
}

/**
 * Opens the SSE stream for one question and keeps the page state up to date.
 * Each run gets its own panel (keyed by runId), so the state starts fresh with every question.
 */
export function useAgentRun(params: AskParams): RunState {
  const [state, setState] = useState<RunState>(initialRunState);

  useEffect(() => {
    const query = new URLSearchParams({ user: params.user, agent: params.agent, q: params.question });
    const source = new EventSource(`/api/ask?${query}`);
    let finished = false;

    const onEvent = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as AskStreamEvent;
      if (event.type !== 'step') {
        finished = true;
        source.close(); // otherwise the browser reconnects and asks again
      }
      setState((current) => applyEvent(current, event));
    };
    for (const name of ['step', 'done', 'error']) source.addEventListener(name, onEvent as EventListener);
    source.onerror = () => {
      if (finished) return;
      source.close();
      setState((current) => ({
        ...current,
        status: 'error',
        error: 'Lost the connection to the web API. Is "npm run api" running?',
      }));
    };
    return () => source.close();
  }, [params]);

  return state;
}
