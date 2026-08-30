import { PROVIDER_KEYS, PROVIDER_LABELS, providerConfigured } from './config.ts';
import { enqueue } from './orchestrator.ts';
import { getProvider } from './providers/index.ts';
import { createTask } from './store.ts';
import type { ProviderId, RuntimeConfig, Task } from './types.ts';

let config: RuntimeConfig;

export function initTasks(runtimeConfig: RuntimeConfig): void {
  config = runtimeConfig;
}

/**
 * Turns a request body — from the composer, from Linear, or from the office
 * chat — into a queued task. Everything is validated here so a bad agent id or
 * a missing API key is reported the same way whichever door it came through.
 */
export function createTaskFromRequest(body: Record<string, unknown>): Task {
  const agentId = String(body.agentId ?? '');
  const agent = config.agents.find((entry) => entry.id === agentId);
  if (!agent) {
    throw new Error(
      `Unknown agent "${agentId}". Available: ${config.agents.map((entry) => entry.id).join(', ')}`,
    );
  }

  const projectId = String(body.projectId ?? '');
  const project = config.projects.find((entry) => entry.id === projectId);
  if (!project) {
    throw new Error(
      `Unknown project "${projectId}". Available: ${config.projects.map((entry) => entry.id).join(', ') || 'none yet'}`,
    );
  }

  const provider = (body.provider as ProviderId | undefined) ?? agent.provider;
  if (!providerConfigured(provider)) {
    throw new Error(`${PROVIDER_LABELS[provider]} is not configured. Set ${PROVIDER_KEYS[provider]} in .env`);
  }

  const brief = String(body.brief ?? '').trim();
  if (!brief) throw new Error('A task needs a brief describing the work');

  return createTask({
    title: String(body.title ?? brief.slice(0, 70)),
    brief,
    projectId,
    agentId,
    provider,
    model: String(body.model ?? agent.model ?? getProvider(provider).defaultModel),
    stage: 'queued',
    source: (body.source as Task['source'] | undefined) ?? { kind: 'manual' },
    autoDeliver: body.autoDeliver !== false,
  });
}

export function createAndStartTask(body: Record<string, unknown>): Task {
  const task = createTaskFromRequest(body);
  enqueue(task.id);
  return task;
}
