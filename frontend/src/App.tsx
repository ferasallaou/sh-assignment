import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { DemoUser } from './api-types';
import { RunPanel } from './RunPanel';
import type { AskParams } from './use-agent-run';

/** Starters, not finished questions: clicking one fills the box so the user can finish it. */
const STARTERS = [
  { label: 'Should we build…', text: 'Should we build ' },
  { label: 'Which customers asked for…', text: 'Which customers asked for ' },
  { label: 'How many vacation days do I have left?', text: 'How many vacation days do I have left?' },
  { label: 'What is my salary?', text: 'What is my salary?' },
  { label: 'What does the leave policy say about…', text: 'What does the leave policy say about ' },
];

/** Value of the "signed in as" menu that runs the question as every demo user. */
const EVERYONE = '__everyone__';

export function App() {
  const [users, setUsers] = useState<DemoUser[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [who, setWho] = useState('paula');
  const [question, setQuestion] = useState('');
  const [runs, setRuns] = useState<AskParams[]>([]);
  const [showLoginInfo, setShowLoginInfo] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // The page can open before the web API has started (npm run start), so try for a few seconds.
    let cancelled = false;
    async function loadUsers(attempt: number): Promise<void> {
      try {
        const response = await fetch('/api/users');
        if (!response.ok) throw new Error();
        if (!cancelled) setUsers(await response.json());
      } catch {
        if (cancelled) return;
        if (attempt < 20) setTimeout(() => void loadUsers(attempt + 1), 500);
        else setLoadError('Could not reach the web API. Start everything with "npm run start".');
      }
    }
    void loadUsers(1);
    return () => {
      cancelled = true;
    };
  }, []);

  function ask(event?: FormEvent) {
    event?.preventDefault();
    const q = question.trim();
    if (!q || users.length === 0) return;
    const runId = Date.now();
    const ids = who === EVERYONE ? users.map((u) => u.id) : [who];
    setRuns(ids.map((id, i) => ({ user: id, question: q, runId: runId + i })));
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter asks; Shift+Enter adds a new line.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      ask();
    }
  }

  function pickStarter(text: string) {
    setQuestion(text);
    // Focus now, so typing straight away goes into the box; put the cursor at the end once it has the text.
    box.current?.focus();
    requestAnimationFrame(() => box.current?.setSelectionRange(text.length, text.length));
  }

  return (
    <div className="page">
      <header className="top">
        <div>
          <h1>Company Assistant</h1>
          <p className="tagline">Ask about roadmap decisions, leave or pay. Answers only use what you may see.</p>
        </div>
        <div className="signed-in">
          <label htmlFor="who">Signed in as</label>
          <select id="who" value={who} onChange={(e) => setWho(e.target.value)}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
            {users.length > 1 && <option value={EVERYONE}>Everyone (compare)</option>}
          </select>
          <button
            type="button"
            className="info"
            aria-label="About signing in"
            aria-expanded={showLoginInfo}
            aria-controls="login-info"
            onClick={() => setShowLoginInfo((open) => !open)}
          >
            i
          </button>
          {showLoginInfo && (
            <div id="login-info" className="info-pop" role="note">
              <p>
                <strong>This menu stands in for the company login.</strong> It's a demo shortcut, so you can switch
                users and see how answers change.
              </p>
              <p>
                In production, who you are comes from single sign-on (SSO). Your login token travels with every request,
                and the MCP service checks it, together with the assistant's own key, on every lookup. Neither you nor
                the AI can choose someone else's access.
              </p>
            </div>
          )}
        </div>
      </header>

      {loadError && <p className="error-box">{loadError}</p>}

      <form className="ask-box" onSubmit={ask}>
        <textarea
          ref={box}
          value={question}
          maxLength={500}
          rows={1}
          placeholder="Ask a question…"
          aria-label="Your question"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="submit" disabled={!question.trim() || users.length === 0}>
          Ask
        </button>
      </form>

      <div className="starters" aria-label="Suggestions">
        {STARTERS.map((s) => (
          <button type="button" key={s.label} onClick={() => pickStarter(s.text)}>
            {s.label}
          </button>
        ))}
      </div>

      <div className={`runs${runs.length > 1 ? ' runs-compare' : ''}`}>
        {runs.map((params) => (
          <RunPanel
            key={params.runId}
            params={params}
            user={users.find((u) => u.id === params.user)}
            showUser={runs.length > 1}
          />
        ))}
      </div>
    </div>
  );
}
