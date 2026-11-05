import { useState } from 'react';
import type { DemoUser } from './api-types';
import { Answer } from './Answer';
import { RecordChip } from './RecordChip';
import { useAgentRun, type AskParams } from './use-agent-run';

const AGENT_NAMES: Record<string, string> = {
  'roadmap-agent': 'Roadmap assistant',
  'hr-agent': 'HR assistant',
  'product-faq-agent': 'Product FAQ assistant',
};

/**
 * One question and its answer. How the answer was found (the router's choice and each lookup
 * through the MCP service) is shown live while it runs, then folds away behind one line.
 */
export function RunPanel({ params, user, showUser }: { params: AskParams; user?: DemoUser; showUser: boolean }) {
  const state = useAgentRun(params);
  const [expanded, setExpanded] = useState(false);
  const running = state.status === 'running';
  const agent = state.route?.agentId ? (AGENT_NAMES[state.route.agentId] ?? state.route.agentId) : null;
  const refused = state.steps.filter((s) => s.result?.isError).length;

  let summary: string;
  if (running) summary = state.route ? 'Looking things up…' : 'Choosing an assistant…';
  else if (state.steps.length === 0) summary = 'How this was answered';
  else
    summary = `${state.steps.length} lookup${state.steps.length === 1 ? '' : 's'}${refused ? ` · ${refused} refused` : ''}`;

  return (
    <article className="panel" aria-live="polite" aria-busy={running}>
      <header className="panel-head">
        {showUser && <p className="panel-user">{user?.name ?? params.user}</p>}
        <h2 className="panel-question">{params.question}</h2>
        {agent && <p className="panel-meta">Answered by the {agent}</p>}
      </header>

      <details
        className="trace"
        open={running || expanded}
        onToggle={(e) => {
          if (!running) setExpanded(e.currentTarget.open);
        }}
      >
        <summary>
          {running && <span className="pulse" aria-hidden />}
          {summary}
        </summary>
        {state.route && (
          <p className="trace-route">
            {state.route.agentId ? (
              <>
                Sent to the {agent}: {state.route.reason}
              </>
            ) : (
              'No assistant was picked.'
            )}
          </p>
        )}
        <ol className="trace-steps">
          {state.steps.map((step, index) => (
            <li key={index}>
              <code className="trace-tool">{step.name}</code>
              {step.args !== null && Object.keys(step.args as object).length > 0 && (
                <code className="trace-args">{JSON.stringify(step.args)}</code>
              )}
              <span className="trace-result">
                {!step.result && <span className="quiet">…</span>}
                {step.result?.isError && <span className="error-text">refused</span>}
                {step.result && !step.result.isError && step.result.recordIds.length === 0 && (
                  <span className="quiet">nothing you may see</span>
                )}
                {step.result?.recordIds.map((id) => (
                  <RecordChip key={id} id={id} />
                ))}
              </span>
            </li>
          ))}
        </ol>
        {user && (
          <p className="trace-who">
            Checked as {user.name}, groups: {user.groups.join(', ') || 'none'}
          </p>
        )}
      </details>

      {state.status === 'error' && <p className="error-box">{state.error}</p>}
      {state.run && <Answer run={state.run} />}
    </article>
  );
}
