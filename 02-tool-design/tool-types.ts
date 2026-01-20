/**
 * tool-types.ts - Enhanced Tool Type Definitions
 *
 * Derivation:
 * - Report 10: Tool schemas should use JSON Schema with additionalProperties: false
 * - Report 28: Tools need ephemeral config for context hygiene
 * - Ashby (1956): Tool variety must match task variety
 *
 * These types extend the basic types from 01-the-loop with production features.
 */

import { z } from 'zod';

// =============================================================================
// Tool Schema Types
// =============================================================================

/**
 * JSON Schema property definition.
 * Subset of JSON Schema that LLMs understand well.
 */
export interface SchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: readonly string[];
  const?: string | number | boolean;
  default?: unknown;
  // String constraints
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  // Number constraints
  minimum?: number;
  maximum?: number;
  // Array constraints
  items?: SchemaProperty;
  minItems?: number;
  maxItems?: number;
  // Object constraints
  properties?: Record<string, SchemaProperty>;
  required?: readonly string[];
  additionalProperties?: false;
}

/**
 * Complete input schema for a tool.
 */
export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, SchemaProperty>;
  required?: readonly string[];
  additionalProperties?: false; // Always false for strict validation
}

// =============================================================================
// Tool Definition Types
// =============================================================================

/**
 * Ephemeral configuration for tools with large/frequent outputs.
 *
 * Derivation (Report 28):
 * "50KB per request × 20 interactions = 1MB of stale context.
 * Model loses coherence. Hallucinates elements that don't exist."
 */
export interface EphemeralConfig {
  /**
   * Keep only the last N results from this tool in context.
   * Older results are removed to prevent context pollution.
   *
   * @example
   * { keepLast: 3 } // Keep only 3 most recent browser snapshots
   */
  keepLast: number;
}

/**
 * Tool definition for the LLM.
 */
export interface ToolDefinition {
  /** Tool name: 1-128 chars, [A-Za-z0-9_-.] */
  name: string;

  /** Clear description of purpose and expected behavior */
  description: string;

  /** JSON Schema for input validation */
  inputSchema: ToolInputSchema;
}

/**
 * Tool executor function.
 * Takes validated input, returns string output.
 */
export type ToolExecutor<TInput = Record<string, unknown>> = (
  input: TInput
) => Promise<string>;

/**
 * Complete tool with optional ephemeral config.
 */
export interface Tool<TInput = Record<string, unknown>> {
  definition: ToolDefinition;
  execute: ToolExecutor<TInput>;

  /**
   * Optional ephemeral config for context hygiene.
   * If set, only keepLast results are retained in conversation history.
   */
  ephemeral?: EphemeralConfig;

  /**
   * Optional Zod schema for runtime input validation.
   * If provided, inputs are validated before execute() is called.
   */
  inputValidator?: z.ZodType<TInput>;
}

// =============================================================================
// Tool Result Types
// =============================================================================

/**
 * Result of executing a tool.
 */
export interface ToolResult {
  /** ID linking result to tool_use request */
  toolUseId: string;

  /** String content of the result */
  content: string;

  /** Whether the tool execution failed */
  isError?: boolean;

  /** Timestamp for ephemeral tracking */
  timestamp?: number;

  /** Tool name for ephemeral grouping */
  toolName?: string;
}

// =============================================================================
// Tool Builder Helpers
// =============================================================================

/**
 * Create a tool with type-safe input validation.
 *
 * @example
 * const searchTool = createTool({
 *   name: 'search',
 *   description: 'Search documents',
 *   inputSchema: { ... },
 *   inputValidator: z.object({ query: z.string() }),
 *   execute: async ({ query }) => { ... },
 * });
 */
export function createTool<TInput>(config: {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  inputValidator?: z.ZodType<TInput>;
  execute: ToolExecutor<TInput>;
  ephemeral?: EphemeralConfig;
}): Tool<TInput> {
  return {
    definition: {
      name: config.name,
      description: config.description,
      inputSchema: config.inputSchema,
    },
    execute: config.execute,
    inputValidator: config.inputValidator,
    ephemeral: config.ephemeral,
  };
}

/**
 * Validate tool input against its Zod schema.
 * Returns validated input or throws validation error.
 */
export function validateToolInput<TInput>(
  tool: Tool<TInput>,
  input: unknown
): TInput {
  if (!tool.inputValidator) {
    return input as TInput;
  }

  const result = tool.inputValidator.safeParse(input);
  if (!result.success) {
    throw new ToolValidationError(
      tool.definition.name,
      result.error.format()
    );
  }

  return result.data;
}

/**
 * Error thrown when tool input validation fails.
 */
export class ToolValidationError extends Error {
  constructor(
    public toolName: string,
    public validationErrors: z.ZodFormattedError<unknown>
  ) {
    super(`Tool "${toolName}" validation failed: ${JSON.stringify(validationErrors)}`);
    this.name = 'ToolValidationError';
  }
}

// =============================================================================
// Tool Collection Types
// =============================================================================

/**
 * Collection of tools indexed by name.
 */
export type ToolRegistry = Map<string, Tool>;

/**
 * Create a tool registry from an array of tools.
 */
export function createToolRegistry(tools: Tool[]): ToolRegistry {
  const registry = new Map<string, Tool>();

  for (const tool of tools) {
    if (registry.has(tool.definition.name)) {
      throw new Error(`Duplicate tool name: ${tool.definition.name}`);
    }
    registry.set(tool.definition.name, tool);
  }

  return registry;
}

/**
 * Get tool definitions formatted for LLM API.
 */
export function getToolDefinitions(registry: ToolRegistry): ToolDefinition[] {
  return Array.from(registry.values()).map(t => t.definition);
}
