import { runShell } from '../agent/tools.ts';
import type { Task } from '../types.ts';
import type { Workspace } from './workspace.ts';

export type DeliveryResult = {
  committed: boolean;
  pushed: boolean;
  prUrl?: string;
  note?: string;
};

function commitMessage(task: Task): string {
  const scope = task.source.ref ? `${task.source.ref}: ` : '';
  return `${scope}${task.title}`;
}

function pullRequestBody(task: Task): string {
  return [
    task.summary ?? 'Automated change.',
    '',
    task.plan ? `## Plan\n${task.plan}\n` : '',
    `## Verification\n${task.verifyPassed ? 'Project verify commands passed.' : 'Not verified.'}`,
    '',
    task.source.url ? `Linear: ${task.source.url}` : '',
    '',
    `Produced by ${task.agentId} (${task.provider} / ${task.model}) via My Little Office.`,
  ].filter(Boolean).join('\n');
}

/**
 * Commits the agent's work, pushes the branch and opens a pull request. Each
 * step degrades gracefully: a missing remote still leaves a local commit behind.
 */
export async function deliverTask(options: {
  task: Task;
  workspace: Workspace;
  baseBranch: string;
  onLog: (message: string, detail?: string) => void;
}): Promise<DeliveryResult> {
  const { task, workspace, baseBranch, onLog } = options;
  const cwd = workspace.dir;

  await runShell('git add -A', { cwd, timeoutMs: 60_000 });
  const staged = await runShell('git diff --cached --name-only', { cwd, timeoutMs: 60_000 });
  if (!staged.stdout.trim()) {
    return { committed: false, pushed: false, note: 'The agent produced no file changes.' };
  }

  const message = commitMessage(task);
  const commit = await runShell(
    `git commit -m ${JSON.stringify(message)}`,
    { cwd, timeoutMs: 60_000 },
  );
  if (commit.code !== 0) {
    return {
      committed: false,
      pushed: false,
      note: `git commit failed: ${(commit.stderr || commit.stdout).slice(-800)}`,
    };
  }
  onLog(`Committed on ${workspace.branch}`);

  if (!workspace.remoteUrl) {
    return {
      committed: true,
      pushed: false,
      note: 'No remote configured for this project, so the commit stayed in the local workspace.',
    };
  }

  const push = await runShell(
    `git push -u origin ${JSON.stringify(workspace.branch)}`,
    { cwd, timeoutMs: 180_000 },
  );
  if (push.code !== 0) {
    return {
      committed: true,
      pushed: false,
      note: `git push failed: ${(push.stderr || push.stdout).slice(-800)}`,
    };
  }
  onLog(`Pushed ${workspace.branch}`);

  const pr = await runShell(
    [
      'gh pr create',
      `--base ${JSON.stringify(baseBranch)}`,
      `--head ${JSON.stringify(workspace.branch)}`,
      `--title ${JSON.stringify(commitMessage(task))}`,
      `--body ${JSON.stringify(pullRequestBody(task))}`,
    ].join(' '),
    { cwd, timeoutMs: 120_000 },
  );

  if (pr.code !== 0) {
    return {
      committed: true,
      pushed: true,
      note: `Branch pushed, but gh pr create failed: ${(pr.stderr || pr.stdout).slice(-800)}`,
    };
  }

  const prUrl = pr.stdout.trim().split('\n').filter((line) => line.startsWith('http')).pop();
  onLog(`Opened pull request ${prUrl ?? ''}`);
  return { committed: true, pushed: true, prUrl };
}
