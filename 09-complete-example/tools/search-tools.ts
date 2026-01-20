/**
 * search-tools.ts - Search and Analysis Tools
 *
 * Derivation:
 * - Report 26: "Search is how agents explore codebases"
 * - Unix Philosophy: "grep, find, awk - the original search tools"
 * - IDE Patterns: "Code navigation is search + semantics"
 *
 * Search tools allow agents to find and analyze content
 * across files and directories.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Tool, createTool } from '../../02-tool-design/tool-types';
import { AgentConfig, isPathAllowed } from '../config';

// =============================================================================
// Grep Tool
// =============================================================================

/**
 * Create a grep-like search tool.
 *
 * Derivation (Ephemeral Results):
 * "Search results are context, not state. Keep only what's needed."
 */
export function createGrepTool(config: AgentConfig): Tool {
  return createTool({
    name: 'grep',
    description: 'Search for a pattern in files. Returns matching lines with context.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'The regex pattern to search for',
        },
        path: {
          type: 'string',
          description: 'The file or directory to search in',
        },
        recursive: {
          type: 'boolean',
          description: 'Search recursively in directories (default: true)',
        },
        filePattern: {
          type: 'string',
          description: 'File pattern to match (e.g., "*.ts")',
        },
        contextLines: {
          type: 'number',
          description: 'Number of context lines before and after match',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results to return',
        },
        caseSensitive: {
          type: 'boolean',
          description: 'Case-sensitive search (default: false)',
        },
      },
      required: ['pattern', 'path'],
    },
    execute: async (input: {
      pattern: string;
      path: string;
      recursive?: boolean;
      filePattern?: string;
      contextLines?: number;
      maxResults?: number;
      caseSensitive?: boolean;
    }): Promise<string> => {
      // Validate path
      const resolved = path.resolve(input.path);
      if (!isPathAllowed(resolved, config)) {
        throw new Error(`Path not allowed: ${resolved}`);
      }

      try {
        const regex = new RegExp(
          input.pattern,
          input.caseSensitive ? 'g' : 'gi'
        );
        const maxResults = input.maxResults || 100;
        const contextLines = input.contextLines || 2;
        const recursive = input.recursive !== false;

        const results: SearchResult[] = [];
        await searchFiles(
          resolved,
          regex,
          results,
          recursive,
          input.filePattern,
          maxResults,
          contextLines,
          config
        );

        if (results.length === 0) {
          return `No matches found for pattern: ${input.pattern}`;
        }

        // Format results
        const formatted = results.map(r =>
          `${r.file}:${r.line}: ${r.content}${r.context ? '\n' + r.context : ''}`
        ).join('\n\n');

        return formatted;
      } catch (error) {
        throw new Error(`Search failed: ${error}`);
      }
    },
  }) as unknown as Tool;
}

interface SearchResult {
  file: string;
  line: number;
  content: string;
  context?: string;
}

/**
 * Search files recursively.
 */
async function searchFiles(
  searchPath: string,
  regex: RegExp,
  results: SearchResult[],
  recursive: boolean,
  filePattern: string | undefined,
  maxResults: number,
  contextLines: number,
  config: AgentConfig
): Promise<void> {
  if (results.length >= maxResults) return;

  const stats = await fs.stat(searchPath);

  if (stats.isFile()) {
    // Check file pattern
    if (filePattern && !matchPattern(path.basename(searchPath), filePattern)) {
      return;
    }

    // Check file size
    if (stats.size > config.safety.maxFileSize) {
      return;
    }

    await searchInFile(searchPath, regex, results, maxResults, contextLines);
  } else if (stats.isDirectory() && recursive) {
    const entries = await fs.readdir(searchPath);

    for (const entry of entries) {
      if (results.length >= maxResults) break;

      // Skip hidden directories and node_modules
      if (entry.startsWith('.') || entry === 'node_modules') {
        continue;
      }

      const entryPath = path.join(searchPath, entry);
      if (isPathAllowed(entryPath, config)) {
        await searchFiles(
          entryPath,
          regex,
          results,
          recursive,
          filePattern,
          maxResults,
          contextLines,
          config
        );
      }
    }
  }
}

/**
 * Search within a single file.
 */
async function searchInFile(
  filePath: string,
  regex: RegExp,
  results: SearchResult[],
  maxResults: number,
  contextLines: number
): Promise<void> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (results.length >= maxResults) break;

      if (regex.test(lines[i])) {
        // Get context
        const contextBefore = lines
          .slice(Math.max(0, i - contextLines), i)
          .map((l, idx) => `  ${i - contextLines + idx + 1}: ${l}`)
          .join('\n');
        const contextAfter = lines
          .slice(i + 1, i + 1 + contextLines)
          .map((l, idx) => `  ${i + idx + 2}: ${l}`)
          .join('\n');

        results.push({
          file: filePath,
          line: i + 1,
          content: lines[i],
          context: contextLines > 0
            ? [contextBefore, `> ${i + 1}: ${lines[i]}`, contextAfter]
                .filter(Boolean)
                .join('\n')
            : undefined,
        });
      }
    }
  } catch {
    // Skip files that can't be read (binary, permissions, etc.)
  }
}

/**
 * Simple glob-like pattern matching.
 */
function matchPattern(filename: string, pattern: string): boolean {
  const regex = new RegExp(
    '^' +
    pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.') +
    '$'
  );
  return regex.test(filename);
}

// =============================================================================
// Find Tool
// =============================================================================

/**
 * Create a find-like tool for locating files.
 */
export function createFindTool(config: AgentConfig): Tool {
  return createTool({
    name: 'find',
    description: 'Find files matching a pattern.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The directory to search in',
        },
        name: {
          type: 'string',
          description: 'File name pattern to match (e.g., "*.ts")',
        },
        type: {
          type: 'string',
          description: 'Type to find: "file" or "directory"',
          enum: ['file', 'directory'],
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum depth to search',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results',
        },
      },
      required: ['path'],
    },
    execute: async (input: {
      path: string;
      name?: string;
      type?: 'file' | 'directory';
      maxDepth?: number;
      maxResults?: number;
    }): Promise<string> => {
      const resolved = path.resolve(input.path);
      if (!isPathAllowed(resolved, config)) {
        throw new Error(`Path not allowed: ${resolved}`);
      }

      try {
        const results: string[] = [];
        await findFiles(
          resolved,
          results,
          input.name,
          input.type,
          input.maxDepth || 10,
          input.maxResults || 100,
          0,
          config
        );

        if (results.length === 0) {
          return 'No files found matching criteria';
        }

        return results.join('\n');
      } catch (error) {
        throw new Error(`Find failed: ${error}`);
      }
    },
  }) as unknown as Tool;
}

/**
 * Recursively find files.
 */
async function findFiles(
  searchPath: string,
  results: string[],
  namePattern: string | undefined,
  typeFilter: 'file' | 'directory' | undefined,
  maxDepth: number,
  maxResults: number,
  currentDepth: number,
  config: AgentConfig
): Promise<void> {
  if (currentDepth > maxDepth || results.length >= maxResults) {
    return;
  }

  try {
    const entries = await fs.readdir(searchPath, { withFileTypes: true });

    for (const entry of entries) {
      if (results.length >= maxResults) break;

      // Skip hidden entries
      if (entry.name.startsWith('.')) continue;

      const entryPath = path.join(searchPath, entry.name);

      // Check if entry matches criteria
      const isFile = entry.isFile();
      const isDir = entry.isDirectory();
      const nameMatches = !namePattern || matchPattern(entry.name, namePattern);
      const typeMatches =
        !typeFilter ||
        (typeFilter === 'file' && isFile) ||
        (typeFilter === 'directory' && isDir);

      if (nameMatches && typeMatches) {
        results.push(entryPath);
      }

      // Recurse into directories
      if (isDir && isPathAllowed(entryPath, config)) {
        await findFiles(
          entryPath,
          results,
          namePattern,
          typeFilter,
          maxDepth,
          maxResults,
          currentDepth + 1,
          config
        );
      }
    }
  } catch {
    // Skip directories that can't be read
  }
}

// =============================================================================
// Analyze Tool
// =============================================================================

/**
 * Create a code analysis tool.
 *
 * Derivation (Agent Capabilities):
 * "Agents need to understand code, not just find it.
 * Analysis tools bridge search and understanding."
 */
export function createAnalyzeTool(config: AgentConfig): Tool {
  return createTool({
    name: 'analyze_code',
    description: 'Analyze a code file and return structural information.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The path to the file to analyze',
        },
      },
      required: ['path'],
    },
    execute: async (input: { path: string }): Promise<string> => {
      const resolved = path.resolve(input.path);
      if (!isPathAllowed(resolved, config)) {
        throw new Error(`Path not allowed: ${resolved}`);
      }

      try {
        const content = await fs.readFile(resolved, 'utf-8');
        const analysis = analyzeCode(content, resolved);

        return formatAnalysis(analysis);
      } catch (error) {
        throw new Error(`Analysis failed: ${error}`);
      }
    },
  }) as unknown as Tool;
}

interface CodeAnalysis {
  language: string;
  lines: number;
  functions: string[];
  classes: string[];
  imports: string[];
  exports: string[];
}

/**
 * Simple code analysis (language-agnostic heuristics).
 */
function analyzeCode(content: string, filePath: string): CodeAnalysis {
  const lines = content.split('\n');
  const ext = path.extname(filePath);

  // Detect language
  const languageMap: Record<string, string> = {
    '.ts': 'TypeScript',
    '.tsx': 'TypeScript (React)',
    '.js': 'JavaScript',
    '.jsx': 'JavaScript (React)',
    '.py': 'Python',
    '.go': 'Go',
    '.rs': 'Rust',
    '.java': 'Java',
  };
  const language = languageMap[ext] || 'Unknown';

  // Extract functions (simplified)
  const functionPatterns = [
    /function\s+(\w+)/g,           // function name()
    /const\s+(\w+)\s*=\s*(?:async\s*)?\(/g,  // const name = () or const name = async (
    /(\w+)\s*:\s*(?:async\s*)?\([^)]*\)\s*=>/g,  // name: () =>
    /def\s+(\w+)/g,                // Python
    /func\s+(\w+)/g,               // Go
    /fn\s+(\w+)/g,                 // Rust
  ];

  const functions: string[] = [];
  for (const pattern of functionPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      if (match[1] && !functions.includes(match[1])) {
        functions.push(match[1]);
      }
    }
  }

  // Extract classes
  const classPatterns = [
    /class\s+(\w+)/g,
    /interface\s+(\w+)/g,
    /type\s+(\w+)\s*=/g,
  ];

  const classes: string[] = [];
  for (const pattern of classPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      if (match[1] && !classes.includes(match[1])) {
        classes.push(match[1]);
      }
    }
  }

  // Extract imports
  const importPatterns = [
    /import\s+.*?from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /from\s+(\S+)\s+import/g,  // Python
  ];

  const imports: string[] = [];
  for (const pattern of importPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      if (match[1] && !imports.includes(match[1])) {
        imports.push(match[1]);
      }
    }
  }

  // Extract exports
  const exportPatterns = [
    /export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type)\s+(\w+)/g,
    /export\s*{\s*([^}]+)\s*}/g,
    /module\.exports\s*=\s*(\w+)/g,
  ];

  const exports: string[] = [];
  for (const pattern of exportPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const names = match[1].split(',').map(s => s.trim());
      for (const name of names) {
        if (name && !exports.includes(name)) {
          exports.push(name);
        }
      }
    }
  }

  return {
    language,
    lines: lines.length,
    functions,
    classes,
    imports,
    exports,
  };
}

/**
 * Format analysis for output.
 */
function formatAnalysis(analysis: CodeAnalysis): string {
  const sections: string[] = [
    `Language: ${analysis.language}`,
    `Lines: ${analysis.lines}`,
  ];

  if (analysis.functions.length > 0) {
    sections.push(`Functions (${analysis.functions.length}): ${analysis.functions.join(', ')}`);
  }

  if (analysis.classes.length > 0) {
    sections.push(`Classes/Types (${analysis.classes.length}): ${analysis.classes.join(', ')}`);
  }

  if (analysis.imports.length > 0) {
    sections.push(`Imports (${analysis.imports.length}): ${analysis.imports.join(', ')}`);
  }

  if (analysis.exports.length > 0) {
    sections.push(`Exports (${analysis.exports.length}): ${analysis.exports.join(', ')}`);
  }

  return sections.join('\n');
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create all search tools.
 */
export function createSearchTools(config: AgentConfig): Tool[] {
  return [
    createGrepTool(config),
    createFindTool(config),
    createAnalyzeTool(config),
  ];
}

