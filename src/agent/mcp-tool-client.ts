import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AGENT_KEY_HEADER, USER_TOKEN_HEADER } from '../mcp/mcp.service';
import type { AgentToolClient, ToolOutcome, ToolSpec } from '../types';

/**
 * Connects an agent to the MCP service over HTTP. The agent sends its own key and the
 * user's token on every request; the service decides what that pair may see.
 * The model never sees or chooses these keys.
 */
export class McpToolClient implements AgentToolClient {
  private constructor(private readonly client: Client) {}

  static async connect(url: string, agentKey: string, userToken: string): Promise<McpToolClient> {
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { [AGENT_KEY_HEADER]: agentKey, [USER_TOKEN_HEADER]: userToken } },
    });
    const client = new Client({ name: 'roadmap-agent', version: '0.1.0' });
    await client.connect(transport);
    return new McpToolClient(client);
  }

  async listTools(): Promise<ToolSpec[]> {
    const { tools } = await this.client.listTools();
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: tool.inputSchema as Record<string, unknown>,
    }));
  }

  async callTool(name: string, args: unknown): Promise<ToolOutcome> {
    const result = await this.client.callTool({ name, arguments: (args ?? {}) as Record<string, unknown> });
    const text = (result.content as { type: string; text?: string }[])
      .map((part) => (part.type === 'text' ? (part.text ?? '') : ''))
      .join('');
    return { isError: result.isError === true, text };
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
