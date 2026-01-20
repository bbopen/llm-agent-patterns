/**
 * sandbox.ts - Execution Isolation
 *
 * Derivation:
 * - Brooks: "Lower-level safety behaviors always override higher goals"
 * - Schneier: "Defense in depth requires multiple independent barriers"
 * - Report 28: "Complete action spaces require complete validation"
 *
 * Sandboxes provide isolation for dangerous operations.
 * Without isolation, a single exploit compromises everything.
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';

// =============================================================================
// Types
// =============================================================================

/**
 * Sandbox configuration.
 */
export interface SandboxConfig {
  /** Sandbox name/identifier */
  name?: string;

  /** Root directory for sandbox filesystem */
  rootDir?: string;

  /** Working directory within sandbox */
  workDir?: string;

  /** Allowed paths (whitelist) */
  allowedPaths?: string[];

  /** Blocked paths (blacklist, takes precedence) */
  blockedPaths?: string[];

  /** Process timeout in milliseconds */
  timeout?: number;

  /** Maximum memory in bytes */
  maxMemory?: number;

  /** Maximum output size in bytes */
  maxOutput?: number;

  /** Allow network access */
  networkEnabled?: boolean;

  /** Allowed network hosts (if network enabled) */
  allowedHosts?: string[];

  /** Environment variables to pass */
  env?: Record<string, string>;

  /** User to run as (for Unix-like systems) */
  user?: string;
}

/**
 * Sandbox execution result.
 */
export interface SandboxResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  durationMs: number;
  resourceUsage?: {
    memoryUsed: number;
    cpuTime: number;
  };
}

/**
 * File operation within sandbox.
 */
export interface SandboxFileOp {
  type: 'read' | 'write' | 'delete' | 'list';
  path: string;
  content?: string;
}

// =============================================================================
// Path Validation
// =============================================================================

/**
 * Validate and sanitize a path for sandbox access.
 *
 * Derivation (Security):
 * "Path traversal is a common attack vector.
 * Resolve and validate all paths before access."
 */
export function validateSandboxPath(
  requestedPath: string,
  config: SandboxConfig
): { valid: boolean; resolvedPath: string; reason?: string } {
  // Resolve to absolute path
  const rootDir = config.rootDir || os.tmpdir();
  const resolvedPath = path.resolve(rootDir, requestedPath);

  // Check for path traversal
  if (!resolvedPath.startsWith(rootDir)) {
    return {
      valid: false,
      resolvedPath,
      reason: 'Path traversal detected',
    };
  }

  // Check blocked paths
  if (config.blockedPaths) {
    for (const blocked of config.blockedPaths) {
      if (resolvedPath.startsWith(blocked) || resolvedPath.includes(blocked)) {
        return {
          valid: false,
          resolvedPath,
          reason: `Path is blocked: ${blocked}`,
        };
      }
    }
  }

  // Check allowed paths (if specified)
  if (config.allowedPaths && config.allowedPaths.length > 0) {
    const isAllowed = config.allowedPaths.some(allowed =>
      resolvedPath.startsWith(path.resolve(rootDir, allowed))
    );

    if (!isAllowed) {
      return {
        valid: false,
        resolvedPath,
        reason: 'Path not in allowed list',
      };
    }
  }

  return { valid: true, resolvedPath };
}

// =============================================================================
// Process Sandbox
// =============================================================================

/**
 * Execute a command in an isolated process.
 *
 * Derivation (Defense in Depth):
 * "Process isolation prevents command injection from compromising the host.
 * Timeout and resource limits prevent denial of service."
 */
export async function executeInSandbox(
  command: string,
  args: string[] = [],
  config: SandboxConfig = {}
): Promise<SandboxResult> {
  const startTime = Date.now();
  const timeout = config.timeout || 30000;
  const maxOutput = config.maxOutput || 1024 * 1024; // 1MB default

  // Prepare environment
  const env: Record<string, string> = {
    PATH: '/usr/bin:/bin',
    HOME: config.rootDir || os.tmpdir(),
    ...config.env,
  };

  // Disable network if not enabled
  if (!config.networkEnabled) {
    // Note: True network isolation requires container/VM
    // This just removes common networking env vars
    delete env.HTTP_PROXY;
    delete env.HTTPS_PROXY;
  }

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let child: ChildProcess;

    try {
      child = spawn(command, args, {
        cwd: config.workDir || config.rootDir || os.tmpdir(),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout,
        // Note: For true isolation, use container runtime
      });

      // Handle stdout
      child.stdout?.on('data', (data) => {
        if (stdout.length < maxOutput) {
          stdout += data.toString().slice(0, maxOutput - stdout.length);
        }
      });

      // Handle stderr
      child.stderr?.on('data', (data) => {
        if (stderr.length < maxOutput) {
          stderr += data.toString().slice(0, maxOutput - stderr.length);
        }
      });

      // Handle timeout
      const timeoutId = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeout);

      // Handle completion
      child.on('close', (exitCode, signal) => {
        clearTimeout(timeoutId);

        resolve({
          success: exitCode === 0 && !timedOut,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode,
          signal: signal as string | null,
          timedOut,
          durationMs: Date.now() - startTime,
        });
      });

      // Handle errors
      child.on('error', (error) => {
        clearTimeout(timeoutId);

        resolve({
          success: false,
          stdout: '',
          stderr: error.message,
          exitCode: null,
          signal: null,
          timedOut: false,
          durationMs: Date.now() - startTime,
        });
      });
    } catch (error) {
      resolve({
        success: false,
        stdout: '',
        stderr: String(error),
        exitCode: null,
        signal: null,
        timedOut: false,
        durationMs: Date.now() - startTime,
      });
    }
  });
}

// =============================================================================
// Filesystem Sandbox
// =============================================================================

/**
 * Sandboxed filesystem operations.
 *
 * Derivation (Principle of Least Privilege):
 * "Agents should only access files they need.
 * A sandbox restricts access to a defined boundary."
 */
export class FilesystemSandbox {
  private config: Required<SandboxConfig>;
  private id: string;

  constructor(config: SandboxConfig = {}) {
    this.id = config.name || randomUUID();
    this.config = {
      name: this.id,
      rootDir: config.rootDir || path.join(os.tmpdir(), `sandbox-${this.id}`),
      workDir: config.workDir || '.',
      allowedPaths: config.allowedPaths || [],
      blockedPaths: config.blockedPaths || ['/etc', '/var', '/usr', '/root', '/home'],
      timeout: config.timeout || 30000,
      maxMemory: config.maxMemory || 512 * 1024 * 1024,
      maxOutput: config.maxOutput || 1024 * 1024,
      networkEnabled: config.networkEnabled || false,
      allowedHosts: config.allowedHosts || [],
      env: config.env || {},
      user: config.user || '',
    };
  }

  /**
   * Initialize the sandbox directory.
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.config.rootDir, { recursive: true });
  }

  /**
   * Read a file within the sandbox.
   */
  async readFile(relativePath: string): Promise<string> {
    const validation = validateSandboxPath(relativePath, this.config);

    if (!validation.valid) {
      throw new Error(`Access denied: ${validation.reason}`);
    }

    return fs.readFile(validation.resolvedPath, 'utf-8');
  }

  /**
   * Write a file within the sandbox.
   */
  async writeFile(relativePath: string, content: string): Promise<void> {
    const validation = validateSandboxPath(relativePath, this.config);

    if (!validation.valid) {
      throw new Error(`Access denied: ${validation.reason}`);
    }

    // Ensure directory exists
    const dir = path.dirname(validation.resolvedPath);
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(validation.resolvedPath, content, 'utf-8');
  }

  /**
   * Delete a file within the sandbox.
   */
  async deleteFile(relativePath: string): Promise<void> {
    const validation = validateSandboxPath(relativePath, this.config);

    if (!validation.valid) {
      throw new Error(`Access denied: ${validation.reason}`);
    }

    await fs.unlink(validation.resolvedPath);
  }

  /**
   * List directory contents within the sandbox.
   */
  async listDirectory(relativePath: string = '.'): Promise<string[]> {
    const validation = validateSandboxPath(relativePath, this.config);

    if (!validation.valid) {
      throw new Error(`Access denied: ${validation.reason}`);
    }

    const entries = await fs.readdir(validation.resolvedPath, { withFileTypes: true });
    return entries.map(e => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`);
  }

  /**
   * Check if a path exists within the sandbox.
   */
  async exists(relativePath: string): Promise<boolean> {
    const validation = validateSandboxPath(relativePath, this.config);

    if (!validation.valid) {
      return false;
    }

    try {
      await fs.access(validation.resolvedPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Execute a command within the sandbox.
   */
  async execute(command: string, args: string[] = []): Promise<SandboxResult> {
    return executeInSandbox(command, args, {
      ...this.config,
      workDir: this.config.rootDir,
    });
  }

  /**
   * Clean up the sandbox.
   */
  async cleanup(): Promise<void> {
    try {
      await fs.rm(this.config.rootDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Get the sandbox root directory.
   */
  getRootDir(): string {
    return this.config.rootDir;
  }

  /**
   * Get the sandbox ID.
   */
  getId(): string {
    return this.id;
  }
}

// =============================================================================
// Sandbox Factory
// =============================================================================

/**
 * Create a sandbox with default secure configuration.
 */
export async function createSandbox(
  name?: string,
  config?: Partial<SandboxConfig>
): Promise<FilesystemSandbox> {
  const sandbox = new FilesystemSandbox({
    name,
    ...config,
  });

  await sandbox.initialize();
  return sandbox;
}

/**
 * Create a strict sandbox for untrusted code.
 */
export async function createStrictSandbox(name?: string): Promise<FilesystemSandbox> {
  return createSandbox(name, {
    allowedPaths: ['workspace'],
    blockedPaths: ['/etc', '/var', '/usr', '/root', '/home', '/sys', '/proc', '/dev'],
    timeout: 10000,
    maxMemory: 256 * 1024 * 1024, // 256MB
    maxOutput: 512 * 1024, // 512KB
    networkEnabled: false,
  });
}

/**
 * Create a permissive sandbox for trusted operations.
 */
export async function createPermissiveSandbox(
  name?: string,
  rootDir?: string
): Promise<FilesystemSandbox> {
  return createSandbox(name, {
    rootDir,
    allowedPaths: [],  // Allow all within root
    blockedPaths: ['/etc/passwd', '/etc/shadow'], // Block only critical
    timeout: 300000, // 5 minutes
    maxMemory: 1024 * 1024 * 1024, // 1GB
    networkEnabled: true,
  });
}

// =============================================================================
// Command Sanitization
// =============================================================================

/**
 * Dangerous command patterns.
 */
const DANGEROUS_COMMANDS = [
  /rm\s+-rf?\s+\//,          // rm -rf /
  /dd\s+if=/,                // dd (disk operations)
  /mkfs/,                    // Format filesystem
  /fdisk/,                   // Partition operations
  /:\s*\(\s*\)\s*\{/,        // Fork bomb
  />\s*\/dev\/sd/,           // Direct disk writes
  /chmod\s+777\s+\//,        // Wide-open permissions on root
  /chown\s+-R\s+.*\s+\//,    // Recursive ownership change on root
  /curl.*\|\s*(ba)?sh/,      // Pipe to shell
  /wget.*\|\s*(ba)?sh/,      // Pipe to shell
];

/**
 * Validate a command before execution.
 */
export function validateCommand(
  command: string
): { valid: boolean; reason?: string } {
  for (const pattern of DANGEROUS_COMMANDS) {
    if (pattern.test(command)) {
      return {
        valid: false,
        reason: `Dangerous pattern detected: ${pattern.source.substring(0, 30)}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Sanitize command arguments.
 */
export function sanitizeArgs(args: string[]): string[] {
  return args.map(arg => {
    // Remove shell metacharacters
    return arg.replace(/[;&|`$(){}[\]<>'"\\]/g, '');
  });
}

// =============================================================================
// Usage Example
// =============================================================================

/**
 * Example: Sandboxed code execution tool.
 *
 * ```typescript
 * import { createStrictSandbox, validateCommand } from './sandbox';
 *
 * const executeCodeTool = {
 *   name: 'execute_code',
 *   description: 'Execute code in a sandboxed environment',
 *   execute: async (input: { code: string; language: string }) => {
 *     // Validate command
 *     const validation = validateCommand(input.code);
 *     if (!validation.valid) {
 *       return `Blocked: ${validation.reason}`;
 *     }
 *
 *     // Create sandbox
 *     const sandbox = await createStrictSandbox();
 *
 *     try {
 *       // Write code to file
 *       const filename = input.language === 'python' ? 'code.py' : 'code.sh';
 *       await sandbox.writeFile(`workspace/${filename}`, input.code);
 *
 *       // Execute in sandbox
 *       const interpreter = input.language === 'python' ? 'python3' : 'bash';
 *       const result = await sandbox.execute(interpreter, [`workspace/${filename}`]);
 *
 *       if (result.timedOut) {
 *         return 'Execution timed out';
 *       }
 *
 *       return result.success
 *         ? result.stdout || 'Completed with no output'
 *         : `Error: ${result.stderr}`;
 *     } finally {
 *       await sandbox.cleanup();
 *     }
 *   },
 * };
 * ```
 */

