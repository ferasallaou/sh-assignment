import Markdown from 'react-markdown';
import type { AgentRun } from './api-types';
import { RecordChip } from './RecordChip';

/** Turns "[S-101]" into a link the renderer below shows as a source chip. */
function linkCitations(text: string): string {
  return text.replace(/\[([A-Z]+-\d+)\]/g, (_match, id: string) => `[${id}](#cite-${id})`);
}

export function Answer({ run }: { run: AgentRun }) {
  const verified = new Set(run.citations.map((c) => c.externalId));
  return (
    <section className="answer">
      <div className="answer-text">
        <Markdown
          components={{
            a: ({ href, children }) => {
              const id = href?.startsWith('#cite-') ? href.slice('#cite-'.length) : null;
              if (!id) return <a href={href}>{children}</a>;
              return verified.has(id) ? (
                <RecordChip id={id} />
              ) : (
                <RecordChip id={id} muted title="Cited, but no tool returned this record in this run" />
              );
            },
          }}
        >
          {linkCitations(run.answer)}
        </Markdown>
      </div>

      {run.citations.length > 0 && (
        <>
          <h3 className="section-label">Sources</h3>
          <ul className="sources">
            {run.citations.map((c) => (
              <li key={c.externalId}>
                <RecordChip id={c.externalId} />
                <span className="source-title">{c.title}</span>
                <span className="source-meta">
                  {c.source} · updated {new Date(c.sourceUpdatedAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {run.unverifiedCitations.length > 0 && (
        <p className="warning">Cited but never returned by a tool in this run: {run.unverifiedCitations.join(', ')}</p>
      )}
      {run.stoppedByLimit && <p className="warning">Hit the lookup limit, so this answer uses what was found.</p>}
    </section>
  );
}
