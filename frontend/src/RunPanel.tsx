import type { DemoUser } from './api-types';
import { Answer } from './Answer';
import { RecordChip } from './RecordChip';
import { useAgentRun, type AskParams } from './use-agent-run';

/** One live agent run: the user it acts for, each tool call as it happens, then the answer. */
export function RunPanel({ params, user }: { params: AskParams; user?: DemoUser }) {
  const state = useAgentRun(params);

  return (
    <article className="panel" aria-live="polite">
      <header className="panel-head">
        <span className="panel-user">{user?.name ?? params.user}</span>
        <span className="panel-groups">groups: {user?.groups.join(', ') ?? '?'}</span>
        <span className={`status status-${state.status}`}>
          {state.status === 'running' ? 'working…' : state.status}
        </span>
      </header>

      <ol className="steps">
        {state.steps.map((step, index) => (
          <li key={index} className="step">
            <div className="step-call">
              <span className="step-tool">{step.name}</span>
              <code className="step-args">{JSON.stringify(step.args)}</code>
            </div>
            <div className="step-result">
              {!step.result && <span className="quiet">waiting…</span>}
              {step.result?.isError && <span className="error-text">refused or failed</span>}
              {step.result && !step.result.isError && step.result.recordIds.length === 0 && (
                <span className="quiet">nothing this user may see</span>
              )}
              {step.result?.recordIds.map((id) => (
                <RecordChip key={id} id={id} />
              ))}
            </div>
          </li>
        ))}
        {state.status === 'running' && state.steps.every((s) => s.result) && (
          <li className="step step-thinking">
            <span className="pulse" aria-hidden /> thinking…
          </li>
        )}
      </ol>

      {state.limitReached && <p className="warning">Limit reached ({state.limitReached}), answering now.</p>}
      {state.status === 'error' && <p className="error-box">{state.error}</p>}
      {state.run && <Answer run={state.run} />}
    </article>
  );
}
