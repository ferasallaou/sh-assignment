/**
 * The chat model, behind a small interface of our own, so the agent loop doesn't depend on
 * LangChain or OpenRouter. The model may answer with text or ask to call some of the offered tools.
 */
export interface LlmProvider {
  /** e.g. "openrouter:anthropic/claude-sonnet-5.5" */
  readonly name: string;
  generate(messages: Message[], tools?: ToolSpec[]): Promise<LlmReply>;
}

export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

/** A tool the model may call. Mirrors an MCP tool listing: name, description, JSON Schema input. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type LlmReply = { type: 'text'; text: string } | { type: 'tool_calls'; text: string; calls: ToolCall[] };

/**
 * Turns texts into "meaning" vectors for similarity search.
 * The real implementation is OpenRouter through LangChain (openrouter-embedding.provider.ts).
 * With no API key the provider is `null`: chunks wait without embeddings and
 * search uses full-text matching only.
 */
export interface EmbeddingProvider {
  /**
   * Identifies the model, e.g. "openrouter:openai/text-embedding-3-small". It is stored with every
   * embedding, so vectors from different models are never compared and a model change re-embeds.
   */
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}
