import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveProjectPath } from '../config.ts';
import { runShell } from '../agent/tools.ts';
import type { ProjectConfig, RuntimeConfig, Task } from '../types.ts';

export type Workspace = {
  dir: string;
  branch: string;
  /** Absent when the project has no GitHub-style remote to open a PR against. */
  remoteUrl?: string;
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'task';
}

async function git(dir: string, args: string): Promise<string> {
  const result = await runShell(`git ${args}`, { cwd: dir, timeoutMs: 300_000 });
  if (result.code !== 0) {
    throw new Error(`git ${args} failed:\n${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result.stdout.trim();
}

/** Resolves where to clone from: explicit repo URL, the checkout's origin, or the path itself. */
async function cloneSource(project: ProjectConfig): Promise<{ source: string; remoteUrl?: string }> {
  if (project.repo) return { source: project.repo, remoteUrl: project.repo };

  const local = resolveProjectPath(project);
  if (!local || !existsSync(local)) {
    throw new Error(
      `Project "${project.id}" has neither a reachable path nor a repo URL. ` +
      'Fix it in super-agent.config.json.',
    );
  }

  const origin = await runShell('git remote get-url origin', { cwd: local, timeoutMs: 15_000 });
  const remoteUrl = origin.code === 0 ? origin.stdout.trim() : undefined;
  // Cloning the remote keeps the user's working tree untouched while still
  // producing a branch that can be pushed and turned into a pull request.
  return remoteUrl ? { source: remoteUrl, remoteUrl } : { source: local };
}

export async function prepareWorkspace(options: {
  task: Task;
  project: ProjectConfig;
  config: RuntimeConfig;
  onLog: (message: string) => void;
}): Promise<Workspace> {
  const { task, project, config, onLog } = options;
  const dir = join(config.workspaceRoot, task.id);
  const branch = `agent/${slugify(task.source.ref ?? task.title)}-${task.id.slice(-6)}`;

  await rm(dir, { recursive: true, force: true });
  await mkdir(config.workspaceRoot, { recursive: true });

  const { source, remoteUrl } = await cloneSource(project);
  onLog(`Cloning ${source}`);
  await git(config.workspaceRoot, `clone --no-single-branch ${JSON.stringify(source)} ${JSON.stringify(dir)}`);

  await git(dir, `checkout ${JSON.stringify(project.baseBranch)}`);
  await git(dir, `checkout -b ${JSON.stringify(branch)}`);
  await git(dir, 'config user.name "Super Agent"');
  await git(dir, 'config user.email "super-agent@localhost"');

  for (const command of project.setup ?? []) {
    onLog(`Setup: ${command}`);
    const result = await runShell(command, { cwd: dir, timeoutMs: config.commandTimeoutMs });
    if (result.code !== 0) {
      throw new Error(
        `Setup command failed: ${command}\n${(result.stderr || result.stdout).slice(-2000)}`,
      );
    }
  }

  return { dir, branch, remoteUrl };
}

export async function collectChanges(dir: string): Promise<{ diffStat: string; files: string[] }> {
  await runShell('git add -A', { cwd: dir, timeoutMs: 60_000 });
  const stat = await runShell('git diff --cached --stat', { cwd: dir, timeoutMs: 60_000 });
  const names = await runShell('git diff --cached --name-only', { cwd: dir, timeoutMs: 60_000 });
  return {
    diffStat: stat.stdout.trim(),
    files: names.stdout.split('\n').map((line) => line.trim()).filter(Boolean),
  };
}

export async function discardWorkspace(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
