/**
 * sub-agent.ts - Worker/Sub-Agent Implementation
 *
 * Derivation:
 * - Report 26: "Workers are terminal—they execute and return"
 * - Report 28: "Single-level: coordinator spawns workers, workers don't spawn"
 * - Wiener (1948): "Control through bounded feedback loops"
 *
 * Workers are specialized agents that execute specific tasks.
 * They have limited scope and NEVER delegate to other workers.
 */

import { Tool } from '../02-tool-design/tool-types';

// =============================================================================
// Types
// =============================================================================

/**
 * Worker configuration.
 */
export interface WorkerConfig {
  /** Worker type/specialization */
  type: WorkerType;

  /** System prompt for the worker */
  systemPrompt: string;

  /** Tools available to this worker */
  tools: Tool[];

  /** Maximum iterations (agent loop turns) */
  maxIterations: number;

  /** Maximum tokens for this worker */
  maxTokens: number;

  /** Timeout in milliseconds */
  timeout: number;

  /** Whether to include reasoning in output */
  includeReasoning?: boolean;
}

/**
 * Worker types for specialization.
 */
export type WorkerType =
  | 'researcher'
  | 'implementer'
  | 'reviewer'
  | 'tester'
  | 'documenter'
  | 'general';

/**
 * Worker execution result.
 */
export interface WorkerOutput {
  /** Whether execution succeeded */
  success: boolean;

  /** Output from the worker */
  output: string;

  /** Reasoning/thinking (if enabled) */
  reasoning?: string;

  /** Error message if failed */
  error?: string;

  /** Tokens consumed */
  tokensUsed: number;

  /** Execution duration */
  durationMs: number;

  /** Iterations performed */
  iterations: number;

  /** Artifacts produced (files, code, etc.) */
  artifacts?: WorkerArtifact[];
}

/**
 * Artifact produced by a worker.
 */
export interface WorkerArtifact {
  type: 'file' | 'code' | 'data' | 'document';
  name: string;
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * LLM client interface (minimal for workers).
 */
export interface WorkerLLMClient {
  chat(params: {
    messages: Array<{ role: string; content: string }>;
    tools?: Tool[];
    maxTokens?: number;
  }): Promise<{
    content: string;
    toolCalls?: Array<{
      name: string;
      input: Record<string, unknown>;
    }>;
    usage?: { totalTokens: number };
  }>;
}

// =============================================================================
// Worker Implementation
// =============================================================================

/**
 * Terminal worker that executes tasks without delegation.
 *
 * Derivation (Bounded Execution):
 * "Workers have hard limits: iterations, tokens, time.
 * They execute their task and return. No spawning.
 * This ensures predictable resource consumption."
 */
export class Worker {
  private config: WorkerConfig;
  private client: WorkerLLMClient;
  private toolMap: Map<string, Tool>;

  constructor(client: WorkerLLMClient, config: WorkerConfig) {
    this.client = client;
    this.config = config;
    this.toolMap = new Map(config.tools.map(t => [t.definition.name, t]));
  }

  /**
   * Execute a task.
   *
   * Workers are TERMINAL—they execute and return, never delegate.
   */
  async execute(task: string): Promise<WorkerOutput> {
    const startTime = Date.now();
    let tokensUsed = 0;
    let iterations = 0;
    const artifacts: WorkerArtifact[] = [];
    const reasoning: string[] = [];

    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: this.config.systemPrompt },
      { role: 'user', content: task },
    ];

    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Worker timeout: ${this.config.timeout}ms`)),
          this.config.timeout
        );
      });

      // Execute with timeout
      const result = await Promise.race([
        this.runLoop(messages, artifacts, reasoning, (tokens) => {
          tokensUsed += tokens;
        }, () => {
          iterations++;
          return iterations < this.config.maxIterations;
        }),
        timeoutPromise,
      ]);

      return {
        success: true,
        output: result,
        reasoning: this.config.includeReasoning ? reasoning.join('\n') : undefined,
        tokensUsed,
        durationMs: Date.now() - startTime,
        iterations,
        artifacts: artifacts.length > 0 ? artifacts : undefined,
      };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: String(error),
        tokensUsed,
        durationMs: Date.now() - startTime,
        iterations,
        artifacts: artifacts.length > 0 ? artifacts : undefined,
      };
    }
  }

  /**
   * Run the agent loop.
   */
  private async runLoop(
    messages: Array<{ role: string; content: string }>,
    artifacts: WorkerArtifact[],
    reasoning: string[],
    onTokens: (tokens: number) => void,
    canContinue: () => boolean
  ): Promise<string> {
    while (canContinue()) {
      // Call LLM
      const response = await this.client.chat({
        messages,
        tools: this.config.tools,
        maxTokens: this.config.maxTokens,
      });

      if (response.usage) {
        onTokens(response.usage.totalTokens);
      }

      // Check for tool calls
      if (!response.toolCalls || response.toolCalls.length === 0) {
        // No tool calls = done
        return response.content;
      }

      // Execute tools
      for (const toolCall of response.toolCalls) {
        const tool = this.toolMap.get(toolCall.name);

        if (!tool) {
          messages.push({
            role: 'assistant',
            content: `Tool not found: ${toolCall.name}`,
          });
          continue;
        }

        // Track reasoning
        if (this.config.includeReasoning) {
          reasoning.push(`Using tool: ${toolCall.name}`);
        }

        try {
          const result = await tool.execute(toolCall.input);

          // Check for artifacts in result
          if (result && typeof result === 'object' && 'artifact' in (result as object)) {
            artifacts.push((result as { artifact: WorkerArtifact }).artifact);
          }

          messages.push({
            role: 'assistant',
            content: `Tool ${toolCall.name} result: ${JSON.stringify(result)}`,
          });
        } catch (error) {
          messages.push({
            role: 'assistant',
            content: `Tool ${toolCall.name} error: ${error}`,
          });
        }
      }
    }

    // Exceeded iterations - return last response
    return messages[messages.length - 1]?.content || 'Max iterations reached';
  }
}

// =============================================================================
// Worker Factory
// =============================================================================

/**
 * Pre-configured worker types.
 *
 * Derivation (Specialization):
 * "Different tasks need different capabilities.
 * Researchers need search tools. Implementers need file tools.
 * Specialization improves quality and reduces errors."
 */
export const WorkerTemplates: Record<WorkerType, Partial<WorkerConfig>> = {
  researcher: {
    type: 'researcher',
    systemPrompt: `You are a research specialist. Your job is to find information,
analyze sources, and provide comprehensive summaries. Focus on accuracy and
relevance. Always cite your sources.`,
    maxIterations: 10,
    maxTokens: 4000,
    timeout: 60000,
  },

  implementer: {
    type: 'implementer',
    systemPrompt: `You are an implementation specialist. Your job is to write code
that solves specific problems. Focus on correctness, clarity, and following
established patterns. Always test your implementations.`,
    maxIterations: 15,
    maxTokens: 8000,
    timeout: 120000,
  },

  reviewer: {
    type: 'reviewer',
    systemPrompt: `You are a code review specialist. Your job is to analyze code
for bugs, security issues, and improvements. Be thorough but constructive.
Prioritize issues by severity.`,
    maxIterations: 5,
    maxTokens: 4000,
    timeout: 30000,
  },

  tester: {
    type: 'tester',
    systemPrompt: `You are a testing specialist. Your job is to write and run tests
that verify correctness. Focus on edge cases, error conditions, and
comprehensive coverage.`,
    maxIterations: 10,
    maxTokens: 6000,
    timeout: 90000,
  },

  documenter: {
    type: 'documenter',
    systemPrompt: `You are a documentation specialist. Your job is to write clear,
accurate documentation. Focus on explaining the "why" not just the "what".
Include examples where helpful.`,
    maxIterations: 5,
    maxTokens: 4000,
    timeout: 30000,
  },

  general: {
    type: 'general',
    systemPrompt: `You are a general-purpose assistant. Complete the given task
to the best of your ability. Be thorough and accurate.`,
    maxIterations: 10,
    maxTokens: 4000,
    timeout: 60000,
  },
};

/**
 * Create a worker with template defaults.
 */
export function createWorker(
  client: WorkerLLMClient,
  type: WorkerType,
  tools: Tool[],
  overrides: Partial<WorkerConfig> = {}
): Worker {
  const template = WorkerTemplates[type];

  return new Worker(client, {
    ...template,
    type,
    tools,
    systemPrompt: template.systemPrompt || '',
    maxIterations: template.maxIterations || 10,
    maxTokens: template.maxTokens || 4000,
    timeout: template.timeout || 60000,
    ...overrides,
  });
}

// =============================================================================
// Worker Pool
// =============================================================================

/**
 * Pool of workers for parallel execution.
 *
 * Derivation (Resource Management):
 * "Pools prevent unbounded worker creation.
 * Reuse workers when possible. Limit concurrency."
 */
export class WorkerPool {
  private client: WorkerLLMClient;
  private tools: Map<WorkerType, Tool[]>;
  private maxConcurrency: number;
  private activeWorkers = 0;
  private queue: Array<{
    task: { type: WorkerType; description: string };
    resolve: (result: WorkerOutput) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(
    client: WorkerLLMClient,
    tools: Map<WorkerType, Tool[]>,
    maxConcurrency: number = 3
  ) {
    this.client = client;
    this.tools = tools;
    this.maxConcurrency = maxConcurrency;
  }

  /**
   * Submit a task to the pool.
   */
  async submit(
    type: WorkerType,
    description: string
  ): Promise<WorkerOutput> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        task: { type, description },
        resolve,
        reject,
      });
      this.processQueue();
    });
  }

  /**
   * Submit multiple tasks and wait for all.
   */
  async submitAll(
    tasks: Array<{ type: WorkerType; description: string }>
  ): Promise<WorkerOutput[]> {
    return Promise.all(
      tasks.map(task => this.submit(task.type, task.description))
    );
  }

  /**
   * Process queued tasks.
   */
  private processQueue(): void {
    while (
      this.queue.length > 0 &&
      this.activeWorkers < this.maxConcurrency
    ) {
      const item = this.queue.shift();
      if (!item) break;

      this.activeWorkers++;

      const tools = this.tools.get(item.task.type) || [];
      const worker = createWorker(this.client, item.task.type, tools);

      worker
        .execute(item.task.description)
        .then(item.resolve)
        .catch(item.reject)
        .finally(() => {
          this.activeWorkers--;
          this.processQueue();
        });
    }
  }

  /**
   * Get pool status.
   */
  getStatus(): {
    activeWorkers: number;
    queuedTasks: number;
    maxConcurrency: number;
  } {
    return {
      activeWorkers: this.activeWorkers,
      queuedTasks: this.queue.length,
      maxConcurrency: this.maxConcurrency,
    };
  }

  /**
   * Wait for all tasks to complete.
   */
  async drain(): Promise<void> {
    while (this.activeWorkers > 0 || this.queue.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

// =============================================================================
// Usage Example
// =============================================================================

/**
 * Example: Using workers for specialized tasks.
 *
 * ```typescript
 * import { createWorker, WorkerPool } from './sub-agent';
 *
 * // Create specialized workers
 * const researcher = createWorker(client, 'researcher', [webSearch, readDocs]);
 * const implementer = createWorker(client, 'implementer', [readFile, writeFile]);
 * const reviewer = createWorker(client, 'reviewer', [readFile, analyzeCode]);
 *
 * // Execute research task
 * const research = await researcher.execute(
 *   'Research best practices for error handling in TypeScript'
 * );
 *
 * // Use research to implement
 * const implementation = await implementer.execute(
 *   `Implement error handling based on this research: ${research.output}`
 * );
 *
 * // Review the implementation
 * const review = await reviewer.execute(
 *   `Review this implementation: ${implementation.output}`
 * );
 *
 * // Or use a pool for parallel execution
 * const pool = new WorkerPool(client, toolsMap, 3);
 *
 * const results = await pool.submitAll([
 *   { type: 'researcher', description: 'Research topic A' },
 *   { type: 'researcher', description: 'Research topic B' },
 *   { type: 'researcher', description: 'Research topic C' },
 * ]);
 * ```
 */

