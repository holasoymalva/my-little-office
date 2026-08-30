'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Client for the local agent runtime (`npm run agents`). The dashboard itself
 * is deployed to Cloudflare Workers, which has no filesystem or git, so all
 * real execution happens in the Node runtime this module talks to.
 */
export const RUNTIME_URL =
  process.env.NEXT_PUBLIC_AGENT_API ?? 'http://localhost:8787';

export type ProviderId = 'openai' | 'gemini' | 'xai';

export type TaskStage =
  | 'queued' | 'preparing' | 'planning' | 'implementing' | 'verifying'
  | 'repairing' | 'awaiting-approval' | 'delivering' | 'done' | 'failed' | 'cancelled';

export const ACTIVE_STAGES: TaskStage[] = [
  'preparing', 'planning', 'implementing', 'verifying', 'repairing', 'delivering',
];

export const STAGE_LABELS: Record<TaskStage, string> = {
  queued: 'Queued',
  preparing: 'Preparing workspace',
  planning: 'Planning',
  implementing: 'Writing code',
  verifying: 'Running checks',
  repairing: 'Fixing failures',
  'awaiting-approval': 'Awaiting approval',
  delivering: 'Opening pull request',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export type TaskStep = {
  id: string;
  at: string;
  stage: TaskStage;
  kind: 'log' | 'tool' | 'model' | 'error' | 'stage';
  title: string;
  detail?: string;
};

export type Task = {
  id: string;
  title: string;
  brief: string;
  projectId: string;
  agentId: string;
  provider: ProviderId;
  model: string;
  stage: TaskStage;
  source: { kind: 'manual' | 'linear'; ref?: string; url?: string; id?: string };
  createdAt: string;
  updatedAt: string;
  branch?: string;
  plan?: string;
  summary?: string;
  error?: string;
  diffStat?: string;
  filesChanged: string[];
  prUrl?: string;
  verifyPassed?: boolean;
  autoDeliver: boolean;
  steps: TaskStep[];
  usage: { calls: number; inputTokens: number; outputTokens: number };
};

export type ProjectSummary = {
  id: string;
  name: string;
  path?: string;
  repo?: string;
  source: 'remote' | 'local';
  baseBranch: string;
  setup: string[];
  verify: string[];
  conventions?: string;
};

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

export type ChatTurn = {
  id: string;
  at: string;
  role: 'user' | 'assistant';
  content: string;
  taskIds?: string[];
  error?: boolean;
};

export type RuntimeStatus = {
  ok: true;
  providers: { id: ProviderId; label: string; configured: boolean; envVar: string; defaultModel?: string }[];
  integrations: {
    linear: boolean;
    linearAutomation: {
      enabled: boolean;
      running: boolean;
      pollIntervalMs: number;
      lastSyncAt?: string;
      lastError?: string;
      assignedTotal: number;
      lastAssigned: string[];
    };
  };
  chat: { ready: boolean; provider?: ProviderId; model?: string; hint?: string };
  agents: { id: string; role: string; provider: ProviderId; model?: string; skills: string[]; ready: boolean }[];
  projects: ProjectSummary[];
  workload: Record<string, { stage: TaskStage; taskId: string; title: string } | null>;
};

export type LinearIssue = {
  id: string;
  identifier: string;
  title: string;
  description: string;
  url: string;
  stateName: string;
  priority: number;
  labels: string[];
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${RUNTIME_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
  return payload;
}

export const runtimeApi = {
  status: () => call<RuntimeStatus>('/api/status'),
  tasks: () => call<{ tasks: Task[] }>('/api/tasks'),
  createTask: (input: {
    title?: string;
    brief: string;
    agentId: string;
    projectId: string;
    provider?: ProviderId;
    model?: string;
    autoDeliver: boolean;
  }) => call<{ task: Task }>('/api/tasks', { method: 'POST', body: JSON.stringify(input) }),
  cancel: (id: string) => call<{ cancelled: boolean }>(`/api/tasks/${id}/cancel`, { method: 'POST' }),
  approve: (id: string) => call<{ task: Task }>(`/api/tasks/${id}/approve`, { method: 'POST' }),
  retry: (id: string) => call<{ task: Task }>(`/api/tasks/${id}/retry`, { method: 'POST' }),
  projects: () => call<{ projects: ProjectSummary[] }>('/api/projects'),
  inspectPath: (path: string) =>
    call<{ inspection: ProjectInspection }>('/api/projects/inspect', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  inspectRepo: (repo: string) =>
    call<{ inspection: ProjectInspection }>('/api/projects/inspect', {
      method: 'POST',
      body: JSON.stringify({ repo }),
    }),
  saveProject: (input: {
    id?: string;
    name?: string;
    path?: string;
    repo?: string;
    baseBranch?: string;
    source?: 'remote' | 'local';
    setup?: string[];
    verify?: string[];
    conventions?: string;
  }) => call<{ project: ProjectSummary }>('/api/projects', { method: 'POST', body: JSON.stringify(input) }),
  removeProject: (id: string) =>
    call<{ removed: string }>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  chat: (message: string) =>
    call<{ reply: ChatTurn }>('/api/chat', { method: 'POST', body: JSON.stringify({ message }) }),
  resetChat: () => call<{ cleared: boolean }>('/api/chat/reset', { method: 'POST' }),
  linearIssues: () => call<{ issues: LinearIssue[] }>('/api/linear/issues'),
  syncLinear: () => call<{ automation: RuntimeStatus['integrations']['linearAutomation'] }>('/api/linear/sync', { method: 'POST' }),
  assignLinear: (input: {
    identifier: string;
    agentId: string;
    projectId: string;
    provider?: ProviderId;
    autoDeliver: boolean;
  }) => call<{ task: Task }>('/api/linear/assign', { method: 'POST', body: JSON.stringify(input) }),
};

type RuntimeEvent =
  | { type: 'hello'; tasks: Task[]; chat: ChatTurn[] }
  | { type: 'chat.message'; message: ChatTurn }
  | { type: 'chat.cleared' }
  | { type: 'task.created'; task: Task }
  | { type: 'task.updated'; task: Task }
  | { type: 'task.step'; taskId: string; step: TaskStep };

export type RuntimeState = {
  connected: boolean;
  status: RuntimeStatus | null;
  tasks: Task[];
  chat: ChatTurn[];
  error: string | null;
  refresh: () => void;
};

export function useRuntime(): RuntimeState {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const statusTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    const loadStatus = () => {
      runtimeApi
        .status()
        .then((next) => {
          if (cancelled) return;
          setStatus(next);
          setError(null);
        })
        .catch((cause: Error) => {
          if (!cancelled) setError(cause.message);
        });
    };

    loadStatus();
    statusTimer.current = setInterval(loadStatus, 15_000);
    return () => {
      cancelled = true;
      clearInterval(statusTimer.current);
    };
  }, [nonce]);

  useEffect(() => {
    const source = new EventSource(`${RUNTIME_URL}/api/events`);

    source.onopen = () => {
      setConnected(true);
      setError(null);
    };

    source.onerror = () => {
      setConnected(false);
      setError(`Cannot reach the agent runtime at ${RUNTIME_URL}. Start it with "npm run agents".`);
    };

    source.onmessage = (message) => {
      const event = JSON.parse(message.data as string) as RuntimeEvent;

      if (event.type === 'hello') {
        setTasks(event.tasks);
        setChat(event.chat ?? []);
        return;
      }
      if (event.type === 'chat.message') {
        setChat((current) =>
          current.some((turn) => turn.id === event.message.id) ? current : [...current, event.message],
        );
        return;
      }
      if (event.type === 'chat.cleared') {
        setChat([]);
        return;
      }
      if (event.type === 'task.created') {
        setTasks((current) => [event.task, ...current.filter((task) => task.id !== event.task.id)]);
        return;
      }
      if (event.type === 'task.updated') {
        setTasks((current) =>
          current.map((task) =>
            // Server payloads omit nothing, but keep locally streamed steps if newer.
            task.id === event.task.id
              ? { ...event.task, steps: task.steps.length > event.task.steps.length ? task.steps : event.task.steps }
              : task,
          ),
        );
        return;
      }
      if (event.type === 'task.step') {
        setTasks((current) =>
          current.map((task) =>
            task.id === event.taskId ? { ...task, steps: [...task.steps, event.step] } : task,
          ),
        );
      }
    };

    return () => source.close();
  }, [nonce]);

  return useMemo(
    () => ({ connected, status, tasks, chat, error, refresh }),
    [connected, status, tasks, chat, error, refresh],
  );
}

export function isActive(task: Task): boolean {
  return ACTIVE_STAGES.includes(task.stage);
}

export function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86_400)}d`;
}
