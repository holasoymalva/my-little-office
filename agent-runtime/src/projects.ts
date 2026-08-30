import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { homedir } from 'node:os';
import { runShell } from './agent/tools.ts';
import { CONFIG_PATH } from './config.ts';
import { REPO_ROOT } from './env.ts';
import type { ProjectConfig, RuntimeConfig } from './types.ts';

/**
 * Projects are the repositories agents may work on. They can be declared up
 * front in super-agent.config.json, or pointed at from the dashboard the way
 * you would `cd` into a directory — inspect a path, confirm the commands, work.
 */

let config: RuntimeConfig;

export function initProjects(runtimeConfig: RuntimeConfig): void {
  config = runtimeConfig;
}

export type ProjectInspection = {
  path: string;
  exists: boolean;
  isGitRepo: boolean;
  remoteUrl?: string;
  baseBranch?: string;
  currentBranch?: string;
  dirty?: boolean;
  stack?: string;
  suggestedId: string;
  suggestedName: string;
  suggestedSetup: string[];
  suggestedVerify: string[];
  problem?: string;
};

export function expandPath(input: string): string {
  const trimmed = input.trim().replace(/^["']|["']$/g, '');
  const home = trimmed === '~' || trimmed.startsWith('~/')
    ? resolve(homedir(), trimmed.slice(2))
    : trimmed;
  return isAbsolute(home) ? resolve(home) : resolve(REPO_ROOT, home);
}

export function slugifyId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'project';
}

/** "https://github.com/you/web-app.git" -> "web-app" */
export function repoName(url: string): string {
  const last = url.trim().replace(/\/+$/, '').split(/[/:]/).pop() ?? 'project';
  return last.replace(/\.git$/, '') || 'project';
}

async function git(dir: string, args: string): Promise<string | undefined> {
  const result = await runShell(`git ${args}`, { cwd: dir, timeoutMs: 15_000 });
  return result.code === 0 ? result.stdout.trim() : undefined;
}

function readJson(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * An Xcode build needs a full Xcode, not the command line tools. When the
 * active developer directory is not one, the command carries the path itself,
 * which works without the sudo that `xcode-select -s` would need.
 */
async function developerDirPrefix(): Promise<string> {
  const active = await runShell('xcode-select -p', { cwd: REPO_ROOT, timeoutMs: 10_000 });
  if (active.code === 0 && active.stdout.includes('.app/Contents/Developer')) return '';
  return existsSync('/Applications/Xcode.app')
    ? 'DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer '
    : '';
}

/** Reads the repository to guess how it is installed and how it proves itself. */
async function detectCommands(dir: string): Promise<{ stack?: string; setup: string[]; verify: string[] }> {
  const packageJson = readJson(resolve(dir, 'package.json'));
  if (packageJson) {
    const scripts = (packageJson.scripts as Record<string, string> | undefined) ?? {};
    const manager = existsSync(resolve(dir, 'pnpm-lock.yaml'))
      ? 'pnpm'
      : existsSync(resolve(dir, 'yarn.lock'))
        ? 'yarn'
        : 'npm';
    const run = (script: string) => (manager === 'npm' ? `npm run ${script}` : `${manager} ${script}`);
    const setup = manager === 'npm' ? 'npm install --no-audit --no-fund' : `${manager} install`;
    const verify: string[] = [];
    for (const script of ['lint', 'typecheck', 'test', 'build']) {
      if (scripts[script]) verify.push(script === 'test' && manager === 'npm' ? 'npm test' : run(script));
    }
    return { stack: `Node (${manager})`, setup: [setup], verify };
  }

  const xcodeProject = readdirSync(dir).find((entry) => entry.endsWith('.xcodeproj'));
  if (xcodeProject) {
    // The scheme usually matches the project name; the user confirms it before saving.
    const scheme = xcodeProject.replace(/\.xcodeproj$/, '');
    return {
      stack: 'Xcode (Swift)',
      setup: [],
      verify: [
        `${await developerDirPrefix()}xcodebuild -project ${xcodeProject} -scheme ${JSON.stringify(scheme)} ` +
        "-destination 'generic/platform=iOS Simulator' -configuration Debug " +
        'CODE_SIGNING_ALLOWED=NO build',
      ],
    };
  }
  if (existsSync(resolve(dir, 'Package.swift'))) {
    return { stack: 'Swift package', setup: [], verify: ['swift build', 'swift test'] };
  }
  if (existsSync(resolve(dir, 'Cargo.toml'))) {
    return { stack: 'Rust (cargo)', setup: [], verify: ['cargo build', 'cargo test'] };
  }
  if (existsSync(resolve(dir, 'go.mod'))) {
    return { stack: 'Go', setup: [], verify: ['go build ./...', 'go test ./...'] };
  }
  if (existsSync(resolve(dir, 'pyproject.toml'))) {
    return { stack: 'Python (pyproject)', setup: ['pip install -e .'], verify: ['pytest'] };
  }
  if (existsSync(resolve(dir, 'requirements.txt'))) {
    return { stack: 'Python', setup: ['pip install -r requirements.txt'], verify: ['pytest'] };
  }
  if (existsSync(resolve(dir, 'Makefile'))) {
    return { stack: 'Make', setup: [], verify: ['make test'] };
  }
  return { setup: [], verify: [] };
}

/** Everything the dashboard needs to prefill the "add a project" form. */
export async function inspectPath(rawPath: string): Promise<ProjectInspection> {
  const path = expandPath(rawPath);
  const name = basename(path) || 'project';
  const base: ProjectInspection = {
    path,
    exists: existsSync(path),
    isGitRepo: false,
    suggestedId: slugifyId(name),
    suggestedName: name,
    suggestedSetup: [],
    suggestedVerify: [],
  };

  if (!base.exists) return { ...base, problem: `No such directory: ${path}` };

  const topLevel = await git(path, 'rev-parse --show-toplevel');
  if (!topLevel) {
    return { ...base, problem: `${path} is not a git repository. Run "git init" there first.` };
  }

  const root = resolve(topLevel);
  const detected = await detectCommands(root);
  const remoteUrl = await git(root, 'remote get-url origin');
  const currentBranch = await git(root, 'rev-parse --abbrev-ref HEAD');
  const originHead = await git(root, 'symbolic-ref --quiet --short refs/remotes/origin/HEAD');
  const status = await git(root, 'status --porcelain');

  return {
    path: root,
    exists: true,
    isGitRepo: true,
    remoteUrl,
    baseBranch: originHead?.replace(/^origin\//, '') ?? currentBranch ?? 'main',
    currentBranch,
    dirty: Boolean(status),
    stack: detected.stack,
    suggestedId: slugifyId(basename(root)),
    suggestedName: basename(root),
    suggestedSetup: detected.setup,
    suggestedVerify: detected.verify,
  };
}

/**
 * Same idea as inspectPath, for a repository that is not on this machine yet:
 * a shallow throwaway clone is enough to read the default branch and work out
 * how the project installs and checks itself.
 */
export async function inspectRepo(url: string): Promise<ProjectInspection> {
  const repo = url.trim();
  const name = repoName(repo);
  const base: ProjectInspection = {
    path: '',
    exists: false,
    isGitRepo: false,
    remoteUrl: repo,
    suggestedId: slugifyId(name),
    suggestedName: name,
    suggestedSetup: [],
    suggestedVerify: [],
  };

  if (!/^(https?:\/\/|git@|ssh:\/\/)/.test(repo)) {
    return { ...base, problem: 'That does not look like a clone URL. Use https://github.com/owner/repo.git' };
  }

  const scratch = resolve(config.workspaceRoot, '.inspect', slugifyId(name));
  try {
    mkdirSync(resolve(config.workspaceRoot, '.inspect'), { recursive: true });
    rmSync(scratch, { recursive: true, force: true });

    const clone = await runShell(
      `git clone --depth 1 ${JSON.stringify(repo)} ${JSON.stringify(scratch)}`,
      { cwd: config.workspaceRoot, timeoutMs: 180_000 },
    );
    if (clone.code !== 0) {
      return {
        ...base,
        problem: `Cannot clone ${repo}: ${(clone.stderr || clone.stdout).trim().slice(-300)}`,
      };
    }

    const detected = await detectCommands(scratch);
    return {
      ...base,
      exists: true,
      isGitRepo: true,
      baseBranch: (await git(scratch, 'rev-parse --abbrev-ref HEAD')) ?? 'main',
      stack: detected.stack,
      suggestedSetup: detected.setup,
      suggestedVerify: detected.verify,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Finds the span of the `projects` array in the raw file, brackets included. */
function projectsSpan(source: string): { start: number; end: number } | undefined {
  const key = /"projects"\s*:\s*\[/.exec(source);
  if (!key) return undefined;
  let depth = 0;
  for (let index = key.index + key[0].length - 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === '[') depth += 1;
    else if (character === ']') {
      depth -= 1;
      if (depth === 0) return { start: key.index, end: index + 1 };
    }
  }
  return undefined;
}

/**
 * Rewrites only the `projects` key. Reserialising the whole file would work
 * too, but it would reflow every hand-formatted line in a config people edit
 * by hand, so the rest of the text is left byte for byte as it was.
 */
function persistProjects(): void {
  const serialised = `"projects": ${JSON.stringify(config.projects, null, 2)
    .split('\n')
    .join('\n  ')}`;

  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, `{\n  ${serialised}\n}\n`, 'utf8');
    return;
  }

  const source = readFileSync(CONFIG_PATH, 'utf8');
  const span = projectsSpan(source);
  const next = span
    ? source.slice(0, span.start) + serialised + source.slice(span.end)
    : source.replace(/^\s*\{/, `{\n  ${serialised},`);

  // A malformed splice would take the whole config down with it.
  JSON.parse(next);
  writeFileSync(CONFIG_PATH, next, 'utf8');
}

export type ProjectInput = {
  id?: string;
  name?: string;
  path?: string;
  repo?: string;
  baseBranch?: string;
  source?: 'remote' | 'local';
  setup?: string[];
  verify?: string[];
  conventions?: string;
};

function asCommands(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('setup and verify must be arrays of commands');
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}

/**
 * Adds a project, or replaces one with the same id. The path is inspected
 * first: a project pointing at a directory that is not a git checkout would
 * fail at clone time with a much less useful message.
 */
export async function saveProject(input: ProjectInput): Promise<ProjectConfig> {
  if (!input.path && !input.repo) {
    throw new Error('A project needs a path on this machine or a clone URL');
  }

  let inspection: ProjectInspection | undefined;
  if (input.path) {
    inspection = await inspectPath(input.path);
    if (inspection.problem) throw new Error(inspection.problem);
  }

  const id = slugifyId(
    input.id || inspection?.suggestedId || (input.repo ? repoName(input.repo) : 'project'),
  );
  const project: ProjectConfig = {
    id,
    name: (input.name ?? '').trim() || inspection?.suggestedName || (input.repo ? repoName(input.repo) : id),
    path: inspection?.path ?? input.path,
    repo: input.repo?.trim() || undefined,
    baseBranch: (input.baseBranch ?? '').trim() || inspection?.baseBranch || 'main',
    source: input.source ?? (inspection && !inspection.remoteUrl ? 'local' : 'remote'),
    setup: asCommands(input.setup) ?? inspection?.suggestedSetup ?? [],
    verify: asCommands(input.verify) ?? inspection?.suggestedVerify ?? [],
    conventions: input.conventions?.trim() || undefined,
  };

  if (!project.verify.length) {
    throw new Error(
      'A project needs at least one verify command — it is the gate that decides whether work ships.',
    );
  }

  const index = config.projects.findIndex((entry) => entry.id === id);
  if (index === -1) config.projects.push(project);
  else config.projects[index] = project;

  persistProjects();
  return project;
}

export function removeProject(id: string): boolean {
  const index = config.projects.findIndex((entry) => entry.id === id);
  if (index === -1) return false;
  config.projects.splice(index, 1);
  persistProjects();
  return true;
}

export function listProjects(): ProjectConfig[] {
  return config.projects;
}
