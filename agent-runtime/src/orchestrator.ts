import { runAgentLoop } from './agent/loop.ts';
import { planPrompt, repairPrompt, systemPrompt, taskPrompt } from './agent/prompts.ts';
import type { ToolContext } from './agent/tools.ts';
import { getProvider } from './providers/index.ts';
import type { ChatMessage } from './providers/types.ts';
import { collectChanges, prepareWorkspace } from './pipeline/workspace.ts';
import type { Workspace } from './pipeline/workspace.ts';
import { verifyProject } from './pipeline/verify.ts';
import { deliverTask } from './pipeline/deliver.ts';
import { commentOnIssue, linearConfigured, moveIssueToState } from './integrations/linear.ts';
import { appendStep, getTask, listTasks, updateTask } from './store.ts';
import type { AgentProfile, ProjectConfig, RuntimeConfig, Task, TaskStage } from './types.ts';
import { ACTIVE_STAGES } from './types.ts';

const MAX_REPAIR_ATTEMPTS = 2;

const queue: string[] = [];
const running = new Map<string, AbortController>();
const workspaces = new Map<string, Workspace>();

let config: RuntimeConfig;

export function initOrchestrator(runtimeConfig: RuntimeConfig): void {
  config = runtimeConfig;
}

export function activeCount(): number {
  return running.size;
}

function log(taskId: string, stage: TaskStage, title: string, detail?: string, kind: 'log' | 'tool' | 'model' | 'error' | 'stage' = 'log'): void {
  appendStep(taskId, { stage, kind, title, detail });
}

function setStage(taskId: string, stage: TaskStage, title: string): Task | undefined {
  const task = updateTask(taskId, { stage });
  appendStep(taskId, { stage, kind: 'stage', title });
  return task;
}

function findAgent(id: string): AgentProfile {
  const agent = config.agents.find((entry) => entry.id === id);
  if (!agent) throw new Error(`No agent profile for "${id}" in super-agent.config.json`);
  return agent;
}

function findProject(id: string): ProjectConfig {
  const project = config.projects.find((entry) => entry.id === id);
  if (!project) throw new Error(`No project "${id}" in super-agent.config.json`);
  return project;
}

export function enqueue(taskId: string): void {
  if (queue.includes(taskId) || running.has(taskId)) return;
  queue.push(taskId);
  pump();
}

export function cancel(taskId: string): boolean {
  const index = queue.indexOf(taskId);
  if (index !== -1) {
    queue.splice(index, 1);
    setStage(taskId, 'cancelled', 'Cancelled before starting');
    return true;
  }
  const controller = running.get(taskId);
  if (!controller) return false;
  controller.abort();
  return true;
}

function pump(): void {
  while (running.size < config.maxConcurrentTasks && queue.length) {
    const taskId = queue.shift();
    if (!taskId) break;
    const task = getTask(taskId);
    if (!task || task.stage === 'cancelled') continue;

    const controller = new AbortController();
    running.set(taskId, controller);

    void runPipeline(taskId, controller.signal)
      .catch((error) => {
        const message = (error as Error).message;
        if (message === 'cancelled') {
          setStage(taskId, 'cancelled', 'Cancelled');
        } else {
          updateTask(taskId, { stage: 'failed', error: message });
          appendStep(taskId, { stage: 'failed', kind: 'error', title: 'Task failed', detail: message });
        }
      })
      .finally(() => {
        running.delete(taskId);
        pump();
      });
  }
}

async function notifyLinear(task: Task, body: string, stateName?: string): Promise<void> {
  if (task.source.kind !== 'linear' || !task.source.id || !linearConfigured()) return;
  try {
    await commentOnIssue(task.source.id, body);
    if (stateName) {
      const teamKey = task.source.ref?.split('-')[0] ?? config.linear?.teamKey ?? '';
      if (teamKey) await moveIssueToState(task.source.id, teamKey, stateName);
    }
  } catch (error) {
    log(task.id, task.stage, 'Linear update failed', (error as Error).message, 'error');
  }
}

async function runPipeline(taskId: string, signal: AbortSignal): Promise<void> {
  const initial = getTask(taskId);
  if (!initial) return;

  const agent = findAgent(initial.agentId);
  const project = findProject(initial.projectId);
  const provider = getProvider(initial.provider);
  const model = initial.model || agent.model || provider.defaultModel;

  // 1. Workspace
  setStage(taskId, 'preparing', `Preparing a clean checkout of ${project.name}`);
  const workspace = await prepareWorkspace({
    task: initial,
    project,
    config,
    onLog: (message) => log(taskId, 'preparing', message),
  });
  workspaces.set(taskId, workspace);
  updateTask(taskId, { branch: workspace.branch, model });
  log(taskId, 'preparing', `Working on branch ${workspace.branch}`);

  await notifyLinear(
    getTask(taskId) as Task,
    `🤖 **${agent.id}** (${provider.label}) picked this up and is working on \`${workspace.branch}\`.`,
    'In Progress',
  );

  const toolContext: ToolContext = {
    cwd: workspace.dir,
    allowedCommands: config.allowedCommands,
    deniedPatterns: config.deniedPatterns,
    timeoutMs: config.commandTimeoutMs,
  };

  const system = systemPrompt({ agent, project, allowedCommands: config.allowedCommands });

  // 2. Plan
  if (signal.aborted) throw new Error('cancelled');
  setStage(taskId, 'planning', `${agent.id} is drafting a plan`);
  const planned = await provider.chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: planPrompt(getTask(taskId) as Task) },
    ],
    { model, temperature: 0.2, signal },
  );
  updateTask(taskId, { plan: planned.text });
  log(taskId, 'planning', 'Plan ready', planned.text, 'model');

  // 3. Implement
  setStage(taskId, 'implementing', `${agent.id} is writing code`);
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: taskPrompt(getTask(taskId) as Task) },
    { role: 'assistant', content: `My plan:\n${planned.text}` },
    { role: 'user', content: 'Good. Now implement it.' },
  ];

  const loop = await runAgentLoop({
    provider,
    model,
    messages,
    toolContext,
    maxIterations: agent.maxIterations,
    signal,
    onEvent: (event) => log(taskId, 'implementing', event.title, event.detail, event.kind),
  });

  const current = getTask(taskId) as Task;
  updateTask(taskId, {
    summary: loop.summary,
    usage: {
      calls: current.usage.calls + loop.usage.calls + 1,
      inputTokens: current.usage.inputTokens + loop.usage.inputTokens + planned.usage.inputTokens,
      outputTokens: current.usage.outputTokens + loop.usage.outputTokens + planned.usage.outputTokens,
    },
  });

  const changes = await collectChanges(workspace.dir);
  updateTask(taskId, { diffStat: changes.diffStat, filesChanged: changes.files });

  if (!changes.files.length) {
    updateTask(taskId, {
      stage: 'failed',
      error: loop.summary || 'The agent finished without changing any files.',
    });
    appendStep(taskId, {
      stage: 'failed',
      kind: 'error',
      title: 'No changes produced',
      detail: loop.summary,
    });
    await notifyLinear(getTask(taskId) as Task, `⚠️ **${agent.id}** finished without producing any changes.\n\n${loop.summary}`);
    return;
  }

  log(taskId, 'implementing', `${changes.files.length} file(s) changed`, changes.diffStat);

  // 4. Verify, with a bounded repair loop
  let verifyResult = await runVerify(taskId, workspace.dir, project);
  let attempt = 0;

  while (!verifyResult.passed && attempt < MAX_REPAIR_ATTEMPTS) {
    attempt += 1;
    if (signal.aborted) throw new Error('cancelled');
    setStage(taskId, 'repairing', `Verification failed — repair attempt ${attempt}/${MAX_REPAIR_ATTEMPTS}`);

    const repair = await runAgentLoop({
      provider,
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: taskPrompt(getTask(taskId) as Task) },
        { role: 'assistant', content: loop.summary || 'Implementation attempted.' },
        { role: 'user', content: repairPrompt(verifyResult.command ?? 'verify', verifyResult.output ?? '') },
      ],
      toolContext,
      maxIterations: Math.max(6, Math.round(agent.maxIterations / 2)),
      signal,
      onEvent: (event) => log(taskId, 'repairing', event.title, event.detail, event.kind),
    });

    const afterRepair = getTask(taskId) as Task;
    updateTask(taskId, {
      summary: repair.summary || afterRepair.summary,
      usage: {
        calls: afterRepair.usage.calls + repair.usage.calls,
        inputTokens: afterRepair.usage.inputTokens + repair.usage.inputTokens,
        outputTokens: afterRepair.usage.outputTokens + repair.usage.outputTokens,
      },
    });

    verifyResult = await runVerify(taskId, workspace.dir, project);
  }

  const finalChanges = await collectChanges(workspace.dir);
  updateTask(taskId, {
    diffStat: finalChanges.diffStat,
    filesChanged: finalChanges.files,
    verifyPassed: verifyResult.passed,
  });

  if (!verifyResult.passed) {
    updateTask(taskId, {
      stage: 'failed',
      error: `Verification still failing after ${MAX_REPAIR_ATTEMPTS} repair attempts: ${verifyResult.command}`,
    });
    appendStep(taskId, {
      stage: 'failed',
      kind: 'error',
      title: 'Verification failed',
      detail: verifyResult.output,
    });
    await notifyLinear(
      getTask(taskId) as Task,
      `❌ **${agent.id}** could not get \`${verifyResult.command}\` to pass. The branch \`${workspace.branch}\` was left in the local workspace for review.`,
    );
    return;
  }

  // 5. Deliver
  const readyTask = getTask(taskId) as Task;
  if (!readyTask.autoDeliver) {
    setStage(taskId, 'awaiting-approval', 'Verified — waiting for your approval to open a pull request');
    return;
  }

  await deliver(taskId);
}

async function runVerify(taskId: string, dir: string, project: ProjectConfig) {
  setStage(taskId, 'verifying', 'Running project checks');
  return verifyProject({
    dir,
    project,
    timeoutMs: config.commandTimeoutMs,
    onLog: (message, detail) => log(taskId, 'verifying', message, detail),
  });
}

/** Commits, pushes and opens the pull request. Also used by the approve endpoint. */
export async function deliver(taskId: string): Promise<Task | undefined> {
  const task = getTask(taskId);
  const workspace = workspaces.get(taskId);
  if (!task) return undefined;
  if (!workspace) {
    updateTask(taskId, {
      stage: 'failed',
      error: 'The workspace for this task is gone — the runtime restarted. Re-run the task.',
    });
    return getTask(taskId);
  }

  const project = findProject(task.projectId);
  setStage(taskId, 'delivering', 'Committing and opening a pull request');

  const result = await deliverTask({
    task,
    workspace,
    baseBranch: project.baseBranch,
    onLog: (message, detail) => log(taskId, 'delivering', message, detail),
  });

  if (!result.committed) {
    updateTask(taskId, { stage: 'failed', error: result.note });
    appendStep(taskId, { stage: 'failed', kind: 'error', title: 'Delivery failed', detail: result.note });
    return getTask(taskId);
  }

  updateTask(taskId, { stage: 'done', prUrl: result.prUrl, error: result.note });
  appendStep(taskId, {
    stage: 'done',
    kind: 'stage',
    title: result.prUrl ? `Pull request opened: ${result.prUrl}` : (result.note ?? 'Committed'),
  });

  const done = getTask(taskId) as Task;
  await notifyLinear(
    done,
    [
      `✅ **${done.agentId}** finished this task.`,
      '',
      done.summary ?? '',
      '',
      result.prUrl ? `Pull request: ${result.prUrl}` : `Branch: \`${workspace.branch}\` (${result.note ?? 'not pushed'})`,
    ].join('\n'),
    result.prUrl ? (config.linear?.doneStateName ?? 'In Review') : undefined,
  );

  return done;
}

export function agentWorkload(): Record<string, { stage: TaskStage; taskId: string; title: string } | null> {
  const map: Record<string, { stage: TaskStage; taskId: string; title: string } | null> = {};
  for (const agent of config.agents) map[agent.id] = null;
  for (const task of listTasks()) {
    if (ACTIVE_STAGES.includes(task.stage) && map[task.agentId] === null) {
      map[task.agentId] = { stage: task.stage, taskId: task.id, title: task.title };
    }
  }
  return map;
}
