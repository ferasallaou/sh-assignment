import { ChatOpenAI } from '@langchain/openai';
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { LlmProvider, LlmReply, Message, ToolSpec } from '../types';

/** The part of a LangChain chat model we use. Lets tests pass a stand-in without network calls. */
export interface ToolCallingChatModel {
  bindTools(tools: OpenAiToolDefinition[]): { invoke(messages: BaseMessage[]): Promise<AIMessage> };
  invoke(messages: BaseMessage[]): Promise<AIMessage>;
}

interface OpenAiToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface OpenRouterChatOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * Chat through OpenRouter, using LangChain only as the adapter (CLAUDE.md rule).
 * LangChain handles the wire format and tool binding; the agent loop stays our own code.
 * OpenRouter speaks the OpenAI API, so LangChain's OpenAI client is pointed at it.
 */
export class OpenRouterChatProvider implements LlmProvider {
  readonly name: string;

  constructor(
    options: OpenRouterChatOptions,
    private readonly model: ToolCallingChatModel = new ChatOpenAI({
      model: options.model,
      apiKey: options.apiKey,
      temperature: 0,
      maxRetries: 2,
      configuration: { baseURL: options.baseUrl },
    }),
  ) {
    this.name = `openrouter:${options.model}`;
  }

  async generate(messages: Message[], tools: ToolSpec[] = []): Promise<LlmReply> {
    const runnable = tools.length > 0 ? this.model.bindTools(tools.map(toOpenAiTool)) : this.model;
    const reply = await runnable.invoke(messages.map(toLangChainMessage));
    return fromLangChainReply(reply);
  }
}

export function toOpenAiTool(tool: ToolSpec): OpenAiToolDefinition {
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  };
}

export function toLangChainMessage(message: Message): BaseMessage {
  switch (message.role) {
    case 'system':
      return new SystemMessage(message.content);
    case 'user':
      return new HumanMessage(message.content);
    case 'assistant':
      return new AIMessage({
        content: message.content,
        tool_calls: (message.toolCalls ?? []).map((call) => ({
          id: call.id,
          name: call.name,
          args: (call.args ?? {}) as Record<string, unknown>,
          type: 'tool_call' as const,
        })),
      });
    case 'tool':
      return new ToolMessage({ tool_call_id: message.toolCallId, content: message.content });
  }
}

export function fromLangChainReply(reply: AIMessage): LlmReply {
  const text = textOf(reply.content);
  const calls = (reply.tool_calls ?? []).map((call, index) => ({
    // Some providers omit call IDs; the next message must reference one, so make a stable one up.
    id: call.id ?? `call_${index}`,
    name: call.name,
    args: call.args,
  }));
  return calls.length > 0 ? { type: 'tool_calls', text, calls } : { type: 'text', text };
}

/** LangChain content is a string or a list of parts; we only use the text parts. */
function textOf(content: AIMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .map((part) => (typeof part === 'object' && part !== null && 'text' in part ? String(part.text) : ''))
    .join('');
}
