/**
 * coordinator.ts - Coordinator Pattern Implementation
 *
 * Derivation:
 * - Simon (1962): "Hierarchical systems with clear boundaries"
 * - Report 26: "Single-level delegation: coordinator -> workers"
 * - MapReduce: "Split, map, reduce pattern"
 *
 * The coordinator analyzes tasks, delegates to workers,
 * and combines results. Workers are terminal—they don't delegate.
 */

import type { Tool as _Tool } from '../02-tool-design/tool-types';

// =============================================================================
// Types
// =============================================================================

/**
 * Task to be executed.
 */
export interface Task {
  /** Unique task identifier */
  id: string;

  /** Task type for worker selection */
  type: TaskType;

  /** Task description/input */
  description: string;

  /** Task priority */
  priority: 'low' | 'medium' | 'high';

  /** Dependencies on other tasks */
  dependencies?: string[];

  /** Maximum iterations for this task */
  maxIterations?: number;

  /** Maximum tokens for this task */
  maxTokens?: number;

  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Task types for worker specialization.
 */
export type TaskType =
  | 'research'
  | 'implement'
  | 'review'
  | 'test'
  | 'document'
  | 'general';

/**
 * Result from a worker.
 */
export interface WorkerResult {
  /** Task that was executed */
  taskId: string;

  /** Whether execution succeeded */
  success: boolean;

  /** Output from the worker */
  output: string;

  /** Error if failed */
  error?: string;

  /** Tokens consumed */
  tokensUsed: number;

  /** Execution duration in ms */
  durationMs: number;

  /** Artifacts produced */
  artifacts?: Artifact[];
}

/**
 * Artifact produced by a worker.
 */
export interface Artifact {
  type: 'file' | 'data' | 'code';
  name: string;
  content: string;
}

/**
 * Aggregation strategy for combining results.
 */
export type AggregationStrategy =
  | 'merge'         // Combine all outputs
  | 'vote'          // Take most common
  | 'sequence'      // Apply in order
  | 'first-success' // Take first successful
  | 'custom';       // Custom function

/**
 * Coordinator configuration.
 */
export interface CoordinatorConfig {
  /** Maximum concurrent workers */
  maxConcurrency: number;

  /** Default aggregation strategy */
  aggregationStrategy: AggregationStrategy;

  /** Total budget for all workers */
  budget: {
    maxTokens: number;
    maxTime: number;
    maxWorkers: number;
  };

  /** Custom aggregation function */
  customAggregator?: (results: WorkerResult[]) => Promise<string>;
}

// =============================================================================
// Task Analysis
// =============================================================================

/**
 * Analyzes a task and decomposes into subtasks.
 *
 * Derivation (Decomposition):
 * "Complex tasks decompose into simpler subtasks.
 * Good decomposition creates independent, parallelizable work."
 */
export interface TaskAnalyzer {
  /**
   * Analyze and decompose a task.
   *
   * @param description Original task description
   * @returns List of subtasks
   */
  analyze(description: string): Promise<Task[]>;

  /**
   * Determine dependencies between tasks.
   *
   * @param tasks List of tasks
   * @returns Tasks with dependencies set
   */
  determineDependencies(tasks: Task[]): Task[];

  /**
   * Create an execution plan.
   *
   * @param tasks Tasks with dependencies
   * @returns Ordered execution phases
   */
  planExecution(tasks: Task[]): Task[][];
}

/**
 * Simple task analyzer implementation.
 */
export class SimpleTaskAnalyzer implements TaskAnalyzer {
  async analyze(description: string): Promise<Task[]> {
    // In a real implementation, this would use an LLM to decompose
    // For now, return a single task
    return [{
      id: `task-${Date.now()}`,
      type: this.inferTaskType(description),
      description,
      priority: 'medium',
    }];
  }

  determineDependencies(tasks: Task[]): Task[] {
    // Simple heuristic: review depends on implement
    return tasks.map((task, index) => {
      if (task.type === 'review') {
        const implementTask = tasks.find(t => t.type === 'implement');
        if (implementTask) {
          task.dependencies = [implementTask.id];
        }
      }
      return task;
    });
  }

  planExecution(tasks: Task[]): Task[][] {
    const phases: Task[][] = [];
    const completed = new Set<string>();
    const remaining = [...tasks];

    while (remaining.length > 0) {
      // Find tasks with all dependencies satisfied
      const ready = remaining.filter(task =>
        !task.dependencies ||
        task.dependencies.every(dep => completed.has(dep))
      );

      if (ready.length === 0 && remaining.length > 0) {
        throw new Error('Circular dependency detected');
      }

      phases.push(ready);

      for (const task of ready) {
        completed.add(task.id);
        remaining.splice(remaining.indexOf(task), 1);
      }
    }

    return phases;
  }

  private inferTaskType(description: string): TaskType {
    const lower = description.toLowerCase();

    if (lower.includes('research') || lower.includes('find') || lower.includes('search')) {
      return 'research';
    }
    if (lower.includes('implement') || lower.includes('create') || lower.includes('build')) {
      return 'implement';
    }
    if (lower.includes('review') || lower.includes('check') || lower.includes('validate')) {
      return 'review';
    }
    if (lower.includes('test') || lower.includes('verify')) {
      return 'test';
    }
    if (lower.includes('document') || lower.includes('explain')) {
      return 'document';
    }

    return 'general';
  }
}

// =============================================================================
// Result Aggregation
// =============================================================================

/**
 * Aggregate worker results.
 *
 * Derivation (MapReduce):
 * "Map phase: distribute to workers. Reduce phase: combine results."
 */
export async function aggregateResults(
  results: WorkerResult[],
  strategy: AggregationStrategy,
  customFn?: (results: WorkerResult[]) => Promise<string>
): Promise<string> {
  // Filter successful results for most strategies
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  switch (strategy) {
    case 'merge':
      // Combine all successful outputs
      if (successful.length === 0) {
        return `All ${failed.length} tasks failed:\n${failed.map(f => f.error).join('\n')}`;
      }
      return successful.map(r => r.output).join('\n\n---\n\n');

    case 'vote':
      // Take most common output (simple string matching)
      const votes = new Map<string, number>();
      for (const result of successful) {
        const count = votes.get(result.output) || 0;
        votes.set(result.output, count + 1);
      }

      let maxVotes = 0;
      let winner = '';
      for (const [output, count] of votes) {
        if (count > maxVotes) {
          maxVotes = count;
          winner = output;
        }
      }

      return winner || 'No consensus reached';

    case 'sequence':
      // Apply in order (concatenate with ordering)
      return successful
        .sort((a, b) => {
          // Sort by task ID to maintain order
          return a.taskId.localeCompare(b.taskId);
        })
        .map(r => r.output)
        .join('\n\n');

    case 'first-success':
      // Return first successful result
      if (successful.length > 0) {
        return successful[0].output;
      }
      return `All tasks failed:\n${failed.map(f => f.error).join('\n')}`;

    case 'custom':
      if (!customFn) {
        throw new Error('Custom aggregation requires a function');
      }
      return customFn(results);

    default:
      throw new Error(`Unknown aggregation strategy: ${strategy}`);
  }
}

// =============================================================================
// Coordinator Implementation
// =============================================================================

/**
 * Worker executor function type.
 */
export type WorkerExecutor = (task: Task) => Promise<WorkerResult>;

/**
 * Coordinator for orchestrating worker execution.
 *
 * Derivation (Single-Level Delegation):
 * "Coordinator decomposes and delegates. Workers execute and return.
 * Workers never delegate—this ensures bounded execution."
 */
export class Coordinator {
  private config: CoordinatorConfig;
  private analyzer: TaskAnalyzer;
  private executor: WorkerExecutor;

  // Resource tracking
  private tokensUsed = 0;
  private timeUsed = 0;
  private workersUsed = 0;

  constructor(
    executor: WorkerExecutor,
    config: Partial<CoordinatorConfig> = {},
    analyzer?: TaskAnalyzer
  ) {
    this.executor = executor;
    this.analyzer = analyzer || new SimpleTaskAnalyzer();
    this.config = {
      maxConcurrency: 3,
      aggregationStrategy: 'merge',
      budget: {
        maxTokens: 100000,
        maxTime: 300000, // 5 minutes
        maxWorkers: 10,
      },
      ...config,
    };
  }

  /**
   * Execute a task with orchestration.
   */
  async execute(description: string): Promise<{
    result: string;
    metrics: {
      tasksExecuted: number;
      tokensUsed: number;
      durationMs: number;
      successRate: number;
    };
  }> {
    const startTime = Date.now();

    // Analyze and decompose task
    const tasks = await this.analyzer.analyze(description);
    const tasksWithDeps = this.analyzer.determineDependencies(tasks);
    const phases = this.analyzer.planExecution(tasksWithDeps);

    // Execute phases
    const allResults: WorkerResult[] = [];

    for (const phase of phases) {
      const phaseResults = await this.executePhase(phase);
      allResults.push(...phaseResults);

      // Check if we should continue (budget, errors)
      if (!this.canContinue(allResults)) {
        break;
      }
    }

    // Aggregate results
    const result = await aggregateResults(
      allResults,
      this.config.aggregationStrategy,
      this.config.customAggregator
    );

    const successCount = allResults.filter(r => r.success).length;

    return {
      result,
      metrics: {
        tasksExecuted: allResults.length,
        tokensUsed: this.tokensUsed,
        durationMs: Date.now() - startTime,
        successRate: allResults.length > 0 ? successCount / allResults.length : 0,
      },
    };
  }

  /**
   * Execute a phase of tasks (potentially in parallel).
   */
  private async executePhase(tasks: Task[]): Promise<WorkerResult[]> {
    // Respect concurrency limit
    const batches: Task[][] = [];
    for (let i = 0; i < tasks.length; i += this.config.maxConcurrency) {
      batches.push(tasks.slice(i, i + this.config.maxConcurrency));
    }

    const results: WorkerResult[] = [];

    for (const batch of batches) {
      // Check budget before each batch
      if (!this.hasBudget(batch.length)) {
        for (const task of batch) {
          results.push({
            taskId: task.id,
            success: false,
            output: '',
            error: 'Budget exceeded',
            tokensUsed: 0,
            durationMs: 0,
          });
        }
        continue;
      }

      // Execute batch in parallel
      const batchResults = await Promise.all(
        batch.map(async (task) => {
          this.workersUsed++;

          try {
            const result = await this.executor(task);

            this.tokensUsed += result.tokensUsed;
            this.timeUsed += result.durationMs;

            return result;
          } catch (error) {
            return {
              taskId: task.id,
              success: false,
              output: '',
              error: String(error),
              tokensUsed: 0,
              durationMs: 0,
            };
          }
        })
      );

      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Check if we have budget for more workers.
   */
  private hasBudget(count: number): boolean {
    const budget = this.config.budget;

    if (this.workersUsed + count > budget.maxWorkers) return false;
    if (this.tokensUsed >= budget.maxTokens) return false;
    if (this.timeUsed >= budget.maxTime) return false;

    return true;
  }

  /**
   * Check if we should continue execution.
   */
  private canContinue(results: WorkerResult[]): boolean {
    // Stop if budget exceeded
    if (!this.hasBudget(1)) return false;

    // Stop if too many failures (>50%)
    const failures = results.filter(r => !r.success).length;
    if (failures > results.length / 2) return false;

    return true;
  }

  /**
   * Reset coordinator state.
   */
  reset(): void {
    this.tokensUsed = 0;
    this.timeUsed = 0;
    this.workersUsed = 0;
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a coordinator with default configuration.
 */
export function createCoordinator(
  executor: WorkerExecutor,
  config?: Partial<CoordinatorConfig>
): Coordinator {
  return new Coordinator(executor, config);
}

