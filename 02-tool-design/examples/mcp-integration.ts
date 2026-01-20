/**
 * mcp-integration.ts - Model Context Protocol Integration
 *
 * Derivation:
 * - Report 10: MCP standardizes tool discovery and execution
 * - Report 28: "The entire ecosystem will speak the same tool protocol"
 * - MCP Spec: Transport-agnostic, capability-based tool exposure
 *
 * MCP provides a standard way to expose tools to LLMs.
 * This integration allows agents to use MCP servers as tool providers.
 */

import { Tool, createTool, ToolInputSchema } from '../tool-types';

// =============================================================================
// MCP Protocol Types (Simplified)
// =============================================================================

/**
 * MCP Tool definition from server.
 * Matches the MCP specification's tool structure.
 */
interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * MCP Server capabilities.
 */
interface MCPCapabilities {
  tools?: {
    listChanged?: boolean;
  };
  resources?: {
    subscribe?: boolean;
    listChanged?: boolean;
  };
  prompts?: {
    listChanged?: boolean;
  };
}

/**
 * MCP Server connection interface.
 */
interface MCPServer {
  name: string;
  capabilities: MCPCapabilities;
  listTools(): Promise<MCPToolDefinition[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

// =============================================================================
// MCP Client (Simplified Implementation)
// =============================================================================

/**
 * Simple MCP client for stdio-based servers.
 *
 * Derivation (Report 10):
 * "MCP servers expose tools via a standardized protocol.
 * The client discovers available tools and proxies calls."
 *
 * In production, use @modelcontextprotocol/sdk for full MCP support.
 */
export class SimpleMCPClient {
  private servers: Map<string, MCPServer> = new Map();

  /**
   * Register an MCP server.
   */
  async registerServer(server: MCPServer): Promise<void> {
    if (!server.capabilities.tools) {
      console.warn(`Server ${server.name} does not support tools capability`);
      return;
    }
    this.servers.set(server.name, server);
  }

  /**
   * Discover all tools from registered servers.
   * Returns tools with server prefixes for namespacing.
   */
  async discoverTools(): Promise<Tool[]> {
    const tools: Tool[] = [];

    for (const [serverName, server] of this.servers) {
      const mcpTools = await server.listTools();

      for (const mcpTool of mcpTools) {
        tools.push(this.wrapMCPTool(serverName, server, mcpTool));
      }
    }

    return tools;
  }

  /**
   * Wrap an MCP tool as a standard Tool.
   *
   * Derivation (Report 28):
   * "Tools should have consistent interfaces regardless of source.
   * MCP tools become first-class citizens in the agent's action space."
   */
  private wrapMCPTool(
    serverName: string,
    server: MCPServer,
    mcpTool: MCPToolDefinition
  ): Tool {
    // Namespace tool names to avoid collisions
    const namespacedName = `${serverName}.${mcpTool.name}`;

    return createTool({
      name: namespacedName,
      description: `[${serverName}] ${mcpTool.description}`,
      inputSchema: mcpTool.inputSchema as ToolInputSchema,
      execute: async (input) => {
        try {
          const result = await server.callTool(mcpTool.name, input);
          return typeof result === 'string' ? result : JSON.stringify(result);
        } catch (error) {
          throw new Error(`MCP tool ${namespacedName} failed: ${error}`);
        }
      },
    });
  }

  /**
   * Close all server connections.
   */
  async close(): Promise<void> {
    for (const server of this.servers.values()) {
      await server.close();
    }
    this.servers.clear();
  }
}

// =============================================================================
// MCP Server Mocks (For Testing)
// =============================================================================

/**
 * Create a mock MCP server for testing.
 *
 * In production, connect to real MCP servers via stdio or HTTP.
 */
export function createMockMCPServer(
  name: string,
  tools: MCPToolDefinition[],
  implementations: Record<string, (args: Record<string, unknown>) => unknown>
): MCPServer {
  return {
    name,
    capabilities: { tools: { listChanged: false } },
    listTools: async () => tools,
    callTool: async (toolName, args) => {
      const impl = implementations[toolName];
      if (!impl) {
        throw new Error(`Unknown tool: ${toolName}`);
      }
      return impl(args);
    },
    close: async () => {},
  };
}

// =============================================================================
// Example: Filesystem MCP Server
// =============================================================================

/**
 * Example MCP server exposing filesystem operations.
 *
 * Derivation (Report 10):
 * "MCP servers can expose any capability: filesystem, database,
 * external APIs. The protocol is the interface contract."
 */
export const filesystemMCPServer = createMockMCPServer(
  'filesystem',
  [
    {
      name: 'read_file',
      description: 'Read contents of a file',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to read' },
        },
        required: ['path'],
      },
    },
    {
      name: 'write_file',
      description: 'Write contents to a file',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to write' },
          content: { type: 'string', description: 'Content to write' },
        },
        required: ['path', 'content'],
      },
    },
    {
      name: 'list_directory',
      description: 'List directory contents',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path' },
        },
        required: ['path'],
      },
    },
  ],
  {
    read_file: async ({ path }) => {
      const fs = await import('fs/promises');
      return await fs.readFile(path as string, 'utf-8');
    },
    write_file: async ({ path, content }) => {
      const fs = await import('fs/promises');
      await fs.writeFile(path as string, content as string, 'utf-8');
      return `Written to ${path}`;
    },
    list_directory: async ({ path }) => {
      const fs = await import('fs/promises');
      const entries = await fs.readdir(path as string, { withFileTypes: true });
      return entries.map(e => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`).join('\n');
    },
  }
);

// =============================================================================
// Example: Database MCP Server
// =============================================================================

/**
 * Example MCP server for database operations.
 *
 * Derivation (Report 28):
 * "Complete action spaces include database access.
 * Restricted agents can't complete real tasks."
 */
export const databaseMCPServer = createMockMCPServer(
  'database',
  [
    {
      name: 'query',
      description: 'Execute a read-only SQL query',
      inputSchema: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'SQL query to execute' },
        },
        required: ['sql'],
      },
    },
    {
      name: 'execute',
      description: 'Execute a SQL statement (INSERT, UPDATE, DELETE)',
      inputSchema: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'SQL statement to execute' },
          params: { type: 'array', description: 'Query parameters' },
        },
        required: ['sql'],
      },
    },
  ],
  {
    query: async ({ sql: _sql }) => {
      // In production: Execute against real database
      return JSON.stringify({
        rows: [{ id: 1, name: 'Example' }],
        rowCount: 1,
      });
    },
    execute: async ({ sql: _sql, params: _params }) => {
      // In production: Execute against real database
      return JSON.stringify({ rowsAffected: 1 });
    },
  }
);

// =============================================================================
// Usage Example
// =============================================================================

/**
 * Example: Using MCP tools with an agent.
 *
 * ```typescript
 * import { SimpleMCPClient, filesystemMCPServer } from './mcp-integration';
 * import { standardTools } from './basic-tools';
 * import { runAgent } from '../../01-the-loop/minimal-agent';
 *
 * async function main() {
 *   // Initialize MCP client
 *   const mcp = new SimpleMCPClient();
 *   await mcp.registerServer(filesystemMCPServer);
 *
 *   // Discover MCP tools
 *   const mcpTools = await mcp.discoverTools();
 *
 *   // Combine with standard tools
 *   const allTools = [...standardTools, ...mcpTools];
 *
 *   // Run agent with combined tools
 *   const result = await runAgent(
 *     'List all TypeScript files in the src directory',
 *     allTools
 *   );
 *
 *   console.log(result.response);
 *
 *   // Clean up
 *   await mcp.close();
 * }
 * ```
 *
 * Key insight (Report 10):
 * MCP enables tool sharing across the ecosystem.
 * An agent using MCP can leverage tools from any MCP-compatible server.
 */

// =============================================================================
// Tool Composition Patterns
// =============================================================================

/**
 * Compose multiple MCP servers into a unified tool set.
 *
 * Derivation (Ashby's Requisite Variety):
 * "Tool variety must match task variety.
 * Composing MCP servers expands the agent's action space."
 */
export async function composeTools(
  standardTools: Tool[],
  mcpServers: MCPServer[]
): Promise<Tool[]> {
  const client = new SimpleMCPClient();

  for (const server of mcpServers) {
    await client.registerServer(server);
  }

  const mcpTools = await client.discoverTools();

  // Standard tools + MCP tools
  return [...standardTools, ...mcpTools];
}

/**
 * Filter tools by capability for focused agents.
 *
 * Derivation (Report 11):
 * "Claude Code uses read-only tools for exploration,
 * full tools for implementation. Match tools to task phase."
 */
export function filterToolsByCapability(
  tools: Tool[],
  capabilities: ('read' | 'write' | 'execute')[]
): Tool[] {
  const readPatterns = /read|list|search|get|query/i;
  const writePatterns = /write|create|update|delete|execute|run/i;
  const executePatterns = /execute|run|command|shell/i;

  return tools.filter(tool => {
    const name = tool.definition.name;

    if (capabilities.includes('read') && readPatterns.test(name)) return true;
    if (capabilities.includes('write') && writePatterns.test(name)) return true;
    if (capabilities.includes('execute') && executePatterns.test(name)) return true;

    return false;
  });
}

