/**
 * persistent-state.ts - Full Checkpoint/Recovery System
 *
 * Derivation:
 * - Event Sourcing: "State can be reconstructed from events"
 * - Report 26: "Long-running agents need resilience"
 * - Distributed Systems: "Checkpoints enable recovery"
 *
 * Checkpoints save full state for recovery from failures.
 * Combined with event sourcing, they enable both replay and restoration.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { EventStore, AgentEvent, projectState, AgentState } from '../event-store';
import { ContextManager, Message, createContextSnapshot, restoreContextSnapshot } from '../context-manager';
import { randomUUID } from 'crypto';

// =============================================================================
// Types
// =============================================================================

/**
 * Complete checkpoint of agent state.
 */
export interface Checkpoint {
  /** Unique checkpoint identifier */
  id: string;

  /** Checkpoint timestamp */
  timestamp: number;

  /** Checkpoint version for migration */
  version: number;

  /** Session this checkpoint belongs to */
  sessionId: string;

  /** Reason for checkpoint */
  reason: CheckpointReason;

  /** Agent state */
  state: {
    iteration: number;
    messages: Message[];
    toolState: Record<string, unknown>;
    pendingActions: PendingAction[];
  };

  /** Metadata about the checkpoint */
  metadata: {
    eventCount: number;
    contextTokens: number;
    elapsedMs: number;
  };
}

/**
 * Reason for creating a checkpoint.
 */
export type CheckpointReason =
  | 'periodic'          // Regular interval checkpoint
  | 'before_dangerous'  // Before risky operation
  | 'error_recovery'    // After recovering from error
  | 'user_requested'    // User manually requested
  | 'session_end'       // End of session
  | 'context_near_full'; // Context approaching limit

/**
 * Pending action that was not completed.
 */
export interface PendingAction {
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  reason: 'interrupted' | 'timeout' | 'error';
}

/**
 * Recovery result.
 */
export interface RecoveryResult {
  checkpoint: Checkpoint;
  eventsReplayed: number;
  stateRestored: AgentState;
}

// =============================================================================
// Checkpoint Manager
// =============================================================================

/**
 * Manages checkpoints for agent state persistence.
 *
 * Derivation (Distributed Systems):
 * "Checkpoints capture full state at a point in time.
 * Combined with event logs, they minimize recovery time."
 */
export class CheckpointManager {
  private storagePath: string;
  private sessionId: string;
  private checkpoints: Checkpoint[] = [];
  private maxCheckpoints: number;

  constructor(config: {
    storagePath: string;
    sessionId: string;
    maxCheckpoints?: number;
  }) {
    this.storagePath = config.storagePath;
    this.sessionId = config.sessionId;
    this.maxCheckpoints = config.maxCheckpoints || 10;
  }

  /**
   * Initialize the checkpoint manager.
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.getCheckpointDir(), { recursive: true });
    await this.loadCheckpointIndex();
  }

  /**
   * Get the checkpoint directory.
   */
  private getCheckpointDir(): string {
    return path.join(this.storagePath, 'checkpoints');
  }

  /**
   * Get the index file path.
   */
  private getIndexPath(): string {
    return path.join(this.getCheckpointDir(), 'index.json');
  }

  /**
   * Get the checkpoint file path.
   */
  private getCheckpointPath(id: string): string {
    return path.join(this.getCheckpointDir(), `${id}.json`);
  }

  /**
   * Load checkpoint index.
   */
  private async loadCheckpointIndex(): Promise<void> {
    try {
      const data = await fs.readFile(this.getIndexPath(), 'utf-8');
      this.checkpoints = JSON.parse(data);
    } catch {
      this.checkpoints = [];
    }
  }

  /**
   * Save checkpoint index.
   */
  private async saveCheckpointIndex(): Promise<void> {
    await fs.writeFile(
      this.getIndexPath(),
      JSON.stringify(this.checkpoints, null, 2),
      'utf-8'
    );
  }

  /**
   * Create a checkpoint.
   */
  async create(
    contextManager: ContextManager,
    eventStore: EventStore,
    toolState: Record<string, unknown>,
    pendingActions: PendingAction[],
    reason: CheckpointReason
  ): Promise<Checkpoint> {
    const contextSnapshot = createContextSnapshot(contextManager);
    const state = projectState(eventStore.all());

    const checkpoint: Checkpoint = {
      id: randomUUID(),
      timestamp: Date.now(),
      version: 1,
      sessionId: this.sessionId,
      reason,
      state: {
        iteration: state.iteration,
        messages: contextSnapshot.messages,
        toolState,
        pendingActions,
      },
      metadata: {
        eventCount: eventStore.count(),
        contextTokens: contextSnapshot.tokenCount,
        elapsedMs: 0, // Would track actual elapsed time
      },
    };

    // Save checkpoint data
    await fs.writeFile(
      this.getCheckpointPath(checkpoint.id),
      JSON.stringify(checkpoint, null, 2),
      'utf-8'
    );

    // Update index
    this.checkpoints.push({
      ...checkpoint,
      state: undefined as any, // Index only stores metadata
    });
    await this.saveCheckpointIndex();

    // Enforce max checkpoints
    await this.enforceMaxCheckpoints();

    return checkpoint;
  }

  /**
   * Load a specific checkpoint.
   */
  async load(id: string): Promise<Checkpoint | undefined> {
    try {
      const data = await fs.readFile(this.getCheckpointPath(id), 'utf-8');
      return JSON.parse(data);
    } catch {
      return undefined;
    }
  }

  /**
   * Get the latest checkpoint.
   */
  async latest(): Promise<Checkpoint | undefined> {
    if (this.checkpoints.length === 0) {
      return undefined;
    }

    const latest = this.checkpoints[this.checkpoints.length - 1]!;
    return this.load(latest.id);
  }

  /**
   * Get the latest checkpoint for a session.
   */
  async latestForSession(sessionId: string): Promise<Checkpoint | undefined> {
    const sessionCheckpoints = this.checkpoints.filter(
      c => c.sessionId === sessionId
    );

    if (sessionCheckpoints.length === 0) {
      return undefined;
    }

    const latest = sessionCheckpoints[sessionCheckpoints.length - 1];
    return this.load(latest.id);
  }

  /**
   * List all checkpoints.
   */
  list(): Omit<Checkpoint, 'state'>[] {
    return [...this.checkpoints];
  }

  /**
   * Delete old checkpoints.
   */
  private async enforceMaxCheckpoints(): Promise<void> {
    while (this.checkpoints.length > this.maxCheckpoints) {
      const oldest = this.checkpoints.shift();
      if (oldest) {
        try {
          await fs.unlink(this.getCheckpointPath(oldest.id));
        } catch {
          // Ignore deletion errors
        }
      }
    }
    await this.saveCheckpointIndex();
  }

  /**
   * Delete a specific checkpoint.
   */
  async delete(id: string): Promise<boolean> {
    const index = this.checkpoints.findIndex(c => c.id === id);
    if (index === -1) {
      return false;
    }

    try {
      await fs.unlink(this.getCheckpointPath(id));
    } catch {
      // Ignore deletion errors
    }

    this.checkpoints.splice(index, 1);
    await this.saveCheckpointIndex();
    return true;
  }
}

// =============================================================================
// State Recovery
// =============================================================================

/**
 * Recovers agent state from a checkpoint and event store.
 *
 * Derivation (Event Sourcing):
 * "Restore from checkpoint, replay events since checkpoint.
 * This minimizes data loss while enabling quick recovery."
 */
export async function recoverFromCheckpoint(
  checkpointManager: CheckpointManager,
  eventStore: EventStore,
  contextManager: ContextManager
): Promise<RecoveryResult | undefined> {
  // Get latest checkpoint
  const checkpoint = await checkpointManager.latest();
  if (!checkpoint) {
    return undefined;
  }

  // Restore context
  restoreContextSnapshot(contextManager, {
    timestamp: checkpoint.timestamp,
    messages: checkpoint.state.messages,
    tokenCount: checkpoint.metadata.contextTokens,
    messageCount: checkpoint.state.messages.length,
  });

  // Get events since checkpoint
  const eventsSinceCheckpoint = eventStore.since(checkpoint.timestamp);

  // Replay events to update state
  let eventsReplayed = 0;
  for (const _event of eventsSinceCheckpoint) {
    // Events are already in the store, just count them
    eventsReplayed++;
  }

  return {
    checkpoint,
    eventsReplayed,
    stateRestored: projectState(eventStore.all()),
  };
}

// =============================================================================
// Persistent State Coordinator
// =============================================================================

/**
 * Coordinates all state persistence components.
 *
 * Derivation (Unified Interface):
 * "One coordinator manages events, context, and checkpoints.
 * Simplifies usage while maintaining separation of concerns."
 */
export class PersistentStateCoordinator {
  private eventStore: EventStore;
  private contextManager: ContextManager;
  private checkpointManager: CheckpointManager;
  private toolState: Record<string, unknown> = {};
  private checkpointInterval: NodeJS.Timeout | null = null;
  private startTime: number;

  constructor(config: {
    storagePath: string;
    sessionId?: string;
    maxTokens?: number;
    checkpointIntervalMs?: number;
  }) {
    const sessionId = config.sessionId || randomUUID();

    this.eventStore = new EventStore({
      sessionId,
      persistPath: path.join(config.storagePath, `events-${sessionId}.jsonl`),
    });

    this.contextManager = new ContextManager({
      maxTokens: config.maxTokens || 100_000,
    });

    this.checkpointManager = new CheckpointManager({
      storagePath: config.storagePath,
      sessionId,
    });

    this.startTime = Date.now();

    // Setup periodic checkpoints
    if (config.checkpointIntervalMs && config.checkpointIntervalMs > 0) {
      this.checkpointInterval = setInterval(
        () => this.checkpoint('periodic'),
        config.checkpointIntervalMs
      );
    }
  }

  /**
   * Initialize the coordinator.
   */
  async initialize(): Promise<void> {
    await this.eventStore.load();
    await this.checkpointManager.initialize();
  }

  /**
   * Record an event.
   */
  async recordEvent<T extends AgentEvent>(
    type: T['type'],
    data: T['data']
  ): Promise<T> {
    return this.eventStore.append(type, data);
  }

  /**
   * Add a message to context.
   */
  addMessage(message: Message): { compressed: boolean; removedCount: number } {
    const result = this.contextManager.add(message);

    // Checkpoint if compression happened
    if (result.compressed) {
      this.checkpoint('context_near_full');
    }

    return result;
  }

  /**
   * Get current messages.
   */
  getMessages(): Message[] {
    return this.contextManager.getMessages();
  }

  /**
   * Update tool state.
   */
  setToolState(key: string, value: unknown): void {
    this.toolState[key] = value;
  }

  /**
   * Get tool state.
   */
  getToolState(key: string): unknown {
    return this.toolState[key];
  }

  /**
   * Create a checkpoint.
   */
  async checkpoint(
    reason: CheckpointReason,
    pendingActions: PendingAction[] = []
  ): Promise<Checkpoint> {
    return this.checkpointManager.create(
      this.contextManager,
      this.eventStore,
      this.toolState,
      pendingActions,
      reason
    );
  }

  /**
   * Recover from the latest checkpoint.
   */
  async recover(): Promise<RecoveryResult | undefined> {
    const result = await recoverFromCheckpoint(
      this.checkpointManager,
      this.eventStore,
      this.contextManager
    );

    if (result) {
      // Restore tool state
      this.toolState = result.checkpoint.state.toolState;
    }

    return result;
  }

  /**
   * Get current state.
   */
  getState(): AgentState {
    return projectState(this.eventStore.all());
  }

  /**
   * Start a new iteration.
   */
  nextIteration(): number {
    return this.eventStore.nextIteration();
  }

  /**
   * Get statistics.
   */
  stats(): {
    eventCount: number;
    messageCount: number;
    contextUtilization: number;
    checkpointCount: number;
    elapsedMs: number;
  } {
    return {
      eventCount: this.eventStore.count(),
      messageCount: this.contextManager.getMessageCount(),
      contextUtilization: this.contextManager.getUtilization(),
      checkpointCount: this.checkpointManager.list().length,
      elapsedMs: Date.now() - this.startTime,
    };
  }

  /**
   * Clean up resources.
   */
  async shutdown(): Promise<void> {
    if (this.checkpointInterval) {
      clearInterval(this.checkpointInterval);
    }

    // Final checkpoint
    await this.checkpoint('session_end');
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a fully configured persistent state coordinator.
 */
export async function createPersistentState(
  storagePath: string,
  options?: {
    sessionId?: string;
    maxTokens?: number;
    checkpointIntervalMs?: number;
  }
): Promise<PersistentStateCoordinator> {
  const coordinator = new PersistentStateCoordinator({
    storagePath,
    ...options,
  });

  await coordinator.initialize();

  // Try to recover from existing checkpoint
  const recovery = await coordinator.recover();
  if (recovery) {
    console.log(`Recovered from checkpoint: ${recovery.checkpoint.id}`);
    console.log(`Events replayed: ${recovery.eventsReplayed}`);
  }

  return coordinator;
}

// =============================================================================
// Usage Example
// =============================================================================

/**
 * Example: Agent with full state persistence.
 *
 * ```typescript
 * import { createPersistentState } from './persistent-state';
 *
 * async function runPersistentAgent(task: string) {
 *   // Create coordinator with checkpoints every 5 minutes
 *   const state = await createPersistentState('.agent/state', {
 *     checkpointIntervalMs: 5 * 60 * 1000,
 *   });
 *
 *   // Agent loop
 *   while (true) {
 *     const iteration = state.nextIteration();
 *
 *     // Record iteration start
 *     await state.recordEvent('iteration_start', { iteration });
 *
 *     // Get LLM response
 *     const response = await llm.invoke(state.getMessages(), tools);
 *
 *     // Add to context
 *     state.addMessage({ role: 'assistant', content: response.content });
 *
 *     // Check for completion
 *     if (!response.toolCalls?.length) {
 *       break;
 *     }
 *
 *     // Execute tools
 *     for (const call of response.toolCalls) {
 *       // Record tool call
 *       await state.recordEvent('tool_call', {
 *         toolName: call.name,
 *         toolInput: call.input,
 *         toolUseId: call.id,
 *       });
 *
 *       // Checkpoint before dangerous operations
 *       if (isDangerous(call)) {
 *         await state.checkpoint('before_dangerous');
 *       }
 *
 *       // Execute
 *       const result = await executeTool(call);
 *
 *       // Record result
 *       await state.recordEvent('tool_result', {
 *         toolUseId: call.id,
 *         result: result.content,
 *         isError: result.is_error,
 *         durationMs: result.durationMs,
 *       });
 *     }
 *   }
 *
 *   // Cleanup
 *   await state.shutdown();
 * }
 * ```
 */

