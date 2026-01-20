/**
 * file-tools.ts - File Operation Tools
 *
 * Derivation:
 * - Report 26: "File tools are the most common agent capability"
 * - Simon Willison: "Sandbox file operations to prevent escapes"
 * - Unix Philosophy: "Do one thing well"
 *
 * File tools allow agents to read, write, and manipulate files.
 * All operations are sandboxed to allowed paths.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Tool, createTool } from '../../02-tool-design/tool-types';
import { AgentConfig, isPathAllowed } from '../config';

// =============================================================================
// Path Validation
// =============================================================================

/**
 * Validate and resolve a path.
 */
async function validatePath(
  filePath: string,
  config: AgentConfig
): Promise<{ valid: boolean; resolved: string; error?: string }> {
  // Resolve to absolute path
  const resolved = path.resolve(filePath);

  // Check if path is allowed
  if (!isPathAllowed(resolved, config)) {
    return {
      valid: false,
      resolved,
      error: `Path not allowed: ${resolved}. Allowed paths: ${config.safety.allowedPaths.join(', ')}`,
    };
  }

  // Check for path traversal attempts
  const normalized = path.normalize(resolved);
  if (normalized !== resolved) {
    return {
      valid: false,
      resolved,
      error: 'Path traversal detected',
    };
  }

  return { valid: true, resolved };
}

// =============================================================================
// Read File Tool
// =============================================================================

/**
 * Create a read file tool.
 *
 * Derivation (Minimal Privilege):
 * "Read-only by default. Writing is a separate, privileged operation."
 */
export function createReadFileTool(config: AgentConfig): Tool {
  return createTool({
    name: 'read_file',
    description: 'Read the contents of a file. Use this to examine existing code or data.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The path to the file to read',
        },
        encoding: {
          type: 'string',
          description: 'File encoding (default: utf-8)',
          enum: ['utf-8', 'ascii', 'base64'],
        },
        maxLines: {
          type: 'number',
          description: 'Maximum number of lines to read (optional)',
        },
      },
      required: ['path'],
    },
    execute: async (input: {
      path: string;
      encoding?: BufferEncoding;
      maxLines?: number;
    }): Promise<string> => {
      const validation = await validatePath(input.path, config);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      try {
        // Check file size
        const stats = await fs.stat(validation.resolved);
        if (stats.size > config.safety.maxFileSize) {
          throw new Error(`File too large: ${stats.size} bytes (max: ${config.safety.maxFileSize})`);
        }

        // Read file
        const content = await fs.readFile(
          validation.resolved,
          input.encoding || 'utf-8'
        );

        // Optionally limit lines
        let result = content.toString();
        if (input.maxLines && input.maxLines > 0) {
          const lines = result.split('\n');
          if (lines.length > input.maxLines) {
            result = lines.slice(0, input.maxLines).join('\n');
            result += `\n... (${lines.length - input.maxLines} more lines)`;
          }
        }

        return result;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`File not found: ${validation.resolved}`);
        }
        throw new Error(`Failed to read file: ${error}`);
      }
    },
  }) as unknown as Tool;
}

// =============================================================================
// Write File Tool
// =============================================================================

/**
 * Create a write file tool.
 *
 * Derivation (Explicit Intent):
 * "Writing requires explicit content. No implicit modifications."
 */
export function createWriteFileTool(config: AgentConfig): Tool {
  return createTool({
    name: 'write_file',
    description: 'Write content to a file. Creates the file if it does not exist.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The path to the file to write',
        },
        content: {
          type: 'string',
          description: 'The content to write to the file',
        },
        createDirectories: {
          type: 'boolean',
          description: 'Create parent directories if they do not exist',
        },
      },
      required: ['path', 'content'],
    },
    execute: async (input: {
      path: string;
      content: string;
      createDirectories?: boolean;
    }): Promise<string> => {
      const validation = await validatePath(input.path, config);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // Check content size
      const contentSize = Buffer.byteLength(input.content, 'utf-8');
      if (contentSize > config.safety.maxFileSize) {
        throw new Error(`Content too large: ${contentSize} bytes (max: ${config.safety.maxFileSize})`);
      }

      try {
        // Create directories if requested
        if (input.createDirectories) {
          await fs.mkdir(path.dirname(validation.resolved), { recursive: true });
        }

        // Check if file exists (for metadata)
        let existed = false;
        try {
          await fs.access(validation.resolved);
          existed = true;
        } catch {
          // File doesn't exist
        }

        // Write file
        await fs.writeFile(validation.resolved, input.content, 'utf-8');

        return existed
          ? `Updated file: ${validation.resolved}`
          : `Created file: ${validation.resolved}`;
      } catch (error) {
        throw new Error(`Failed to write file: ${error}`);
      }
    },
  }) as unknown as Tool;
}

// =============================================================================
// List Directory Tool
// =============================================================================

/**
 * Create a list directory tool.
 */
export function createListDirectoryTool(config: AgentConfig): Tool {
  return createTool({
    name: 'list_directory',
    description: 'List the contents of a directory.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The path to the directory to list',
        },
        recursive: {
          type: 'boolean',
          description: 'List recursively (default: false)',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum depth for recursive listing',
        },
      },
      required: ['path'],
    },
    execute: async (input: {
      path: string;
      recursive?: boolean;
      maxDepth?: number;
    }): Promise<string> => {
      const validation = await validatePath(input.path, config);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      try {
        const entries = await listDirectory(
          validation.resolved,
          input.recursive || false,
          input.maxDepth || 3,
          0
        );

        return entries.join('\n');
      } catch (error) {
        throw new Error(`Failed to list directory: ${error}`);
      }
    },
  }) as unknown as Tool;
}

/**
 * Recursively list directory contents.
 */
async function listDirectory(
  dirPath: string,
  recursive: boolean,
  maxDepth: number,
  currentDepth: number
): Promise<string[]> {
  const entries: string[] = [];
  const items = await fs.readdir(dirPath, { withFileTypes: true });

  for (const item of items) {
    const itemPath = path.join(dirPath, item.name);
    const prefix = '  '.repeat(currentDepth);

    if (item.isDirectory()) {
      entries.push(`${prefix}${item.name}/`);
      if (recursive && currentDepth < maxDepth) {
        const subEntries = await listDirectory(
          itemPath,
          recursive,
          maxDepth,
          currentDepth + 1
        );
        entries.push(...subEntries);
      }
    } else {
      entries.push(`${prefix}${item.name}`);
    }
  }

  return entries;
}

// =============================================================================
// Delete File Tool
// =============================================================================

/**
 * Create a delete file tool.
 *
 * Derivation (Irreversible Actions):
 * "Deletions are dangerous. Make them explicit and confirmable."
 */
export function createDeleteFileTool(config: AgentConfig): Tool {
  return createTool({
    name: 'delete_file',
    description: 'Delete a file. This action is irreversible.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The path to the file to delete',
        },
      },
      required: ['path'],
    },
    execute: async (input: { path: string }): Promise<string> => {
      const validation = await validatePath(input.path, config);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      try {
        // Verify it's a file, not a directory
        const stats = await fs.stat(validation.resolved);
        if (stats.isDirectory()) {
          throw new Error('Cannot delete directory with this tool. Use delete_directory instead.');
        }

        await fs.unlink(validation.resolved);

        return `Deleted file: ${validation.resolved}`;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`File not found: ${validation.resolved}`);
        }
        throw new Error(`Failed to delete file: ${error}`);
      }
    },
  }) as unknown as Tool;
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create all file tools.
 */
export function createFileTools(config: AgentConfig): Tool[] {
  const tools: Tool[] = [
    createReadFileTool(config),
    createWriteFileTool(config),
    createListDirectoryTool(config),
  ];

  // Only include delete if not in restricted mode
  if (!config.safety.sandboxMode) {
    tools.push(createDeleteFileTool(config));
  }

  return tools;
}

