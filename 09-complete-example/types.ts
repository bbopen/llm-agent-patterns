/**
 * types.ts - Section 09 Types
 *
 * Derivation:
 * - This module provides types specific to the complete example
 * - It bridges the teaching examples from earlier sections with
 *   a production-ready implementation
 *
 * Note: In a real production system, you would use a single
 * consistent type system. This file exists because the complete
 * example uses richer types than the minimal examples in sections 01-08.
 */

// =============================================================================
// Tool Types
// =============================================================================

/**
 * Tool definition (LLM-facing schema).
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: false;
  };
}

/**
 * Tool result for internal use.
 * Richer than the simple ToolResult in section 02.
 */
export interface InternalToolResult {
  success: boolean;
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  terminal?: boolean;
}

/**
 * Tool executor function.
 */
export type InternalToolExecutor = (
  input: Record<string, unknown>
) => Promise<InternalToolResult>;

/**
 * Complete tool with definition and executor.
 */
export interface InternalTool {
  name: string;
  description: string;
  inputSchema: ToolDefinition['inputSchema'];
  execute: InternalToolExecutor;
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Simplified event for section 09.
 * This is less formal than the event-store.ts events but
 * sufficient for the complete example.
 */
export type SimpleAgentEvent =
  | { type: 'decision'; decision: string; reasoning: string; timestamp: number }
  | { type: 'tool_call'; tool: string; input: Record<string, unknown>; timestamp: number }
  | { type: 'tool_result'; tool: string; result: InternalToolResult; timestamp: number }
  | { type: 'error'; message: string; context: Record<string, unknown>; timestamp: number };

// =============================================================================
// Message Types
// =============================================================================

/**
 * Message in conversation.
 */
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// =============================================================================
// LLM Types
// =============================================================================

/**
 * LLM tool definition format.
 */
export interface LLMTool {
  name: string;
  description: string;
  input_schema: unknown;
}

/**
 * LLM response format.
 */
export interface LLMResponse {
  content: Array<{
    type: 'text' | 'tool_use';
    text?: string;
    name?: string;
    input?: Record<string, unknown>;
    id?: string;
  }>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  stop_reason?: string;
}

/**
 * LLM client interface.
 */
export interface LLMClient {
  chat(params: {
    model: string;
    messages: Message[];
    tools?: LLMTool[];
    maxTokens?: number;
  }): Promise<LLMResponse>;
}

// =============================================================================
// Agent Result
// =============================================================================

/**
 * Agent execution result.
 */
export interface AgentResult {
  result: string;
  success: boolean;
  metrics: {
    iterations: number;
    tokensUsed: number;
    durationMs: number;
    toolCalls: number;
  };
  events: SimpleAgentEvent[];
  errors?: string[];
}
