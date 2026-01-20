/**
 * context-manager.ts - Context Window Management
 *
 * Derivation:
 * - Report 28: "50KB per request × 20 interactions = 1MB of stale context"
 * - Report 11: "Context management is critical for long-running agents"
 * - LLM Limits: Hard caps on context size require active management
 *
 * Context windows are finite and expensive.
 * Active management keeps relevant information in scope.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Content block in a message.
 */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

/**
 * Message in the conversation.
 */
export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

/**
 * Token count result.
 */
export interface TokenCount {
  total: number;
  byMessage: number[];
}

/**
 * Compression strategy.
 */
export type CompressionStrategy =
  | 'truncate'     // Remove oldest messages
  | 'summarize'    // Summarize old messages
  | 'selective'    // Remove low-value messages
  | 'hybrid';      // Combine strategies

/**
 * Context manager configuration.
 */
export interface ContextConfig {
  /** Maximum tokens allowed */
  maxTokens: number;

  /** Target tokens after compression */
  targetTokens: number;

  /** Minimum messages to keep */
  minMessages: number;

  /** Compression strategy */
  strategy: CompressionStrategy;

  /** Token estimator function */
  tokenEstimator?: (text: string) => number;
}

// =============================================================================
// Token Estimation
// =============================================================================

/**
 * Simple token estimation (4 chars ≈ 1 token for English).
 *
 * For production, use tiktoken or model-specific tokenizer.
 */
export function estimateTokens(text: string): number {
  // Conservative estimate: ~4 characters per token
  return Math.ceil(text.length / 4);
}

/**
 * Count tokens in a message.
 */
export function countMessageTokens(
  message: Message,
  estimator: (text: string) => number = estimateTokens
): number {
  if (typeof message.content === 'string') {
    return estimator(message.content);
  }

  return message.content.reduce((sum, block) => {
    switch (block.type) {
      case 'text':
        return sum + estimator(block.text);
      case 'tool_use':
        return sum + estimator(JSON.stringify(block.input)) + estimator(block.name);
      case 'tool_result':
        return sum + estimator(block.content);
      default:
        return sum;
    }
  }, 0);
}

/**
 * Count tokens across all messages.
 */
export function countTotalTokens(
  messages: Message[],
  estimator: (text: string) => number = estimateTokens
): TokenCount {
  const byMessage = messages.map(m => countMessageTokens(m, estimator));
  return {
    total: byMessage.reduce((a, b) => a + b, 0),
    byMessage,
  };
}

// =============================================================================
// Context Manager
// =============================================================================

/**
 * Manages context window to stay within limits.
 *
 * Derivation (Report 28):
 * "Context pollution is real. Old tool results are noise, not signal.
 * Active management keeps the model focused on relevant information."
 */
export class ContextManager {
  private config: ContextConfig;
  private messages: Message[] = [];
  private tokenEstimator: (text: string) => number;

  constructor(config: Partial<ContextConfig> = {}) {
    this.config = {
      maxTokens: 100_000,
      targetTokens: 80_000,
      minMessages: 4,
      strategy: 'hybrid',
      ...config,
    };
    this.tokenEstimator = config.tokenEstimator || estimateTokens;
  }

  /**
   * Add a message to the context.
   * Compresses if needed to stay within limits.
   */
  add(message: Message): { compressed: boolean; removedCount: number } {
    const newTokens = countMessageTokens(message, this.tokenEstimator);
    const currentTokens = this.getCurrentTokens();

    let compressed = false;
    let removedCount = 0;

    // Check if adding would exceed limit
    if (currentTokens + newTokens > this.config.maxTokens) {
      const result = this.compress(newTokens);
      compressed = result.compressed;
      removedCount = result.removedCount;
    }

    this.messages.push(message);

    return { compressed, removedCount };
  }

  /**
   * Compress context to make room for new content.
   */
  private compress(neededTokens: number): { compressed: boolean; removedCount: number } {
    const targetTokens = this.config.targetTokens - neededTokens;

    switch (this.config.strategy) {
      case 'truncate':
        return this.truncateOldest(targetTokens);
      case 'summarize':
        return this.summarizeOld(targetTokens);
      case 'selective':
        return this.selectiveRemove(targetTokens);
      case 'hybrid':
      default:
        return this.hybridCompress(targetTokens);
    }
  }

  /**
   * Strategy: Remove oldest messages.
   */
  private truncateOldest(targetTokens: number): { compressed: boolean; removedCount: number } {
    let removedCount = 0;

    while (
      this.getCurrentTokens() > targetTokens &&
      this.messages.length > this.config.minMessages
    ) {
      this.messages.shift();
      removedCount++;
    }

    return { compressed: removedCount > 0, removedCount };
  }

  /**
   * Strategy: Summarize old messages.
   */
  private summarizeOld(targetTokens: number): { compressed: boolean; removedCount: number } {
    if (this.messages.length <= this.config.minMessages + 1) {
      // Not enough messages to summarize
      return this.truncateOldest(targetTokens);
    }

    // Find messages to summarize (keep last minMessages)
    const toSummarize = this.messages.slice(0, -this.config.minMessages);
    const toKeep = this.messages.slice(-this.config.minMessages);

    if (toSummarize.length === 0) {
      return { compressed: false, removedCount: 0 };
    }

    // Create summary message
    const summary = this.createSummary(toSummarize);

    this.messages = [summary, ...toKeep];

    return { compressed: true, removedCount: toSummarize.length };
  }

  /**
   * Strategy: Remove low-value messages.
   */
  private selectiveRemove(targetTokens: number): { compressed: boolean; removedCount: number } {
    // Score messages by value
    const scored = this.messages.map((m, i) => ({
      message: m,
      index: i,
      score: this.scoreMessage(m, i),
      tokens: countMessageTokens(m, this.tokenEstimator),
    }));

    // Sort by score (lowest first for removal)
    scored.sort((a, b) => a.score - b.score);

    // Remove lowest-scored until under target
    let currentTokens = this.getCurrentTokens();
    let removedCount = 0;
    const toRemove = new Set<number>();

    for (const item of scored) {
      if (currentTokens <= targetTokens) break;
      if (this.messages.length - toRemove.size <= this.config.minMessages) break;

      toRemove.add(item.index);
      currentTokens -= item.tokens;
      removedCount++;
    }

    // Remove marked messages
    this.messages = this.messages.filter((_, i) => !toRemove.has(i));

    return { compressed: removedCount > 0, removedCount };
  }

  /**
   * Strategy: Hybrid approach.
   */
  private hybridCompress(targetTokens: number): { compressed: boolean; removedCount: number } {
    // First, try selective removal of low-value messages
    const selective = this.selectiveRemove(targetTokens);

    if (this.getCurrentTokens() <= targetTokens) {
      return selective;
    }

    // If still over, summarize old messages
    const summary = this.summarizeOld(targetTokens);

    return {
      compressed: selective.compressed || summary.compressed,
      removedCount: selective.removedCount + summary.removedCount,
    };
  }

  /**
   * Score a message for value (higher = more valuable).
   */
  private scoreMessage(message: Message, index: number): number {
    let score = 0;

    // Recency bonus (newer = more valuable)
    const recencyScore = index / Math.max(this.messages.length, 1);
    score += recencyScore * 50;

    // Type-based scoring
    if (typeof message.content === 'string') {
      // User messages are generally important
      if (message.role === 'user') {
        score += 30;
      }
    } else {
      for (const block of message.content) {
        switch (block.type) {
          case 'text':
            // Short text is usually important (decisions, explanations)
            if (block.text.length < 500) score += 20;
            break;
          case 'tool_use':
            // Tool calls are moderately important
            score += 15;
            break;
          case 'tool_result':
            // Tool results decay in value over time
            // Errors are more valuable (learning opportunity)
            if (block.is_error) {
              score += 25;
            } else {
              score += 5;
            }
            break;
        }
      }
    }

    return score;
  }

  /**
   * Create a summary message from multiple messages.
   */
  private createSummary(messages: Message[]): Message {
    // Extract key information
    const toolCalls = new Set<string>();
    const errors: string[] = [];
    let userRequests = 0;

    for (const message of messages) {
      if (typeof message.content === 'string') {
        if (message.role === 'user') userRequests++;
        continue;
      }

      for (const block of message.content) {
        if (block.type === 'tool_use') {
          toolCalls.add(block.name);
        } else if (block.type === 'tool_result' && block.is_error) {
          errors.push(block.content.substring(0, 100));
        }
      }
    }

    const summaryText = [
      `[Context Summary: ${messages.length} messages compressed]`,
      toolCalls.size > 0 ? `Tools used: ${Array.from(toolCalls).join(', ')}` : null,
      errors.length > 0 ? `Errors encountered: ${errors.length}` : null,
      userRequests > 0 ? `User interactions: ${userRequests}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    return {
      role: 'user',
      content: summaryText,
    };
  }

  /**
   * Get current token count.
   */
  getCurrentTokens(): number {
    return countTotalTokens(this.messages, this.tokenEstimator).total;
  }

  /**
   * Get all messages.
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * Get message count.
   */
  getMessageCount(): number {
    return this.messages.length;
  }

  /**
   * Get context utilization percentage.
   */
  getUtilization(): number {
    return (this.getCurrentTokens() / this.config.maxTokens) * 100;
  }

  /**
   * Check if context is near capacity.
   */
  isNearCapacity(threshold: number = 0.8): boolean {
    return this.getCurrentTokens() >= this.config.maxTokens * threshold;
  }

  /**
   * Clear all messages.
   */
  clear(): void {
    this.messages = [];
  }

  /**
   * Set messages directly (for restoration).
   */
  setMessages(messages: Message[]): void {
    this.messages = [...messages];
  }
}

// =============================================================================
// Context Snapshots
// =============================================================================

/**
 * Snapshot of context state for checkpointing.
 */
export interface ContextSnapshot {
  timestamp: number;
  messages: Message[];
  tokenCount: number;
  messageCount: number;
}

/**
 * Create a snapshot of the current context.
 */
export function createContextSnapshot(manager: ContextManager): ContextSnapshot {
  return {
    timestamp: Date.now(),
    messages: manager.getMessages(),
    tokenCount: manager.getCurrentTokens(),
    messageCount: manager.getMessageCount(),
  };
}

/**
 * Restore context from a snapshot.
 */
export function restoreContextSnapshot(
  manager: ContextManager,
  snapshot: ContextSnapshot
): void {
  manager.setMessages(snapshot.messages);
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a context manager with default configuration.
 */
export function createContextManager(
  maxTokens: number = 100_000,
  strategy: CompressionStrategy = 'hybrid'
): ContextManager {
  return new ContextManager({
    maxTokens,
    targetTokens: Math.floor(maxTokens * 0.8),
    minMessages: 4,
    strategy,
  });
}

