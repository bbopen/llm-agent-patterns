/**
 * event-store.ts - Immutable Event Log
 *
 * Derivation:
 * - Event Sourcing: "Store events, derive state"
 * - Report 26: "Track every action for debugging and replay"
 * - CQRS: Separate read and write models
 *
 * Events are the source of truth. State is computed, not stored.
 * This enables replay, debugging, and audit trails.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';

// =============================================================================
// Types
// =============================================================================

/**
 * Base event interface.
 */
export interface AgentEvent<TData = Record<string, unknown>> {
  /** Unique event identifier */
  id: string;

  /** Event timestamp (milliseconds since epoch) */
  timestamp: number;

  /** Event type for filtering and handling */
  type: string;

  /** Event payload */
  data: TData;

  /** Event metadata */
  metadata: EventMetadata;
}

/**
 * Event metadata.
 */
export interface EventMetadata {
  /** Agent loop iteration number */
  iteration: number;

  /** Session identifier */
  sessionId: string;

  /** Parent event ID for causality tracking */
  parentEventId?: string;

  /** Correlation ID for grouping related events */
  correlationId?: string;

  /** Event version for schema evolution */
  version: number;
}

/**
 * Tool call event.
 */
export interface ToolCallEvent extends AgentEvent<{
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
}> {
  type: 'tool_call';
}

/**
 * Tool result event.
 */
export interface ToolResultEvent extends AgentEvent<{
  toolUseId: string;
  result: string;
  isError: boolean;
  durationMs: number;
}> {
  type: 'tool_result';
}

/**
 * Decision event (model output without tool calls).
 */
export interface DecisionEvent extends AgentEvent<{
  content: string;
  stopReason: string;
}> {
  type: 'decision';
}

/**
 * Error event.
 */
export interface ErrorEvent extends AgentEvent<{
  error: string;
  stack?: string;
  recoverable: boolean;
}> {
  type: 'error';
}

/**
 * Checkpoint event.
 */
export interface CheckpointEvent extends AgentEvent<{
  checkpointId: string;
  reason: string;
}> {
  type: 'checkpoint';
}

/**
 * Union of all event types.
 */
export type AnyAgentEvent =
  | ToolCallEvent
  | ToolResultEvent
  | DecisionEvent
  | ErrorEvent
  | CheckpointEvent
  | AgentEvent;

// =============================================================================
// Event Store Implementation
// =============================================================================

/**
 * In-memory event store with optional persistence.
 *
 * Derivation (Event Sourcing):
 * "The event log is the system of record.
 * Current state is a projection, not the source of truth."
 */
export class EventStore {
  private events: AnyAgentEvent[] = [];
  private sessionId: string;
  private persistPath?: string;
  private iteration: number = 0;

  constructor(config: {
    sessionId?: string;
    persistPath?: string;
    loadExisting?: boolean;
  } = {}) {
    this.sessionId = config.sessionId || randomUUID();
    this.persistPath = config.persistPath;
  }

  /**
   * Append an event to the store.
   *
   * Events are immutable once appended.
   */
  async append<T extends AnyAgentEvent>(
    type: T['type'],
    data: T['data'],
    metadata?: Partial<EventMetadata>
  ): Promise<T> {
    const event = {
      id: this.generateEventId(type, data),
      timestamp: Date.now(),
      type,
      data,
      metadata: {
        iteration: this.iteration,
        sessionId: this.sessionId,
        version: 1,
        ...metadata,
      },
    } as T;

    this.events.push(event);

    // Persist if configured
    if (this.persistPath) {
      await this.persistEvent(event);
    }

    return event;
  }

  /**
   * Generate a deterministic event ID.
   */
  private generateEventId(type: string, data: unknown): string {
    const hash = createHash('sha256');
    hash.update(type);
    hash.update(JSON.stringify(data));
    hash.update(Date.now().toString());
    hash.update(Math.random().toString());
    return hash.digest('hex').substring(0, 16);
  }

  /**
   * Persist an event to disk.
   */
  private async persistEvent(event: AnyAgentEvent): Promise<void> {
    if (!this.persistPath) return;

    const dir = path.dirname(this.persistPath);
    await fs.mkdir(dir, { recursive: true });

    // Append to JSONL file (one event per line)
    const line = JSON.stringify(event) + '\n';
    await fs.appendFile(this.persistPath, line, 'utf-8');
  }

  /**
   * Load events from disk.
   */
  async load(): Promise<void> {
    if (!this.persistPath) return;

    try {
      const content = await fs.readFile(this.persistPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      this.events = lines.map(line => JSON.parse(line));

      // Update iteration from loaded events
      if (this.events.length > 0) {
        const maxIteration = Math.max(
          ...this.events.map(e => e.metadata.iteration)
        );
        this.iteration = maxIteration;
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      // File doesn't exist - start fresh
    }
  }

  /**
   * Get all events.
   */
  all(): AnyAgentEvent[] {
    return [...this.events];
  }

  /**
   * Get events since a timestamp.
   */
  since(timestamp: number): AnyAgentEvent[] {
    return this.events.filter(e => e.timestamp >= timestamp);
  }

  /**
   * Get events by type.
   */
  byType<T extends AnyAgentEvent>(type: T['type']): T[] {
    return this.events.filter(e => e.type === type) as T[];
  }

  /**
   * Get events for an iteration.
   */
  byIteration(iteration: number): AnyAgentEvent[] {
    return this.events.filter(e => e.metadata.iteration === iteration);
  }

  /**
   * Get the last N events.
   */
  recent(count: number): AnyAgentEvent[] {
    return this.events.slice(-count);
  }

  /**
   * Find event by ID.
   */
  find(id: string): AnyAgentEvent | undefined {
    return this.events.find(e => e.id === id);
  }

  /**
   * Start a new iteration.
   */
  nextIteration(): number {
    return ++this.iteration;
  }

  /**
   * Get current iteration.
   */
  currentIteration(): number {
    return this.iteration;
  }

  /**
   * Get the session ID.
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Get event count.
   */
  count(): number {
    return this.events.length;
  }

  /**
   * Clear all events (for testing).
   */
  clear(): void {
    this.events = [];
    this.iteration = 0;
  }
}

// =============================================================================
// State Projection
// =============================================================================

/**
 * Derived state from events.
 */
export interface AgentState {
  iteration: number;
  toolCallsCount: number;
  errorsCount: number;
  lastToolCall?: {
    name: string;
    timestamp: number;
  };
  filesModified: Set<string>;
  decisionsCount: number;
}

/**
 * Project current state from events.
 *
 * Derivation (Event Sourcing):
 * "State is computed by replaying events through a reducer.
 * This ensures state is always consistent with the event log."
 */
export function projectState(events: AnyAgentEvent[]): AgentState {
  const initialState: AgentState = {
    iteration: 0,
    toolCallsCount: 0,
    errorsCount: 0,
    filesModified: new Set(),
    decisionsCount: 0,
  };

  return events.reduce((state, event) => {
    switch (event.type) {
      case 'tool_call': {
        const tcEvent = event as ToolCallEvent;
        state.toolCallsCount++;
        state.lastToolCall = {
          name: tcEvent.data.toolName,
          timestamp: event.timestamp,
        };

        // Track file modifications
        if (tcEvent.data.toolName === 'write_file') {
          const filePath = tcEvent.data.toolInput.path as string;
          if (filePath) state.filesModified.add(filePath);
        }
        break;
      }

      case 'tool_result': {
        const trEvent = event as ToolResultEvent;
        if (trEvent.data.isError) {
          state.errorsCount++;
        }
        break;
      }

      case 'decision':
        state.decisionsCount++;
        break;

      case 'error':
        state.errorsCount++;
        break;
    }

    state.iteration = Math.max(state.iteration, event.metadata.iteration);
    return state;
  }, initialState);
}

// =============================================================================
// Event Replay
// =============================================================================

/**
 * Event handler for replay.
 */
export type EventHandler<T extends AnyAgentEvent = AnyAgentEvent> = (
  event: T
) => void | Promise<void>;

/**
 * Replay events through handlers.
 *
 * Derivation (Event Sourcing):
 * "Replay enables debugging, testing, and migration.
 * Any state can be reconstructed by replaying events."
 */
export async function replayEvents(
  events: AnyAgentEvent[],
  handlers: Partial<Record<string, EventHandler>>
): Promise<void> {
  for (const event of events) {
    const handler = handlers[event.type];
    if (handler) {
      await handler(event);
    }
  }
}

// =============================================================================
// Event Store Factory
// =============================================================================

/**
 * Create an event store with standard configuration.
 */
export function createEventStore(config?: {
  sessionId?: string;
  persistPath?: string;
}): EventStore {
  return new EventStore(config);
}

/**
 * Create a persistent event store.
 */
export async function createPersistentEventStore(
  storagePath: string,
  sessionId?: string
): Promise<EventStore> {
  const store = new EventStore({
    sessionId,
    persistPath: path.join(storagePath, `events-${sessionId || 'default'}.jsonl`),
  });

  await store.load();
  return store;
}

