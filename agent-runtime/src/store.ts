import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { REPO_ROOT } from './env.ts';
import type { ChatTurn, Task, TaskStep } from './types.ts';

const DATA_FILE = resolve(REPO_ROOT, 'agent-runtime/.data/tasks.json');
const CHAT_FILE = resolve(REPO_ROOT, 'agent-runtime/.data/chat.json');
const MAX_STEPS_PER_TASK = 400;
const MAX_CHAT_TURNS = 200;

export type RuntimeEvent =
  | { type: 'task.created'; task: Task }
  | { type: 'task.updated'; task: Task }
  | { type: 'task.step'; taskId: string; step: TaskStep }
  | { type: 'chat.message'; message: ChatTurn }
  | { type: 'chat.cleared' }
  | { type: 'hello'; tasks: Task[]; chat: ChatTurn[] };

type Listener = (event: RuntimeEvent) => void;

const tasks = new Map<string, Task>();
const chat: ChatTurn[] = [];
const listeners = new Set<Listener>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function persist(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      mkdirSync(dirname(DATA_FILE), { recursive: true });
      writeFileSync(DATA_FILE, JSON.stringify([...tasks.values()], null, 2), 'utf8');
    } catch (error) {
      console.error('[store] failed to persist tasks:', (error as Error).message);
    }
  }, 250);
}

export function loadTasks(): void {
  if (!existsSync(DATA_FILE)) return;
  try {
    const parsed = JSON.parse(readFileSync(DATA_FILE, 'utf8')) as Task[];
    for (const task of parsed) {
      // Anything mid-flight when the process died cannot be resumed.
      if (!['done', 'failed', 'cancelled', 'awaiting-approval', 'queued'].includes(task.stage)) {
        task.stage = 'failed';
        task.error = task.error ?? 'Runtime restarted while this task was running.';
      }
      tasks.set(task.id, task);
    }
  } catch (error) {
    console.error('[store] could not read saved tasks:', (error as Error).message);
  }
}

function persistChat(): void {
  try {
    mkdirSync(dirname(CHAT_FILE), { recursive: true });
    writeFileSync(CHAT_FILE, JSON.stringify(chat, null, 2), 'utf8');
  } catch (error) {
    console.error('[store] failed to persist chat:', (error as Error).message);
  }
}

export function loadChat(): void {
  if (!existsSync(CHAT_FILE)) return;
  try {
    chat.push(...(JSON.parse(readFileSync(CHAT_FILE, 'utf8')) as ChatTurn[]));
  } catch (error) {
    console.error('[store] could not read saved chat:', (error as Error).message);
  }
}

export function listChat(): ChatTurn[] {
  return chat;
}

export function appendChat(input: Omit<ChatTurn, 'id' | 'at'>): ChatTurn {
  const message: ChatTurn = { ...input, id: randomUUID(), at: new Date().toISOString() };
  chat.push(message);
  if (chat.length > MAX_CHAT_TURNS) chat.splice(0, chat.length - MAX_CHAT_TURNS);
  persistChat();
  emit({ type: 'chat.message', message });
  return message;
}

export function clearChat(): void {
  chat.length = 0;
  persistChat();
  emit({ type: 'chat.cleared' });
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: RuntimeEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A broken SSE connection must not stop the pipeline.
    }
  }
}

export function listTasks(): Task[] {
  return [...tasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getTask(id: string): Task | undefined {
  return tasks.get(id);
}

export function createTask(input: Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'steps' | 'usage' | 'filesChanged'>): Task {
  const now = new Date().toISOString();
  const task: Task = {
    ...input,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    steps: [],
    filesChanged: [],
    usage: { calls: 0, inputTokens: 0, outputTokens: 0 },
  };
  tasks.set(task.id, task);
  persist();
  emit({ type: 'task.created', task });
  return task;
}

export function updateTask(id: string, patch: Partial<Task>): Task | undefined {
  const task = tasks.get(id);
  if (!task) return undefined;
  Object.assign(task, patch, { updatedAt: new Date().toISOString() });
  persist();
  emit({ type: 'task.updated', task });
  return task;
}

export function appendStep(id: string, step: Omit<TaskStep, 'id' | 'at'>): TaskStep | undefined {
  const task = tasks.get(id);
  if (!task) return undefined;
  const full: TaskStep = { ...step, id: randomUUID(), at: new Date().toISOString() };
  task.steps.push(full);
  if (task.steps.length > MAX_STEPS_PER_TASK) {
    task.steps.splice(0, task.steps.length - MAX_STEPS_PER_TASK);
  }
  task.updatedAt = full.at;
  persist();
  emit({ type: 'task.step', taskId: id, step: full });
  return full;
}

export function replaceTask(task: Task): void {
  tasks.set(task.id, task);
  persist();
  emit({ type: 'task.updated', task });
}
