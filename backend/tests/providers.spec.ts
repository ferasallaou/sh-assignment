/**
 * Step 7 checks: the OpenRouter adapters translate between our own message/tool types and
 * LangChain correctly, and model settings are read safely. No network calls: the LangChain
 * models are replaced with stand-ins. (`npm run models:check` calls the real models.)
 */
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { loadConfig } from '../src/config';
import type { ToolSpec } from '../src/types';
import {
  fromLangChainReply,
  OpenRouterChatProvider,
  toLangChainMessage,
  ToolCallingChatModel,
} from '../src/providers/openrouter-chat.provider';
import { OpenRouterEmbeddingProvider } from '../src/providers/openrouter-embedding.provider';

const options = { apiKey: 'test-key', baseUrl: 'https://openrouter.example/api/v1', model: 'some/model' };

const searchTool: ToolSpec = {
  name: 'search_knowledge',
  description: 'Searches knowledge.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
};

/** Records what the provider sends and answers with a fixed reply. */
function fakeChatModel(reply: AIMessage) {
  const seen: { tools?: unknown; messages?: BaseMessage[] } = {};
  const model: ToolCallingChatModel = {
    bindTools(tools) {
      seen.tools = tools;
      return { invoke: async (messages) => ((seen.messages = messages), reply) };
    },
    invoke: async (messages) => ((seen.messages = messages), reply),
  };
  return { model, seen };
}

describe('chat provider', () => {
  it('sends tools in the function-calling format and returns the tool calls', async () => {
    const { model, seen } = fakeChatModel(
      new AIMessage({
        content: '',
        tool_calls: [{ id: 'call-1', name: 'search_knowledge', args: { query: 'dark mode' }, type: 'tool_call' }],
      }),
    );
    const provider = new OpenRouterChatProvider(options, model);

    const reply = await provider.generate([{ role: 'user', content: 'dark mode?' }], [searchTool]);

    expect(seen.tools).toEqual([
      {
        type: 'function',
        function: { name: 'search_knowledge', description: 'Searches knowledge.', parameters: searchTool.inputSchema },
      },
    ]);
    expect(reply).toEqual({
      type: 'tool_calls',
      text: '',
      calls: [{ id: 'call-1', name: 'search_knowledge', args: { query: 'dark mode' } }],
    });
  });

  it('returns plain text when the model answers without tools', async () => {
    const { model, seen } = fakeChatModel(new AIMessage('Dark mode has strong demand.'));
    const reply = await new OpenRouterChatProvider(options, model).generate([{ role: 'user', content: 'hi' }]);
    expect(reply).toEqual({ type: 'text', text: 'Dark mode has strong demand.' });
    expect(seen.tools).toBeUndefined(); // no tools offered → none bound
  });

  it('names itself after the model', () => {
    expect(new OpenRouterChatProvider(options, fakeChatModel(new AIMessage('')).model).name).toBe(
      'openrouter:some/model',
    );
  });

  it('converts a whole conversation, including tool calls and tool results', () => {
    const converted = [
      toLangChainMessage({ role: 'system', content: 'rules' }),
      toLangChainMessage({ role: 'user', content: 'question' }),
      toLangChainMessage({
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'search_knowledge', args: { query: 'x' } }],
      }),
      toLangChainMessage({ role: 'tool', toolCallId: 'c1', content: '{"results":[]}' }),
    ];
    expect(converted[0]).toBeInstanceOf(SystemMessage);
    expect(converted[1]).toBeInstanceOf(HumanMessage);
    expect((converted[2] as AIMessage).tool_calls).toEqual([
      { id: 'c1', name: 'search_knowledge', args: { query: 'x' }, type: 'tool_call' },
    ]);
    expect(converted[3]).toBeInstanceOf(ToolMessage);
    expect((converted[3] as ToolMessage).tool_call_id).toBe('c1');
  });

  it('keeps only the text parts of a multi-part reply, and fills in missing call IDs', () => {
    const reply = fromLangChainReply(
      new AIMessage({
        content: [
          { type: 'text', text: 'Let me check. ' },
          { type: 'text', text: 'One moment.' },
        ],
        tool_calls: [{ name: 'get_feature_context', args: { feature: 'dark-mode' }, type: 'tool_call' }],
      }),
    );
    expect(reply).toEqual({
      type: 'tool_calls',
      text: 'Let me check. One moment.',
      calls: [{ id: 'call_0', name: 'get_feature_context', args: { feature: 'dark-mode' } }],
    });
  });
});

describe('embedding provider', () => {
  it('returns one vector per text and names itself after the model', async () => {
    const provider = new OpenRouterEmbeddingProvider(options, {
      embedDocuments: async (texts) => texts.map(() => [0.1, 0.2]),
    });
    expect(await provider.embed(['a', 'b'])).toEqual([
      [0.1, 0.2],
      [0.1, 0.2],
    ]);
    expect(provider.name).toBe('openrouter:some/model');
  });

  it('fails loudly if the model returns the wrong number of vectors', async () => {
    const provider = new OpenRouterEmbeddingProvider(options, { embedDocuments: async () => [[0.1]] });
    await expect(provider.embed(['a', 'b'])).rejects.toThrow(/1 vectors for 2 texts/);
  });

  it('does not call the model for an empty list', async () => {
    const provider = new OpenRouterEmbeddingProvider(options, {
      embedDocuments: async () => {
        throw new Error('should not be called');
      },
    });
    expect(await provider.embed([])).toEqual([]);
  });
});

describe('model settings', () => {
  it('treats a blank API key as not set, and uses default models', () => {
    const config = loadConfig({ OPENROUTER_API_KEY: '' });
    expect(config.OPENROUTER_API_KEY).toBeUndefined();
    expect(config.OPENROUTER_CHAT_MODEL).toBe('anthropic/claude-sonnet-5.5');
    expect(config.OPENROUTER_EMBEDDING_MODEL).toBe('openai/text-embedding-3-small');
    expect(config.OPENROUTER_BASE_URL).toBe('https://openrouter.ai/api/v1');
  });

  it('lets the models be changed through environment variables', () => {
    const config = loadConfig({ OPENROUTER_API_KEY: 'k', OPENROUTER_CHAT_MODEL: 'openai/gpt-6.1-terra' });
    expect(config.OPENROUTER_API_KEY).toBe('k');
    expect(config.OPENROUTER_CHAT_MODEL).toBe('openai/gpt-6.1-terra');
  });
});
