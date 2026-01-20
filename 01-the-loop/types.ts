/**
 * types.ts - Core Type Definitions
 *
 * Derivation:
 * - Report 10 (Tool Design): Tool schemas should use JSON Schema with strict validation
 * - Report 11 (Claude Code): Unified content model where tool uses are content items
 * - Report 28 (Bitter Lesson): Minimal interface, maximum capability
 *
 * These types define the contract between your code and the LLM.
 * They're intentionally minimal—the loop doesn't need more.
 */

import { z } from 'zod';

// =============================================================================
// Message Types
// =============================================================================

/**
 * Role in the conversation.
 * Note: Tool results come back as 'user' role with tool_result content.
 */
export type Role = 'user' | 'assistant';

/**
 * Content types in a message.
 * Following Anthropic's unified content model where tool_use and tool_result
 * are content items, not separate message types.
 *
 * Note: tool_use input is `unknown` to match Anthropic SDK types.
 */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

/**
 * A message in the conversation.
 */
export interface Message {
  role: Role;
  content: string | ContentBlock[];
}

// =============================================================================
// Tool Types
// =============================================================================

/**
 * JSON Schema subset for tool parameters.
 * Using Zod for runtime validation, but tools are defined with JSON Schema
 * for LLM consumption.
 */
export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  enum?: string[];
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
  required?: string[];
}

/**
 * Tool definition for the LLM.
 *
 * Derivation (Report 10):
 * - name: 1-128 chars, A-Za-z0-9_-.
 * - description: Clear purpose and expected behavior
 * - inputSchema: additionalProperties: false for strict validation
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required?: string[];
    additionalProperties?: false;
  };
}

/**
 * A tool call requested by the LLM.
 */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Result of executing a tool.
 */
export interface ToolResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/**
 * Tool executor function type.
 * Tools are async functions that take validated input and return string output.
 */
export type ToolExecutor = (input: Record<string, unknown>) => Promise<string>;

/**
 * Complete tool: definition + executor.
 */
export interface Tool {
  definition: ToolDefinition;
  execute: ToolExecutor;
}

// =============================================================================
// LLM Response Types
// =============================================================================

/**
 * Why the LLM stopped generating.
 * Includes null to match Anthropic SDK types.
 */
export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | null;

/**
 * Response from the LLM.
 * Uses snake_case to match Anthropic SDK types.
 */
export interface LLMResponse {
  content: ContentBlock[];
  stop_reason: StopReason;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// =============================================================================
// Agent Types
// =============================================================================

/**
 * Agent configuration.
 *
 * Derivation (Report 26):
 * - maxIterations: Bounded execution prevents runaway costs
 * - maxTokens: Prevent context exhaustion
 */
export interface AgentConfig {
  /** Maximum loop iterations before forced termination */
  maxIterations: number;

  /** Maximum tokens per LLM call */
  maxTokens: number;

  /** Model to use */
  model: string;

  /** System prompt (optional, but recommended) */
  systemPrompt?: string;
}

/**
 * Default configuration.
 *
 * Derivation (Production experience):
 * - 50 iterations handles most tasks without runaway
 * - 4096 tokens balances capability with cost
 */
export const DEFAULT_CONFIG: AgentConfig = {
  maxIterations: 50,
  maxTokens: 4096,
  model: 'claude-sonnet-4-20250514',
};

/**
 * Agent result.
 */
export interface AgentResult {
  /** Final response from the agent */
  response: string;

  /** Whether the agent completed successfully */
  success: boolean;

  /** Number of loop iterations */
  iterations: number;

  /** Total tokens used */
  totalTokens: {
    input: number;
    output: number;
  };

  /** Full message history for debugging */
  messages: Message[];
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Zod schema for tool call validation.
 * Use this to validate LLM-generated tool calls before execution.
 */
export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  input: z.record(z.unknown()),
});

/**
 * Extract tool calls from LLM response content.
 */
export function extractToolCalls(content: ContentBlock[]): ToolCall[] {
  return content
    .filter((block): block is ContentBlock & { type: 'tool_use' } =>
      block.type === 'tool_use'
    )
    .map(block => ({
      id: block.id,
      name: block.name,
      input: (block.input as Record<string, unknown>) ?? {},
    }));
}

/**
 * Extract text from LLM response content.
 */
export function extractText(content: ContentBlock[]): string {
  return content
    .filter((block): block is ContentBlock & { type: 'text' } =>
      block.type === 'text'
    )
    .map(block => block.text)
    .join('\n');
}

/**
 * Check if response has tool calls.
 */
export function hasToolCalls(response: LLMResponse): boolean {
  return response.stop_reason === 'tool_use' ||
    response.content.some(block => block.type === 'tool_use');
}
