/**
 * simple-memory.ts - Key-Value Filesystem Memory
 *
 * Derivation:
 * - Report 25: "Memory persists through filesystem, not in-context"
 * - Report 11: "Claude Code stores context in files"
 * - Production Practice: Simple key-value is often enough
 *
 * Filesystem memory survives context limits and session boundaries.
 * Start simple, add complexity only when needed.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// =============================================================================
// Types
// =============================================================================

/**
 * Memory entry with metadata.
 */
export interface MemoryEntry<T = unknown> {
  key: string;
  value: T;
  createdAt: number;
  updatedAt: number;
  accessCount: number;
  tags?: string[];
}

/**
 * Memory options.
 */
export interface MemoryOptions {
  /** Base directory for storage */
  basePath: string;

  /** Maximum entries (0 = unlimited) */
  maxEntries?: number;

  /** TTL in milliseconds (0 = no expiry) */
  ttlMs?: number;

  /** Serialize function */
  serialize?: (value: unknown) => string;

  /** Deserialize function */
  deserialize?: (data: string) => unknown;
}

// =============================================================================
// Simple Memory
// =============================================================================

/**
 * Simple filesystem-backed key-value memory.
 *
 * Derivation (Report 25):
 * "Memory persists through filesystem, not in-context.
 * Write important context to files for later retrieval."
 */
export class SimpleMemory {
  private basePath: string;
  private options: Required<MemoryOptions>;
  private cache: Map<string, MemoryEntry> = new Map();

  constructor(options: MemoryOptions) {
    this.basePath = options.basePath;
    this.options = {
      maxEntries: 0,
      ttlMs: 0,
      serialize: JSON.stringify,
      deserialize: JSON.parse,
      ...options,
    };
  }

  /**
   * Initialize the memory store.
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true });
    await this.loadCache();
  }

  /**
   * Load existing entries into cache.
   */
  private async loadCache(): Promise<void> {
    try {
      const indexPath = this.getIndexPath();
      const indexData = await fs.readFile(indexPath, 'utf-8');
      const entries = JSON.parse(indexData) as MemoryEntry[];

      for (const entry of entries) {
        this.cache.set(entry.key, entry);
      }
    } catch {
      // No existing index - start fresh
    }
  }

  /**
   * Save cache index to disk.
   */
  private async saveIndex(): Promise<void> {
    const indexPath = this.getIndexPath();
    const entries = Array.from(this.cache.values());
    await fs.writeFile(indexPath, JSON.stringify(entries, null, 2), 'utf-8');
  }

  /**
   * Get the index file path.
   */
  private getIndexPath(): string {
    return path.join(this.basePath, '_index.json');
  }

  /**
   * Get the data file path for a key.
   */
  private getDataPath(key: string): string {
    // Sanitize key for filesystem
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.basePath, `${safeKey}.json`);
  }

  /**
   * Set a value.
   */
  async set<T>(key: string, value: T, tags?: string[]): Promise<void> {
    const now = Date.now();
    const existing = this.cache.get(key);

    const entry: MemoryEntry<T> = {
      key,
      value,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      accessCount: existing?.accessCount || 0,
      tags,
    };

    // Enforce max entries
    if (this.options.maxEntries > 0 && !existing) {
      await this.enforceMaxEntries();
    }

    // Write data
    const dataPath = this.getDataPath(key);
    await fs.writeFile(dataPath, this.options.serialize(value), 'utf-8');

    // Update cache
    this.cache.set(key, entry);
    await this.saveIndex();
  }

  /**
   * Get a value.
   */
  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    // Check TTL
    if (this.options.ttlMs > 0) {
      const age = Date.now() - entry.updatedAt;
      if (age > this.options.ttlMs) {
        await this.delete(key);
        return undefined;
      }
    }

    // Update access count
    entry.accessCount++;
    await this.saveIndex();

    // Read data
    try {
      const dataPath = this.getDataPath(key);
      const data = await fs.readFile(dataPath, 'utf-8');
      return this.options.deserialize(data) as T;
    } catch {
      // Data file missing - remove from cache
      this.cache.delete(key);
      await this.saveIndex();
      return undefined;
    }
  }

  /**
   * Delete a value.
   */
  async delete(key: string): Promise<boolean> {
    if (!this.cache.has(key)) {
      return false;
    }

    try {
      const dataPath = this.getDataPath(key);
      await fs.unlink(dataPath);
    } catch {
      // File might not exist
    }

    this.cache.delete(key);
    await this.saveIndex();
    return true;
  }

  /**
   * Check if a key exists.
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);

    if (!entry) return false;

    // Check TTL
    if (this.options.ttlMs > 0) {
      const age = Date.now() - entry.updatedAt;
      if (age > this.options.ttlMs) {
        return false;
      }
    }

    return true;
  }

  /**
   * List all keys.
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Find keys by tag.
   */
  findByTag(tag: string): string[] {
    return Array.from(this.cache.entries())
      .filter(([_, entry]) => entry.tags?.includes(tag))
      .map(([key]) => key);
  }

  /**
   * Get recent entries.
   */
  recent(limit: number = 10): MemoryEntry[] {
    return Array.from(this.cache.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  /**
   * Get frequently accessed entries.
   */
  frequent(limit: number = 10): MemoryEntry[] {
    return Array.from(this.cache.values())
      .sort((a, b) => b.accessCount - a.accessCount)
      .slice(0, limit);
  }

  /**
   * Enforce maximum entries by removing least recently used.
   */
  private async enforceMaxEntries(): Promise<void> {
    if (this.cache.size < this.options.maxEntries) {
      return;
    }

    // Sort by last access time (oldest first)
    const sorted = Array.from(this.cache.entries())
      .sort((a, b) => a[1].updatedAt - b[1].updatedAt);

    // Remove oldest entries
    const toRemove = sorted.slice(0, sorted.length - this.options.maxEntries + 1);

    for (const [key] of toRemove) {
      await this.delete(key);
    }
  }

  /**
   * Clear all entries.
   */
  async clear(): Promise<void> {
    for (const key of this.keys()) {
      await this.delete(key);
    }
  }

  /**
   * Get memory statistics.
   */
  stats(): {
    entryCount: number;
    oldestEntry?: number;
    newestEntry?: number;
    totalAccesses: number;
  } {
    const entries = Array.from(this.cache.values());

    if (entries.length === 0) {
      return { entryCount: 0, totalAccesses: 0 };
    }

    return {
      entryCount: entries.length,
      oldestEntry: Math.min(...entries.map(e => e.createdAt)),
      newestEntry: Math.max(...entries.map(e => e.updatedAt)),
      totalAccesses: entries.reduce((sum, e) => sum + e.accessCount, 0),
    };
  }
}

// =============================================================================
// Typed Memory Helpers
// =============================================================================

/**
 * Create a typed memory namespace.
 *
 * @example
 * const projectMemory = createTypedMemory<{
 *   structure: { rootDir: string; language: string };
 *   decisions: { auth: string; database: string };
 * }>(memory, 'project');
 *
 * await projectMemory.set('structure', { rootDir: '/app', language: 'ts' });
 * const structure = await projectMemory.get('structure');
 */
export function createTypedMemory<T extends Record<string, unknown>>(
  memory: SimpleMemory,
  namespace: string
): {
  set: <K extends keyof T>(key: K, value: T[K]) => Promise<void>;
  get: <K extends keyof T>(key: K) => Promise<T[K] | undefined>;
  delete: <K extends keyof T>(key: K) => Promise<boolean>;
  has: <K extends keyof T>(key: K) => boolean;
} {
  const prefix = `${namespace}:`;

  return {
    set: async <K extends keyof T>(key: K, value: T[K]) => {
      await memory.set(`${prefix}${String(key)}`, value);
    },
    get: async <K extends keyof T>(key: K) => {
      return memory.get<T[K]>(`${prefix}${String(key)}`);
    },
    delete: async <K extends keyof T>(key: K) => {
      return memory.delete(`${prefix}${String(key)}`);
    },
    has: <K extends keyof T>(key: K) => {
      return memory.has(`${prefix}${String(key)}`);
    },
  };
}

// =============================================================================
// Document Memory
// =============================================================================

/**
 * Memory extension for storing documents (markdown, text).
 */
export class DocumentMemory {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true });
  }

  /**
   * Write a document.
   */
  async write(relativePath: string, content: string): Promise<void> {
    const fullPath = path.join(this.basePath, relativePath);
    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  /**
   * Read a document.
   */
  async read(relativePath: string): Promise<string | undefined> {
    try {
      const fullPath = path.join(this.basePath, relativePath);
      return await fs.readFile(fullPath, 'utf-8');
    } catch {
      return undefined;
    }
  }

  /**
   * Delete a document.
   */
  async delete(relativePath: string): Promise<boolean> {
    try {
      const fullPath = path.join(this.basePath, relativePath);
      await fs.unlink(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List documents in a directory.
   */
  async list(relativePath: string = ''): Promise<string[]> {
    try {
      const fullPath = path.join(this.basePath, relativePath);
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      return entries.map(e => path.join(relativePath, e.name));
    } catch {
      return [];
    }
  }

  /**
   * Check if a document exists.
   */
  async exists(relativePath: string): Promise<boolean> {
    try {
      const fullPath = path.join(this.basePath, relativePath);
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a simple memory store.
 */
export async function createSimpleMemory(
  basePath: string,
  options?: Partial<MemoryOptions>
): Promise<SimpleMemory> {
  const memory = new SimpleMemory({ basePath, ...options });
  await memory.initialize();
  return memory;
}

/**
 * Create a document memory store.
 */
export async function createDocumentMemory(basePath: string): Promise<DocumentMemory> {
  const memory = new DocumentMemory(basePath);
  await memory.initialize();
  return memory;
}

// =============================================================================
// Usage Example
// =============================================================================

/**
 * Example: Using memory in an agent.
 *
 * ```typescript
 * import { createSimpleMemory, createDocumentMemory } from './simple-memory';
 *
 * async function initializeAgent() {
 *   // Key-value memory for structured data
 *   const memory = await createSimpleMemory('.agent/memory', {
 *     maxEntries: 1000,
 *     ttlMs: 24 * 60 * 60 * 1000, // 24 hours
 *   });
 *
 *   // Document memory for notes, decisions, logs
 *   const docs = await createDocumentMemory('.agent/docs');
 *
 *   // Store project context
 *   await memory.set('project', {
 *     name: 'my-app',
 *     rootDir: '/app',
 *     language: 'typescript',
 *   });
 *
 *   // Store a decision document
 *   await docs.write('decisions/auth.md', `
 * # Authentication Decision
 *
 * We chose JWT tokens because:
 * 1. Stateless - scales horizontally
 * 2. Standard - good library support
 * 3. Flexible - works for API and web
 *
 * Date: ${new Date().toISOString()}
 * `);
 *
 *   // Later: retrieve context
 *   const project = await memory.get('project');
 *   const authDecision = await docs.read('decisions/auth.md');
 * }
 * ```
 */

