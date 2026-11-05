// The web API's types come straight from the backend (type-only, erased at build time),
// so the page and the server can't drift apart. Import the specific files, not the backend's
// types index: these two only depend on plain type files, never on Node or library code.
export type { AskStreamEvent, DemoAgent, DemoUser } from '../../backend/src/types/api';
export type { AgentEvent, AgentRun, Citation } from '../../backend/src/types/agent';
