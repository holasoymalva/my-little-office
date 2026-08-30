import { PROVIDER_KEYS, PROVIDER_LABELS, providerConfigured } from './config.ts';
import { env } from './env.ts';
import { agentWorkload, cancel } from './orchestrator.ts';
import { getProvider } from './providers/index.ts';
import type { ChatMessage as ProviderMessage, ToolSchema } from './providers/types.ts';
import { inspectPath, inspectRepo, saveProject } from './projects.ts';
import { appendChat, listChat, listTasks } from './store.ts';
import { createAndStartTask } from './tasks.ts';
import type { ChatTurn, ProviderId, RuntimeConfig, Task } from './types.ts';
import { ACTIVE_STAGES } from './types.ts';
import { createLinearIssue, fetchOpenIssues, linearConfigured } from './integrations/linear.ts';
import { syncLinearIssues } from './linear-automation.ts';

const MAX_TOOL_ROUNDS = 8;
const HISTORY_TURNS = 16;

let config: RuntimeConfig;

export function initChat(runtimeConfig: RuntimeConfig): void {
  config = runtimeConfig;
}

/** The chat runs on whichever provider you point it at, defaulting to the first one with a key. */
export function chatProvider(): { id: ProviderId; model: string } | undefined {
  const preferred = env('CHAT_PROVIDER') as ProviderId | '';
  const order: ProviderId[] = preferred ? [preferred] : ['openai', 'xai', 'gemini'];
  const id = order.find((entry) => providerConfigured(entry));
  if (!id) return undefined;
  return { id, model: env('CHAT_MODEL') || getProvider(id).defaultModel };
}

export function chatStatus() {
  const selected = chatProvider();
  return {
    ready: Boolean(selected),
    provider: selected?.id,
    model: selected?.model,
    hint: selected
      ? undefined
      : `Set one of ${Object.values(PROVIDER_KEYS).join(', ')} in .env to talk to the office.`,
  };
}

const TOOLS: ToolSchema[] = [
  {
    name: 'create_task',
    description:
      'Assign a task to an agent. Use one call per unit of work. The brief is what the coding agent will read, so it must stand on its own.',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Id of the agent who should do the work, e.g. DEV.' },
        projectId: { type: 'string', description: 'Id of the project the work happens in.' },
        title: { type: 'string', description: 'Short imperative title, under 70 characters.' },
        brief: {
          type: 'string',
          description:
            'The full brief: what to change, where, how to reproduce a bug, and what "done" looks like. Written for someone who has not read this conversation.',
        },
        autoDeliver: {
          type: 'boolean',
          description: 'True (default) opens a pull request once the checks pass. False parks the task for human approval.',
        },
      },
      required: ['agentId', 'projectId', 'title', 'brief'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List the tasks the office is currently working on and the ones it recently finished.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'create_linear_issue',
    description:
      'Create a real issue in Linear. Use PRIYA for product value, features and improvements; use TESS for bugs found by QA. The description must include acceptance criteria for product work or reproduction steps and expected behavior for bugs.',
    parameters: {
      type: 'object',
      properties: {
        createdByAgent: { type: 'string', description: 'PRIYA for Product Owner work or TESS for QA bug reports.' },
        kind: { type: 'string', description: 'feature, improvement, or bug.' },
        title: { type: 'string', description: 'Specific issue title.' },
        description: { type: 'string', description: 'Complete Markdown issue body with context and acceptance criteria or reproduction steps.' },
        priority: { type: 'number', description: 'Linear priority: 1 urgent, 2 high, 3 normal, 4 low.' },
      },
      required: ['createdByAgent', 'kind', 'title', 'description'],
    },
  },
  {
    name: 'list_linear_issues',
    description: 'List open Linear issues visible to the configured team.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'sync_linear',
    description: 'Ask MGR, the Tech Manager, to sync Linear now and automatically assign eligible issues to idle developer agents.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'cancel_task',
    description: 'Stop a queued or running task by its id.',
    parameters: {
      type: 'object',
      properties: { taskId: { type: 'string', description: 'The task id to cancel.' } },
      required: ['taskId'],
    },
  },
  {
    name: 'inspect_project',
    description:
      'Look at a project before registering it: a directory on this machine (path), or a repository that is not here yet (repo clone URL, cloned to a throwaway copy). Reports the git remote, the default branch and the install and check commands it appears to use.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path, or ~/ relative to the home directory.' },
        repo: { type: 'string', description: 'Clone URL, e.g. https://github.com/owner/repo.git' },
      },
      required: [],
    },
  },
  {
    name: 'add_project',
    description:
      'Register a project agents may work on, from a path on this machine or from a clone URL. Confirm the verify commands with the user before calling this, because a task never ships unless they pass.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to a git checkout on this machine.' },
        repo: { type: 'string', description: 'Clone URL, used instead of a path when the project is not on this machine.' },
        name: { type: 'string', description: 'Display name. Defaults to the folder or repository name.' },
        baseBranch: { type: 'string', description: 'Branch new work starts from.' },
        source: {
          type: 'string',
          description: '"local" clones your checkout, including unpushed commits. "remote" clones origin.',
        },
        setup: { type: 'array', description: 'Commands run once per workspace, e.g. ["npm install"].' },
        verify: { type: 'array', description: 'Commands that must pass before work ships, e.g. ["npm test"].' },
        conventions: { type: 'string', description: 'Guidance handed to every agent working on this codebase.' },
      },
      required: [],
    },
  },
];

function rosterPrompt(): string {
  const workload = agentWorkload();
  const agents = config.agents.map((agent) => {
    const busy = workload[agent.id];
    return [
      `- ${agent.id} — ${agent.role} (${PROVIDER_LABELS[agent.provider]}${providerConfigured(agent.provider) ? '' : ', NO API KEY, cannot take work'})`,
      `  good at: ${agent.skills.join(', ') || 'anything'}`,
      busy ? `  currently: ${busy.stage} — ${busy.title}` : '  currently: idle',
    ].join('\n');
  });

  const projects = config.projects.length
    ? config.projects.map((project) =>
        `- ${project.id} — ${project.name} (${project.path ?? project.repo ?? 'no source'}, base ${project.baseBranch}, checks: ${project.verify.join(' && ') || 'none'})`,
      )
    : ['(none registered yet — use inspect_project and add_project to point the office at a directory or a clone URL)'];

  return [`Agents:`, ...agents, '', 'Projects:', ...projects].join('\n');
}

function systemPrompt(): string {
  return [
    'You are the office manager of a small team of autonomous coding agents. The user talks to you in chat',
    'to get work done: you decide which teammate takes what, and you dispatch the task.',
    '',
    rosterPrompt(),
    '',
    'How you behave:',
    '- Reply in the language the user writes in, and keep it short — a few sentences at most.',
    '- When the user describes work, pick the agent whose skills fit best and call create_task. Do not ask which',
    '  agent should do it unless the user clearly wants to choose.',
    '- Split a request that contains several independent pieces of work into several tasks.',
    '- If a request is too vague to implement (you could not tell whether the result is right), ask one focused',
    '  question instead of guessing. If it is merely underspecified, pick the conventional reading, dispatch it,',
    '  and say which assumption you made.',
    '- The brief you write is the entire context the coding agent gets. Restate the problem, name files or areas',
    '  when the user mentioned them, and say what "done" looks like.',
    '- Only one project is registered? Use it without asking. Several? Use the one the user names, or ask.',
    '- Answer questions about the board with list_tasks rather than from memory.',
    '- When the user gives a concrete product idea and asks the Product Owner to record it, call create_linear_issue',
    '  with createdByAgent PRIYA and kind feature or improvement.',
    '- When the user asks PRIYA to inspect a project and discover opportunities, create a task for PRIYA instead;',
    '  her project agent can inspect the repository and create grounded Linear issues with its dedicated tool.',
    '- When the user gives a concrete defect and asks QA to report it, call create_linear_issue with createdByAgent',
    '  TESS and kind bug. When asked to audit a project for unknown bugs, create a task for TESS so she can inspect',
    '  and reproduce issues before filing them.',
    '- When the user asks the Tech Manager to process or distribute Linear work, call sync_linear. MGR owns routing;',
    '  do not manually create duplicate office tasks for those Linear issues.',
    '- Never claim you created a task unless the tool call succeeded.',
    '- Never claim you created a Linear issue unless create_linear_issue returned created or already existed.',
  ].join('\n');
}

function describeTask(task: Task): string {
  return `${task.id} · ${task.title} · agent ${task.agentId} · project ${task.projectId} · ${task.stage}${task.prUrl ? ` · ${task.prUrl}` : ''}`;
}

async function runChatTool(
  name: string,
  args: Record<string, unknown>,
  created: string[],
): Promise<string> {
  switch (name) {
    case 'create_task': {
      const task = createAndStartTask({
        agentId: args.agentId,
        projectId: args.projectId,
        title: args.title,
        brief: args.brief,
        autoDeliver: args.autoDeliver !== false,
        source: { kind: 'manual' },
      });
      created.push(task.id);
      return `Task created and queued: ${describeTask(task)}`;
    }

    case 'list_tasks': {
      const tasks = listTasks().slice(0, 20);
      if (!tasks.length) return 'The board is empty.';
      const active = tasks.filter((task) => ACTIVE_STAGES.includes(task.stage) || task.stage === 'queued');
      return [
        `Active (${active.length}):`,
        ...active.map((task) => `  ${describeTask(task)}`),
        'Recent:',
        ...tasks.filter((task) => !active.includes(task)).slice(0, 10).map((task) => `  ${describeTask(task)}`),
      ].join('\n');
    }

    case 'create_linear_issue': {
      if (!linearConfigured()) return 'Failed: LINEAR_API_KEY is not set.';
      const createdByAgent = String(args.createdByAgent ?? '').toUpperCase();
      if (createdByAgent !== 'PRIYA' && createdByAgent !== 'TESS') {
        return 'Failed: createdByAgent must be PRIYA or TESS.';
      }
      const kind = String(args.kind ?? '').toLowerCase();
      if (kind !== 'feature' && kind !== 'improvement' && kind !== 'bug') {
        return 'Failed: kind must be feature, improvement, or bug.';
      }
      const result = await createLinearIssue({
        createdByAgent,
        kind,
        title: String(args.title ?? ''),
        description: String(args.description ?? ''),
        priority: args.priority === undefined ? undefined : Number(args.priority),
        teamKey: config.linear?.teamKey,
      });
      return `${result.created ? 'Created' : 'Already exists'}: ${result.issue.identifier} · ${result.issue.title} · ${result.issue.url}`;
    }

    case 'list_linear_issues': {
      if (!linearConfigured()) return 'Linear is not configured.';
      const issues = await fetchOpenIssues(config.linear?.teamKey, 20);
      return issues.length
        ? issues.map((issue) => `${issue.identifier} · ${issue.title} · ${issue.stateName}${issue.assigneeName ? ` · ${issue.assigneeName}` : ''}`).join('\n')
        : 'No open Linear issues.';
    }

    case 'sync_linear': {
      const result = await syncLinearIssues();
      if (result.lastError) return `Linear sync failed: ${result.lastError}`;
      return result.lastAssigned.length
        ? `MGR assigned ${result.lastAssigned.join(', ')} to available developer agents.`
        : 'Linear is synced. No eligible unassigned issue had an idle developer available.';
    }

    case 'cancel_task':
      return cancel(String(args.taskId ?? ''))
        ? 'Cancelled.'
        : 'That task is not queued or running, so there was nothing to cancel.';

    case 'inspect_project': {
      const repo = String(args.repo ?? '').trim();
      const inspection = repo ? await inspectRepo(repo) : await inspectPath(String(args.path ?? ''));
      if (inspection.problem) return `Cannot use this project: ${inspection.problem}`;
      return [
        `path: ${inspection.path || '(not on this machine — will be cloned)'}`,
        `remote: ${inspection.remoteUrl ?? 'none'}`,
        `default branch: ${inspection.baseBranch}`,
        `stack: ${inspection.stack ?? 'unknown'}`,
        `suggested setup: ${inspection.suggestedSetup.join(' && ') || 'none'}`,
        `suggested verify: ${inspection.suggestedVerify.join(' && ') || 'none found — ask the user which command proves the project works'}`,
      ].join('\n');
    }

    case 'add_project': {
      const project = await saveProject({
        path: args.path === undefined ? undefined : String(args.path),
        repo: args.repo === undefined ? undefined : String(args.repo),
        name: args.name === undefined ? undefined : String(args.name),
        baseBranch: args.baseBranch === undefined ? undefined : String(args.baseBranch),
        source: args.source === 'local' ? 'local' : args.source === 'remote' ? 'remote' : undefined,
        setup: args.setup as string[] | undefined,
        verify: args.verify as string[] | undefined,
        conventions: args.conventions === undefined ? undefined : String(args.conventions),
      });
      return `Project registered: ${project.id} (${project.path ?? project.repo}), base ${project.baseBranch}, checks: ${project.verify.join(' && ')}`;
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

function historyMessages(): ProviderMessage[] {
  return listChat()
    .filter((turn) => !turn.error)
    .slice(-HISTORY_TURNS)
    .map((turn) => ({ role: turn.role, content: turn.content }) as ProviderMessage);
}

/**
 * One turn of the office chat: the user's message goes in, the manager answers
 * and may dispatch work along the way. Both sides are appended to the shared
 * chat log, so every open dashboard sees the same conversation.
 */
export async function sendChatMessage(text: string): Promise<ChatTurn> {
  const content = text.trim();
  if (!content) throw new Error('Say something first');

  const selected = chatProvider();
  if (!selected) throw new Error(chatStatus().hint);

  const history = historyMessages();
  appendChat({ role: 'user', content });

  const provider = getProvider(selected.id);
  const messages: ProviderMessage[] = [
    { role: 'system', content: systemPrompt() },
    ...history,
    { role: 'user', content },
  ];

  const created: string[] = [];

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const result = await provider.chat(messages, {
        model: selected.model,
        tools: TOOLS,
        temperature: 0.3,
      });

      messages.push({
        role: 'assistant',
        content: result.text,
        toolCalls: result.toolCalls.length ? result.toolCalls : undefined,
      });

      if (!result.toolCalls.length) {
        return appendChat({
          role: 'assistant',
          content: result.text.trim() || 'Done.',
          taskIds: created.length ? created : undefined,
        });
      }

      for (const call of result.toolCalls) {
        let output: string;
        try {
          output = await runChatTool(call.name, call.args, created);
        } catch (error) {
          output = `Failed: ${(error as Error).message}`;
        }
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: output });
      }
    }

    return appendChat({
      role: 'assistant',
      content: created.length
        ? 'I dispatched the work above, but ran out of turns before wrapping up.'
        : 'I could not settle this in one go — try asking for one thing at a time.',
      taskIds: created.length ? created : undefined,
    });
  } catch (error) {
    return appendChat({
      role: 'assistant',
      content: (error as Error).message,
      taskIds: created.length ? created : undefined,
      error: true,
    });
  }
}
