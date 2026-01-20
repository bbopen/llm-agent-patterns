/**
 * basic-tools.ts - Common Tool Implementations
 *
 * Derivation:
 * - Report 28: "Give the model complete action space"
 * - Report 11 (Claude Code): File, search, execute tools
 * - Ashby: Tools expand agent variety to match task complexity
 *
 * These are the fundamental tools most agents need.
 * Start here, add domain-specific tools as needed.
 */

import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createTool, Tool } from '../tool-types';

const execAsync = promisify(exec);

// =============================================================================
// File System Tools
// =============================================================================

/**
 * Read file contents.
 *
 * Derivation (Report 11):
 * Claude Code's Read tool is the most frequently used tool.
 * Agents need to observe state before taking action.
 */
export const readFileTool: Tool<{ path: string; encoding?: 'utf-8' | 'ascii' | 'base64' }> = createTool({
  name: 'read_file',
  description: `Read the contents of a file at the specified path.
Returns the file contents as a string.
Returns an error if the file doesn't exist or can't be read.`,
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute or relative path to the file',
      },
      encoding: {
        type: 'string',
        description: 'File encoding (default: utf-8)',
        enum: ['utf-8', 'ascii', 'base64'],
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
  inputValidator: z.object({
    path: z.string().min(1),
    encoding: z.enum(['utf-8', 'ascii', 'base64']).optional().default('utf-8'),
  }),
  execute: async ({ path: filePath, encoding = 'utf-8' }) => {
    const content = await fs.readFile(filePath, encoding as BufferEncoding);
    return content;
  },
});

/**
 * Write file contents.
 *
 * Derivation (Report 28):
 * Restricted action spaces ("no write for safety") cause more failures
 * than they prevent. Validation layer handles safety.
 */
export const writeFileTool: Tool<{ path: string; content: string }> = createTool({
  name: 'write_file',
  description: `Write content to a file at the specified path.
Creates the file if it doesn't exist, overwrites if it does.
Creates parent directories if needed.`,
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute or relative path to the file',
      },
      content: {
        type: 'string',
        description: 'Content to write to the file',
      },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  inputValidator: z.object({
    path: z.string().min(1),
    content: z.string(),
  }),
  execute: async ({ path: filePath, content }) => {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(filePath, content, 'utf-8');
    return `Successfully wrote ${content.length} characters to ${filePath}`;
  },
});

/**
 * List directory contents.
 */
export const listDirectoryTool: Tool<{ path: string }> = createTool({
  name: 'list_directory',
  description: `List files and directories at the specified path.
Returns a list of entries with their types (file/directory).`,
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the directory to list',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
  inputValidator: z.object({
    path: z.string().min(1),
  }),
  execute: async ({ path: dirPath }) => {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const formatted = entries.map(entry => {
      const type = entry.isDirectory() ? '[DIR]' : '[FILE]';
      return `${type} ${entry.name}`;
    });
    return formatted.join('\n');
  },
});

// =============================================================================
// Search Tools
// =============================================================================

/**
 * Search for files by pattern.
 *
 * Derivation (Report 11):
 * Glob tool enables agents to discover relevant files
 * without needing to know exact paths.
 */
export const searchFilesTool: Tool<{
  pattern: string;
  directory?: string;
}> = createTool({
  name: 'search_files',
  description: `Search for files matching a glob pattern.
Returns list of matching file paths.

Examples:
- "*.ts" - TypeScript files in current directory
- "**/*.md" - All markdown files recursively
- "src/**/*.test.ts" - Test files in src`,
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern to match files',
      },
      directory: {
        type: 'string',
        description: 'Starting directory (default: current directory)',
      },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  inputValidator: z.object({
    pattern: z.string().min(1),
    directory: z.string().optional(),
  }),
  execute: async ({ pattern, directory = '.' }) => {
    // Simple implementation using find command
    // In production, use a proper glob library
    const { stdout } = await execAsync(
      `find "${directory}" -type f -name "${pattern}" 2>/dev/null | head -100`
    );
    return stdout.trim() || 'No matching files found';
  },
});

/**
 * Search file contents.
 *
 * Derivation (Report 11):
 * Grep tool is essential for understanding codebases.
 * Agents use it to find relevant code without reading entire files.
 */
export const searchContentTool: Tool<{
  pattern: string;
  path?: string;
  ignoreCase?: boolean;
}> = createTool({
  name: 'search_content',
  description: `Search for content matching a regex pattern.
Returns matching lines with file paths and line numbers.

Examples:
- "function.*export" - Find exported functions
- "TODO|FIXME" - Find todo comments
- "import.*from" - Find import statements`,
  inputSchema: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Regex pattern to search for',
      },
      path: {
        type: 'string',
        description: 'File or directory to search (default: current directory)',
      },
      ignoreCase: {
        type: 'boolean',
        description: 'Ignore case in pattern matching',
      },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  inputValidator: z.object({
    pattern: z.string().min(1),
    path: z.string().optional().default('.'),
    ignoreCase: z.boolean().optional().default(false),
  }),
  execute: async ({ pattern, path: searchPath = '.', ignoreCase = false }) => {
    const flags = ignoreCase ? '-rni' : '-rn';
    try {
      const { stdout } = await execAsync(
        `grep ${flags} "${pattern}" "${searchPath}" 2>/dev/null | head -50`
      );
      return stdout.trim() || 'No matches found';
    } catch {
      return 'No matches found';
    }
  },
});

// =============================================================================
// Execution Tools
// =============================================================================

/**
 * Execute shell command.
 *
 * Derivation (Report 28):
 * "Claude Code can write AppleScript directly. It doesn't need a
 * Spotify tool. It just writes AppleScript on macOS."
 *
 * Shell access provides complete action space.
 * Validation layer handles safety (see 03-validation).
 */
export const executeCommandTool: Tool<{
  command: string;
  cwd?: string;
  timeout?: number;
}> = createTool({
  name: 'execute_command',
  description: `Execute a shell command and return the output.
Use this for running builds, tests, git commands, etc.

The command runs with a timeout to prevent hanging.
Both stdout and stderr are captured.`,
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Shell command to execute',
      },
      cwd: {
        type: 'string',
        description: 'Working directory for command execution',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 30000)',
        minimum: 1000,
        maximum: 300000,
      },
    },
    required: ['command'],
    additionalProperties: false,
  },
  inputValidator: z.object({
    command: z.string().min(1),
    cwd: z.string().optional(),
    timeout: z.number().min(1000).max(300000).optional().default(30000),
  }),
  execute: async ({ command, cwd, timeout = 30000 }) => {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });

      const output: string[] = [];
      if (stdout.trim()) output.push(`STDOUT:\n${stdout.trim()}`);
      if (stderr.trim()) output.push(`STDERR:\n${stderr.trim()}`);

      return output.join('\n\n') || 'Command completed with no output';
    } catch (error: any) {
      return `Error: ${error.message}\n${error.stderr || ''}`;
    }
  },
});

// =============================================================================
// Tool Collection
// =============================================================================

/**
 * Standard tool set for most agents.
 *
 * Derivation (Ashby's Requisite Variety):
 * This set provides variety matching most development tasks.
 * Add domain-specific tools as needed.
 */
export const standardTools: Tool<any>[] = [
  readFileTool,
  writeFileTool,
  listDirectoryTool,
  searchFilesTool,
  searchContentTool,
  executeCommandTool,
];

/**
 * Read-only tool set for exploration.
 *
 * Use when:
 * - Gathering information before taking action
 * - Sub-agents that should not modify state
 */
export const readOnlyTools: Tool<any>[] = [
  readFileTool,
  listDirectoryTool,
  searchFilesTool,
  searchContentTool,
];
