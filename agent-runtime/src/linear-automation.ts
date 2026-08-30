import { providerConfigured } from './config.ts';
import { commentOnIssue, fetchOpenIssues, linearConfigured } from './integrations/linear.ts';
import type { LinearIssue } from './integrations/linear.ts';
import { enqueue } from './orchestrator.ts';
import { listTasks } from './store.ts';
import { createTaskFromRequest } from './tasks.ts';
import { ACTIVE_STAGES } from './types.ts';
import type { AgentProfile, ProjectConfig, RuntimeConfig, Task } from './types.ts';

export type LinearAutomationStatus = {
  enabled: boolean;
  running: boolean;
  pollIntervalMs: number;
  lastSyncAt?: string;
  lastError?: string;
  assignedTotal: number;
  lastAssigned: string[];
};

let config: RuntimeConfig;
let timer: ReturnType<typeof setInterval> | undefined;
let syncPromise: Promise<LinearAutomationStatus> | undefined;
let status: LinearAutomationStatus = {
  enabled: false,
  running: false,
  pollIntervalMs: 60_000,
  assignedTotal: 0,
  lastAssigned: [],
};

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');

function availableDevelopers(tasks: Task[]): AgentProfile[] {
  const configuredIds = config.linear?.developerAgentIds;
  const candidates = config.agents.filter((agent) => configuredIds?.length
    ? configuredIds.includes(agent.id)
    : /software engineer|tech lead/i.test(agent.role));
  return candidates.filter((agent) =>
    providerConfigured(agent.provider) && !tasks.some((task) =>
      task.agentId === agent.id && (ACTIVE_STAGES.includes(task.stage) || task.stage === 'queued'),
    ),
  );
}

function pickDeveloper(issue: LinearIssue, candidates: AgentProfile[]): AgentProfile | undefined {
  const haystack = `${issue.title} ${issue.description} ${issue.labels.join(' ')}`.toLowerCase();
  return [...candidates].sort((left, right) => {
    const score = (agent: AgentProfile) => agent.skills.reduce(
      (total, skill) => total + (haystack.includes(skill.toLowerCase()) ? 3 : 0),
      /tech lead/i.test(agent.role) && /architecture|migration|platform|refactor/.test(haystack) ? 5 : 0,
    );
    return score(right) - score(left) || left.id.localeCompare(right.id);
  })[0];
}

function projectForIssue(issue: LinearIssue): ProjectConfig | undefined {
  const mapped = config.linear?.projectByTeam?.[issue.teamKey];
  const requested = mapped ?? config.linear?.defaultProjectId;
  if (requested) return config.projects.find((project) => project.id === requested);

  const team = normalize(issue.teamName || issue.teamKey);
  const matched = config.projects.find((project) =>
    normalize(project.name).includes(team) || normalize(project.id).includes(team),
  );
  return matched ?? (config.projects.length === 1 ? config.projects[0] : undefined);
}

export function linearAutomationStatus(): LinearAutomationStatus {
  return { ...status, lastAssigned: [...status.lastAssigned] };
}

export function initLinearAutomation(runtimeConfig: RuntimeConfig): void {
  config = runtimeConfig;
  const pollIntervalMs = Math.max(15_000, runtimeConfig.linear?.pollIntervalMs ?? 60_000);
  status = {
    enabled: Boolean(linearConfigured() && runtimeConfig.linear?.autoImport),
    running: false,
    pollIntervalMs,
    assignedTotal: 0,
    lastAssigned: [],
  };
  if (!status.enabled) return;
  void syncLinearIssues();
  timer = setInterval(() => void syncLinearIssues(), pollIntervalMs);
  timer.unref();
}

export async function syncLinearIssues(): Promise<LinearAutomationStatus> {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    status = { ...status, running: true, lastError: undefined, lastAssigned: [] };
    try {
      if (!linearConfigured()) throw new Error('LINEAR_API_KEY is not set');
      const teamKey = config.linear?.teamKey;
      const issues = await fetchOpenIssues(teamKey, 50, false);
      const tasks = listTasks();
      const seen = new Set(tasks.filter((task) => task.source.id).map((task) => task.source.id as string));
      const candidates = availableDevelopers(tasks);
      const assigned: string[] = [];

      const ordered = [...issues].sort((left, right) => {
        const leftPriority = left.priority || 99;
        const rightPriority = right.priority || 99;
        return leftPriority - rightPriority || left.identifier.localeCompare(right.identifier);
      });

      for (const issue of ordered) {
        if (!candidates.length) break;
        if (seen.has(issue.id) || issue.assigneeId) continue;
        const project = projectForIssue(issue);
        if (!project) continue;
        const agent = pickDeveloper(issue, candidates);
        if (!agent) break;

        const task = createTaskFromRequest({
          agentId: agent.id,
          projectId: project.id,
          title: `${issue.identifier} ${issue.title}`,
          brief: [issue.title, '', issue.description].join('\n').trim(),
          autoDeliver: config.linear?.autoDeliver !== false,
          source: { kind: 'linear', ref: issue.identifier, url: issue.url, id: issue.id },
        });
        enqueue(task.id);
        assigned.push(issue.identifier);
        seen.add(issue.id);
        candidates.splice(candidates.indexOf(agent), 1);
        await commentOnIssue(
          issue.id,
          `🧭 **MGR · Tech Manager** assigned this issue to **${agent.id} · ${agent.role}** in My Little Office.`,
        );
      }

      status = {
        ...status,
        running: false,
        lastSyncAt: new Date().toISOString(),
        assignedTotal: status.assignedTotal + assigned.length,
        lastAssigned: assigned,
      };
      return linearAutomationStatus();
    } catch (error) {
      status = {
        ...status,
        running: false,
        lastSyncAt: new Date().toISOString(),
        lastError: (error as Error).message,
      };
      return linearAutomationStatus();
    } finally {
      syncPromise = undefined;
    }
  })();
  return syncPromise;
}
