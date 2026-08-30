import { exec } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { ToolSchema } from '../providers/types.ts';

const MAX_OUTPUT = 20_000;

export type ToolContext = {
  cwd: string;
  allowedCommands: string[];
  deniedPatterns: string[];
  timeoutMs: number;
};

export type ToolRun = {
  output: string;
  /** Set by `finish` so the agent loop knows the task is complete. */
  finished?: boolean;
  summary?: string;
  isError?: boolean;
};

function clip(text: string): string {
  if (text.length <= MAX_OUTPUT) return text;
  return `${text.slice(0, MAX_OUTPUT)}\n… [truncated ${text.length - MAX_OUTPUT} chars]`;
}

/** Blocks path traversal outside the task workspace. */
function safePath(context: ToolContext, input: unknown): string {
  const raw = typeof input === 'string' && input.trim() ? input.trim() : '.';
  const target = resolve(context.cwd, raw);
  if (target !== context.cwd && !target.startsWith(context.cwd + sep)) {
    throw new Error(`path escapes the workspace: ${raw}`);
  }
  return target;
}

export function assertCommandAllowed(context: ToolContext, command: string): void {
  const normalized = command.trim();
  if (!normalized) throw new Error('empty command');

  for (const pattern of context.deniedPatterns) {
    if (normalized.includes(pattern)) {
      throw new Error(`command blocked by policy (matched "${pattern}")`);
    }
  }

  // Every chained segment must independently start with an allowed binary.
  const segments = normalized.split(/&&|\|\||;|\|/g).map((part) => part.trim()).filter(Boolean);
  for (const segment of segments) {
    // A leading VAR=value belongs to the command, not to the binary being run:
    // "DEVELOPER_DIR=/… xcodebuild build" is still xcodebuild.
    const binary = segment.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/, '');
    const allowed = context.allowedCommands.some((prefix) =>
      binary === prefix || binary.startsWith(`${prefix} `),
    );
    if (!allowed) {
      throw new Error(
        `command "${binary.split(' ')[0]}" is not in allowedCommands. ` +
        'Add it to super-agent.config.json if the task genuinely needs it.',
      );
    }
  }
}

export function runShell(
  command: string,
  options: { cwd: string; timeoutMs: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    exec(
      command,
      { cwd: options.cwd, timeout: options.timeoutMs, maxBuffer: 8 * 1024 * 1024, shell: '/bin/bash' },
      (error, stdout, stderr) => {
        const code = error && typeof (error as { code?: number }).code === 'number'
          ? (error as { code?: number }).code ?? 1
          : error ? 1 : 0;
        done({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'list_dir',
    description: 'List files and folders at a path inside the project workspace.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative path. Defaults to the project root.' } },
      required: [],
    },
  },
  {
    name: 'read_file',
    description: 'Read a text file from the workspace. Always read a file before editing it.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path.' },
        start_line: { type: 'number', description: 'Optional 1-indexed first line.' },
        line_count: { type: 'number', description: 'Optional number of lines to read.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create a file or replace its entire contents. Prefer edit_file for small changes.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path.' },
        content: { type: 'string', description: 'Full file contents.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Replace an exact snippet in a file. old_text must match the file byte for byte.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path.' },
        old_text: { type: 'string', description: 'Exact text to replace.' },
        new_text: { type: 'string', description: 'Replacement text.' },
        replace_all: { type: 'boolean', description: 'Replace every occurrence instead of requiring a unique match.' },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
  {
    name: 'search',
    description: 'Search the workspace for a regular expression and return matching lines with file paths.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Regular expression to search for.' },
        path: { type: 'string', description: 'Optional subdirectory to limit the search.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'run_command',
    description: 'Run a shell command in the workspace, such as installing dependencies, building, or running tests.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command line to run.' },
        reason: { type: 'string', description: 'Why this command is needed.' },
      },
      required: ['command'],
    },
  },
  {
    name: 'git_diff',
    description: 'Show the uncommitted diff of everything changed so far in the workspace.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'finish',
    description:
      'Call when the task is fully implemented. Provide a summary of what changed and how it was verified.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'What was changed, file by file, and why.' },
      },
      required: ['summary'],
    },
  },
];

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', '.next', '.vinext', '.wrangler', 'target', '__pycache__']);

export async function runTool(
  context: ToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolRun> {
  try {
    switch (name) {
      case 'list_dir': {
        const dir = safePath(context, args.path);
        const entries = await readdir(dir, { withFileTypes: true });
        const lines = await Promise.all(
          entries
            .filter((entry) => !IGNORED_DIRS.has(entry.name))
            .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
            .map(async (entry) => {
              if (entry.isDirectory()) return `${entry.name}/`;
              const info = await stat(join(dir, entry.name)).catch(() => null);
              return `${entry.name}${info ? `  (${info.size} bytes)` : ''}`;
            }),
        );
        return { output: lines.length ? lines.join('\n') : '(empty directory)' };
      }

      case 'read_file': {
        const file = safePath(context, args.path);
        const content = await readFile(file, 'utf8');
        const lines = content.split('\n');
        const start = Math.max(1, Number(args.start_line ?? 1));
        const count = Number(args.line_count ?? lines.length);
        const slice = lines.slice(start - 1, start - 1 + count);
        return {
          output: clip(slice.map((line, index) => `${start + index}\t${line}`).join('\n')),
        };
      }

      case 'write_file': {
        const file = safePath(context, args.path);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, String(args.content ?? ''), 'utf8');
        return { output: `Wrote ${relative(context.cwd, file)}` };
      }

      case 'edit_file': {
        const file = safePath(context, args.path);
        const original = await readFile(file, 'utf8');
        const oldText = String(args.old_text ?? '');
        const newText = String(args.new_text ?? '');
        if (!original.includes(oldText)) {
          return {
            isError: true,
            output: `old_text was not found in ${relative(context.cwd, file)}. Read the file again and copy the exact text.`,
          };
        }
        const occurrences = original.split(oldText).length - 1;
        if (occurrences > 1 && args.replace_all !== true) {
          return {
            isError: true,
            output: `old_text appears ${occurrences} times. Include more surrounding context or set replace_all.`,
          };
        }
        const updated = args.replace_all === true
          ? original.split(oldText).join(newText)
          : original.replace(oldText, newText);
        await writeFile(file, updated, 'utf8');
        return { output: `Edited ${relative(context.cwd, file)} (${occurrences} occurrence(s) considered)` };
      }

      case 'search': {
        const query = String(args.query ?? '');
        const scope = args.path ? relative(context.cwd, safePath(context, args.path)) || '.' : '.';
        const excludes = [...IGNORED_DIRS].map((dir) => `--exclude-dir=${dir}`).join(' ');
        const command = `grep -rnI -m 200 ${excludes} -E ${JSON.stringify(query)} ${JSON.stringify(scope)} || true`;
        const result = await runShell(command, { cwd: context.cwd, timeoutMs: 30_000 });
        return { output: clip(result.stdout.trim() || '(no matches)') };
      }

      case 'run_command': {
        const command = String(args.command ?? '');
        assertCommandAllowed(context, command);
        const result = await runShell(command, { cwd: context.cwd, timeoutMs: context.timeoutMs });
        const body = [
          `exit code: ${result.code}`,
          result.stdout.trim() && `stdout:\n${result.stdout.trim()}`,
          result.stderr.trim() && `stderr:\n${result.stderr.trim()}`,
        ].filter(Boolean).join('\n\n');
        return { output: clip(body), isError: result.code !== 0 };
      }

      case 'git_diff': {
        const result = await runShell('git add -A && git diff --cached', {
          cwd: context.cwd,
          timeoutMs: 60_000,
        });
        return { output: clip(result.stdout.trim() || '(no changes yet)') };
      }

      case 'finish': {
        const summary = String(args.summary ?? 'Task complete.');
        return { output: 'Task marked complete.', finished: true, summary };
      }

      default:
        return { isError: true, output: `Unknown tool: ${name}` };
    }
  } catch (error) {
    return { isError: true, output: `Error: ${(error as Error).message}` };
  }
}
