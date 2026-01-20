/**
 * ephemeral-results.ts - Context Hygiene Pattern
 *
 * Derivation:
 * - Report 28: "50KB per request × 20 interactions = 1MB of stale context"
 * - Report 25 (Huntley): "Memory persists through filesystem, not in-context"
 * - Context rot research: Old state causes hallucination
 *
 * Ephemeral messages keep only recent tool results, preventing context pollution.
 */

import { Tool, ToolResult, ToolRegistry } from './tool-types';

// =============================================================================
// Types
// =============================================================================

/**
 * Content block in a message (simplified from 01-the-loop/types.ts).
 */
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

/**
 * Message in the conversation.
 */
interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

/**
 * Tracked tool result with metadata for ephemeral management.
 */
interface TrackedResult {
  toolUseId: string;
  toolName: string;
  content: string;
  timestamp: number;
  isError?: boolean;
}

// =============================================================================
// Ephemeral Result Manager
// =============================================================================

/**
 * Manages ephemeral tool results to maintain context hygiene.
 *
 * Derivation (Report 28):
 * "When the model has that freedom, something important happens.
 * If one approach fails, it routes around it. If a tool breaks,
 * it finds another path."
 *
 * Old tool results are noise, not signal. Keep only what's recent and relevant.
 */
export class EphemeralResultManager {
  /** Results grouped by tool name */
  private resultsByTool: Map<string, TrackedResult[]> = new Map();

  /** Tool registry for ephemeral config lookup */
  private toolRegistry: ToolRegistry;

  constructor(tools: Tool[]) {
    this.toolRegistry = new Map(
      tools.map(t => [t.definition.name, t])
    );
  }

  /**
   * Track a new tool result.
   */
  trackResult(result: ToolResult & { toolName: string }): void {
    const existing = this.resultsByTool.get(result.toolName) || [];

    existing.push({
      toolUseId: result.toolUseId,
      toolName: result.toolName,
      content: result.content,
      timestamp: result.timestamp || Date.now(),
      isError: result.isError,
    });

    this.resultsByTool.set(result.toolName, existing);
  }

  /**
   * Get tool result IDs that should be removed from context.
   * These are results that exceed the ephemeral keepLast limit.
   */
  getExpiredResultIds(): Set<string> {
    const expired = new Set<string>();

    for (const [toolName, results] of this.resultsByTool) {
      const tool = this.toolRegistry.get(toolName);
      if (!tool?.ephemeral) continue;

      const keepLast = tool.ephemeral.keepLast;

      // Sort by timestamp, newest first
      const sorted = [...results].sort((a, b) => b.timestamp - a.timestamp);

      // Mark old results for removal
      for (let i = keepLast; i < sorted.length; i++) {
        const result = sorted[i];
        if (result) {
          expired.add(result.toolUseId);
        }
      }
    }

    return expired;
  }

  /**
   * Clean up tracked results, removing expired entries.
   */
  prune(): void {
    const expired = this.getExpiredResultIds();

    for (const [toolName, results] of this.resultsByTool) {
      const filtered = results.filter(r => !expired.has(r.toolUseId));
      this.resultsByTool.set(toolName, filtered);
    }
  }
}

// =============================================================================
// Message Filtering
// =============================================================================

/**
 * Filter messages to remove expired ephemeral results.
 *
 * This creates a new message array with old tool results removed,
 * maintaining context hygiene without mutating the original.
 */
export function filterEphemeralMessages(
  messages: Message[],
  expiredIds: Set<string>
): Message[] {
  if (expiredIds.size === 0) {
    return messages;
  }

  return messages.map(message => {
    // Skip if content is string (not tool results)
    if (typeof message.content === 'string') {
      return message;
    }

    // Filter out expired tool results
    const filteredContent = message.content.filter(block => {
      if (block.type === 'tool_result') {
        return !expiredIds.has(block.tool_use_id);
      }
      // Also remove corresponding tool_use blocks
      if (block.type === 'tool_use') {
        return !expiredIds.has(block.id);
      }
      return true;
    });

    // If all content was filtered, return empty array (will be cleaned later)
    return {
      ...message,
      content: filteredContent,
    };
  }).filter(message => {
    // Remove messages with no content
    if (typeof message.content === 'string') {
      return message.content.length > 0;
    }
    return message.content.length > 0;
  });
}

// =============================================================================
// Integrated Agent Loop with Ephemeral Support
// =============================================================================

/**
 * Example agent loop with ephemeral result management.
 *
 * This demonstrates how to integrate ephemeral results into the core loop
 * from 01-the-loop/minimal-agent.ts.
 */
export async function runAgentWithEphemeral(
  task: string,
  tools: Tool[],
  llm: { invoke: (messages: Message[], tools: Tool[]) => Promise<any> },
  config: { maxIterations: number }
): Promise<{ response: string; messages: Message[] }> {
  const ephemeralManager = new EphemeralResultManager(tools);
  const messages: Message[] = [{ role: 'user', content: task }];

  for (let i = 0; i < config.maxIterations; i++) {
    // Filter expired ephemeral results before sending to LLM
    const expiredIds = ephemeralManager.getExpiredResultIds();
    const filteredMessages = filterEphemeralMessages(messages, expiredIds);

    // Query LLM with cleaned context
    const response = await llm.invoke(filteredMessages, tools);

    // Add response to messages
    messages.push({
      role: 'assistant',
      content: response.content,
    });

    // Check for completion
    if (!response.toolCalls?.length) {
      return {
        response: extractText(response.content),
        messages: filteredMessages,
      };
    }

    // Execute tools and track results
    const results: ContentBlock[] = [];

    for (const call of response.toolCalls) {
      const tool = tools.find(t => t.definition.name === call.name);
      if (!tool) continue;

      try {
        const output = await tool.execute(call.input);

        // Track for ephemeral management
        ephemeralManager.trackResult({
          toolUseId: call.id,
          toolName: call.name,
          content: output,
          timestamp: Date.now(),
        });

        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: output,
        });
      } catch (error) {
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: `Error: ${error}`,
          is_error: true,
        });
      }
    }

    messages.push({ role: 'user', content: results });

    // Prune tracked results
    ephemeralManager.prune();
  }

  return {
    response: 'Max iterations reached',
    messages,
  };
}

// Helper to extract text from content blocks
function extractText(content: ContentBlock[]): string {
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('\n');
}

// =============================================================================
// Usage Example
// =============================================================================

/**
 * Example: Browser automation tool with ephemeral snapshots.
 *
 * ```typescript
 * const getBrowserState: Tool = createTool({
 *   name: 'get_browser_state',
 *   description: 'Get current browser DOM and screenshot',
 *   inputSchema: { type: 'object', properties: {}, additionalProperties: false },
 *   execute: async () => {
 *     // Returns 50KB+ of DOM/screenshot data
 *     return JSON.stringify({
 *       url: document.location.href,
 *       dom: document.body.innerHTML,
 *       screenshot: await captureScreenshot(),
 *     });
 *   },
 *   ephemeral: { keepLast: 3 },  // Only keep last 3 snapshots
 * });
 * ```
 *
 * Without ephemeral: 20 iterations × 50KB = 1MB of stale browser state
 * With ephemeral: 3 × 50KB = 150KB of relevant recent state
 */
