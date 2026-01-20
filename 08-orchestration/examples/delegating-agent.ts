/**
 * delegating-agent.ts - Complete Orchestration Example
 *
 * Derivation:
 * - Simon (1962): "Complex systems decompose into manageable subsystems"
 * - Report 26: "Single-level delegation: coordinator -> workers"
 * - MapReduce: "Map to workers, reduce their results"
 *
 * This demonstrates a complete orchestration system where:
 * 1. A main agent receives complex tasks
 * 2. A coordinator decomposes and delegates
 * 3. Specialized workers execute subtasks
 * 4. Results are aggregated and returned
 *
 * Workers are TERMINAL—they never spawn other workers.
 */

import { Tool } from '../../02-tool-design/tool-types';
import {
  Coordinator,
  createCoordinator,
  Task,
  TaskType,
  WorkerResult,
  aggregateResults,
} from '../coordinator';
import {
  Worker,
  createWorker,
  WorkerPool,
  WorkerType,
  WorkerLLMClient,
} from '../sub-agent';

// =============================================================================
// Types
// =============================================================================

/**
 * Main agent configuration.
 */
export interface DelegatingAgentConfig {
  /** LLM client for all agents */
  client: WorkerLLMClient;

  /** Tools available by worker type */
  toolsByType: Map<WorkerType, Tool[]>;

  /** Maximum concurrent workers */
  maxConcurrency: number;

  /** Total budget constraints */
  budget: {
    maxTokens: number;
    maxTime: number;
    maxWorkers: number;
  };

  /** Custom task analyzer (optional) */
  taskAnalyzer?: {
    analyze(description: string): Promise<Task[]>;
    determineDependencies(tasks: Task[]): Task[];
    planExecution(tasks: Task[]): Task[][];
  };
}

/**
 * Delegation decision.
 */
interface DelegationDecision {
  shouldDelegate: boolean;
  reason: string;
  tasks?: Task[];
}

// =============================================================================
// Delegating Agent
// =============================================================================

/**
 * Main agent that delegates to workers.
 *
 * Derivation (Single-Level Architecture):
 * "The main agent decides WHAT needs to be done.
 * Workers decide HOW to do their specific task.
 * Workers never delegate—this is enforced, not suggested."
 */
export class DelegatingAgent {
  private config: DelegatingAgentConfig;
  private coordinator: Coordinator;
  private workerPool: WorkerPool;

  // Metrics
  private totalTasks = 0;
  private delegatedTasks = 0;
  private directTasks = 0;

  constructor(config: DelegatingAgentConfig) {
    this.config = config;

    // Create worker executor
    const workerExecutor = async (task: Task): Promise<WorkerResult> => {
      const workerType = this.mapTaskTypeToWorkerType(task.type);
      const tools = this.config.toolsByType.get(workerType) || [];
      const worker = createWorker(this.config.client, workerType, tools, {
        maxIterations: task.maxIterations,
        maxTokens: task.maxTokens,
      });

      const output = await worker.execute(task.description);

      return {
        taskId: task.id,
        success: output.success,
        output: output.output,
        error: output.error,
        tokensUsed: output.tokensUsed,
        durationMs: output.durationMs,
        artifacts: output.artifacts?.map(a => ({
          type: a.type as 'file' | 'data' | 'code',
          name: a.name,
          content: a.content,
        })),
      };
    };

    // Create coordinator
    this.coordinator = createCoordinator(workerExecutor, {
      maxConcurrency: config.maxConcurrency,
      aggregationStrategy: 'merge',
      budget: config.budget,
    });

    // Create worker pool for direct execution
    this.workerPool = new WorkerPool(
      config.client,
      config.toolsByType,
      config.maxConcurrency
    );
  }

  /**
   * Execute a task, delegating if appropriate.
   */
  async execute(task: string): Promise<{
    result: string;
    delegated: boolean;
    metrics: {
      totalTokens: number;
      totalTime: number;
      workersUsed: number;
    };
  }> {
    this.totalTasks++;

    // Decide whether to delegate
    const decision = await this.shouldDelegate(task);

    if (decision.shouldDelegate && decision.tasks) {
      this.delegatedTasks++;
      return this.executeDelegated(task, decision.tasks);
    }

    this.directTasks++;
    return this.executeDirect(task);
  }

  /**
   * Decide whether to delegate a task.
   *
   * Derivation (Decomposition Heuristics):
   * "Delegate when: multiple distinct subtasks,
   * different skills needed, or parallel opportunity.
   * Execute directly when: simple, single-skill, sequential."
   */
  private async shouldDelegate(task: string): Promise<DelegationDecision> {
    // Use LLM to analyze task complexity
    const response = await this.config.client.chat({
      messages: [
        {
          role: 'system',
          content: `You analyze tasks to determine if they should be decomposed.
A task should be decomposed if it:
1. Has multiple distinct subtasks
2. Requires different skills (research, implementation, review, etc.)
3. Has parts that can run in parallel

Respond with JSON: { "decompose": boolean, "reason": string, "subtasks": [{ "type": string, "description": string }] }
If decompose is false, subtasks should be empty.`,
        },
        {
          role: 'user',
          content: `Analyze this task: ${task}`,
        },
      ],
    });

    try {
      const analysis = JSON.parse(response.content);

      if (analysis.decompose && analysis.subtasks?.length > 0) {
        const tasks: Task[] = analysis.subtasks.map(
          (st: { type: string; description: string }, i: number) => ({
            id: `task-${Date.now()}-${i}`,
            type: this.inferTaskType(st.type),
            description: st.description,
            priority: 'medium' as const,
          })
        );

        return {
          shouldDelegate: true,
          reason: analysis.reason,
          tasks,
        };
      }

      return {
        shouldDelegate: false,
        reason: analysis.reason || 'Task is simple enough for direct execution',
      };
    } catch {
      // If parsing fails, don't delegate
      return {
        shouldDelegate: false,
        reason: 'Failed to analyze task complexity',
      };
    }
  }

  /**
   * Execute a delegated task through the coordinator.
   */
  private async executeDelegated(
    originalTask: string,
    tasks: Task[]
  ): Promise<{
    result: string;
    delegated: true;
    metrics: {
      totalTokens: number;
      totalTime: number;
      workersUsed: number;
    };
  }> {
    const startTime = Date.now();

    // Use coordinator to execute
    const { result, metrics } = await this.coordinator.execute(originalTask);

    return {
      result,
      delegated: true,
      metrics: {
        totalTokens: metrics.tokensUsed,
        totalTime: metrics.durationMs,
        workersUsed: metrics.tasksExecuted,
      },
    };
  }

  /**
   * Execute a task directly without delegation.
   */
  private async executeDirect(task: string): Promise<{
    result: string;
    delegated: false;
    metrics: {
      totalTokens: number;
      totalTime: number;
      workersUsed: number;
    };
  }> {
    const startTime = Date.now();

    // Use a general worker for direct execution
    const tools = this.config.toolsByType.get('general') || [];
    const worker = createWorker(this.config.client, 'general', tools);
    const output = await worker.execute(task);

    return {
      result: output.output,
      delegated: false,
      metrics: {
        totalTokens: output.tokensUsed,
        totalTime: output.durationMs,
        workersUsed: 1,
      },
    };
  }

  /**
   * Map task type to worker type.
   */
  private mapTaskTypeToWorkerType(taskType: TaskType): WorkerType {
    const mapping: Record<TaskType, WorkerType> = {
      research: 'researcher',
      implement: 'implementer',
      review: 'reviewer',
      test: 'tester',
      document: 'documenter',
      general: 'general',
    };
    return mapping[taskType] || 'general';
  }

  /**
   * Infer task type from string.
   */
  private inferTaskType(typeStr: string): TaskType {
    const lower = typeStr.toLowerCase();
    if (lower.includes('research') || lower.includes('find')) return 'research';
    if (lower.includes('implement') || lower.includes('build')) return 'implement';
    if (lower.includes('review') || lower.includes('check')) return 'review';
    if (lower.includes('test') || lower.includes('verify')) return 'test';
    if (lower.includes('document') || lower.includes('write')) return 'document';
    return 'general';
  }

  /**
   * Get agent metrics.
   */
  getMetrics(): {
    totalTasks: number;
    delegatedTasks: number;
    directTasks: number;
    delegationRate: number;
  } {
    return {
      totalTasks: this.totalTasks,
      delegatedTasks: this.delegatedTasks,
      directTasks: this.directTasks,
      delegationRate:
        this.totalTasks > 0 ? this.delegatedTasks / this.totalTasks : 0,
    };
  }

  /**
   * Reset coordinator state.
   */
  reset(): void {
    this.coordinator.reset();
    this.totalTasks = 0;
    this.delegatedTasks = 0;
    this.directTasks = 0;
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a delegating agent with defaults.
 */
export function createDelegatingAgent(
  client: WorkerLLMClient,
  tools: Tool[]
): DelegatingAgent {
  // Distribute tools by type (in practice, you'd have type-specific tools)
  const toolsByType = new Map<WorkerType, Tool[]>([
    ['researcher', tools.filter(t => ['search', 'read', 'fetch'].some(k => t.definition.name.includes(k)))],
    ['implementer', tools.filter(t => ['write', 'edit', 'execute'].some(k => t.definition.name.includes(k)))],
    ['reviewer', tools.filter(t => ['read', 'analyze'].some(k => t.definition.name.includes(k)))],
    ['tester', tools.filter(t => ['test', 'run', 'execute'].some(k => t.definition.name.includes(k)))],
    ['documenter', tools.filter(t => ['write', 'read'].some(k => t.definition.name.includes(k)))],
    ['general', tools],
  ]);

  return new DelegatingAgent({
    client,
    toolsByType,
    maxConcurrency: 3,
    budget: {
      maxTokens: 100000,
      maxTime: 300000,
      maxWorkers: 10,
    },
  });
}

// =============================================================================
// Specialized Orchestration Patterns
// =============================================================================

/**
 * Research-then-implement pattern.
 *
 * Derivation (Staged Execution):
 * "Some tasks have natural phases: first research, then implement.
 * Model this explicitly rather than hoping the agent figures it out."
 */
export class ResearchImplementReviewOrchestrator {
  private client: WorkerLLMClient;
  private tools: Map<WorkerType, Tool[]>;

  constructor(client: WorkerLLMClient, tools: Map<WorkerType, Tool[]>) {
    this.client = client;
    this.tools = tools;
  }

  async execute(task: string): Promise<{
    research: string;
    implementation: string;
    review: string;
    final: string;
  }> {
    // Phase 1: Research
    const researcher = createWorker(
      this.client,
      'researcher',
      this.tools.get('researcher') || []
    );
    const research = await researcher.execute(
      `Research the best approach for: ${task}`
    );

    // Phase 2: Implement (uses research)
    const implementer = createWorker(
      this.client,
      'implementer',
      this.tools.get('implementer') || []
    );
    const implementation = await implementer.execute(
      `Implement the following task using this research:\n\nTask: ${task}\n\nResearch: ${research.output}`
    );

    // Phase 3: Review (uses both)
    const reviewer = createWorker(
      this.client,
      'reviewer',
      this.tools.get('reviewer') || []
    );
    const review = await reviewer.execute(
      `Review this implementation:\n\nOriginal Task: ${task}\n\nImplementation: ${implementation.output}`
    );

    return {
      research: research.output,
      implementation: implementation.output,
      review: review.output,
      final: implementation.output, // Could incorporate review feedback
    };
  }
}

/**
 * Parallel research pattern.
 *
 * Derivation (Embarrassingly Parallel):
 * "When subtasks are independent, run them in parallel.
 * Research tasks are often independent—exploit this."
 */
export class ParallelResearchOrchestrator {
  private client: WorkerLLMClient;
  private tools: Tool[];
  private maxConcurrency: number;

  constructor(
    client: WorkerLLMClient,
    tools: Tool[],
    maxConcurrency: number = 3
  ) {
    this.client = client;
    this.tools = tools;
    this.maxConcurrency = maxConcurrency;
  }

  async research(topics: string[]): Promise<Map<string, string>> {
    const pool = new WorkerPool(
      this.client,
      new Map([['researcher', this.tools]]),
      this.maxConcurrency
    );

    const results = await pool.submitAll(
      topics.map(topic => ({
        type: 'researcher' as WorkerType,
        description: `Research: ${topic}`,
      }))
    );

    const researchResults = new Map<string, string>();
    topics.forEach((topic, i) => {
      researchResults.set(topic, results[i].output);
    });

    return researchResults;
  }
}

/**
 * Consensus pattern.
 *
 * Derivation (Redundancy for Reliability):
 * "Run the same task multiple times, take consensus.
 * Useful for critical decisions where accuracy matters more than cost."
 */
export class ConsensusOrchestrator {
  private client: WorkerLLMClient;
  private tools: Tool[];
  private replicas: number;

  constructor(
    client: WorkerLLMClient,
    tools: Tool[],
    replicas: number = 3
  ) {
    this.client = client;
    this.tools = tools;
    this.replicas = replicas;
  }

  async executeWithConsensus(
    task: string,
    workerType: WorkerType = 'general'
  ): Promise<{
    consensus: string;
    agreement: number;
    outputs: string[];
  }> {
    // Run task multiple times
    const workers = Array(this.replicas)
      .fill(null)
      .map(() => createWorker(this.client, workerType, this.tools));

    const results = await Promise.all(
      workers.map(w => w.execute(task))
    );

    const outputs = results.map(r => r.output);

    // Find consensus (simple majority)
    const votes = new Map<string, number>();
    for (const output of outputs) {
      const normalized = output.trim().toLowerCase();
      votes.set(normalized, (votes.get(normalized) || 0) + 1);
    }

    let maxVotes = 0;
    let consensus = outputs[0]; // Default to first
    for (const [output, count] of votes) {
      if (count > maxVotes) {
        maxVotes = count;
        // Find original (non-normalized) version
        consensus = outputs.find(
          o => o.trim().toLowerCase() === output
        ) || output;
      }
    }

    return {
      consensus,
      agreement: maxVotes / this.replicas,
      outputs,
    };
  }
}

// =============================================================================
// Usage Example
// =============================================================================

/**
 * Example: Complete delegating agent workflow.
 *
 * ```typescript
 * import { createDelegatingAgent, ResearchImplementReviewOrchestrator } from './delegating-agent';
 *
 * // Create LLM client (implementation depends on your API)
 * const client: WorkerLLMClient = {
 *   chat: async ({ messages, tools, maxTokens }) => {
 *     // Call your LLM API
 *     return { content: '...', toolCalls: [], usage: { totalTokens: 100 } };
 *   },
 * };
 *
 * // Define tools
 * const tools: Tool[] = [
 *   { name: 'search', description: 'Search the web', ... },
 *   { name: 'read_file', description: 'Read a file', ... },
 *   { name: 'write_file', description: 'Write a file', ... },
 * ];
 *
 * // Create delegating agent
 * const agent = createDelegatingAgent(client, tools);
 *
 * // Simple task - executed directly
 * const simple = await agent.execute('What is 2 + 2?');
 * console.log(simple.delegated); // false
 *
 * // Complex task - delegated to workers
 * const complex = await agent.execute(
 *   'Research TypeScript best practices, implement a utility library, and document it'
 * );
 * console.log(complex.delegated); // true
 * console.log(complex.metrics.workersUsed); // > 1
 *
 * // Or use specialized orchestrators
 * const orchestrator = new ResearchImplementReviewOrchestrator(client, toolsByType);
 * const result = await orchestrator.execute('Build a rate limiter');
 * console.log(result.research);       // Research findings
 * console.log(result.implementation); // Actual code
 * console.log(result.review);         // Review feedback
 * ```
 */

