export type ProviderId = 'openai' | 'gemini' | 'xai';

export type TaskStage =
  | 'queued'
  | 'preparing'
  | 'planning'
  | 'implementing'
  | 'verifying'
  | 'repairing'
  | 'awaiting-approval'
  | 'delivering'
  | 'done'
  | 'failed'
  | 'cancelled';

export const ACTIVE_STAGES: readonly TaskStage[] = [
  'preparing',
  'planning',
  'implementing',
  'verifying',
  'repairing',
  'delivering',
];

export type TaskSource = {
  kind: 'manual' | 'linear';
  /** Linear issue identifier such as ENG-214. */
  ref?: string;
  url?: string;
  id?: string;
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
  source: TaskSource;
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

export type ProjectConfig = {
  id: string;
  name: string;
  /** Absolute or repo-relative path to an existing checkout. */
  path?: string;
  /** Clone URL used when `path` is absent. */
  repo?: string;
  /**
   * Where the throwaway checkout comes from. `remote` clones the project's
   * origin; `local` clones the checkout at `path`, so commits you have not
   * pushed yet are part of what the agent iterates on.
   */
  source?: 'remote' | 'local';
  baseBranch: string;
  /** Commands run to prove the change works before delivery. */
  verify: string[];
  setup?: string[];
  /** Extra guidance handed to the agent for this codebase. */
  conventions?: string;
};

export type AgentProfile = {
  id: string;
  role: string;
  provider: ProviderId;
  model?: string;
  /** Appended to the system prompt so each teammate behaves differently. */
  specialty: string;
  /** Agents may only take tasks whose labels intersect this list (empty = any). */
  skills: string[];
  maxIterations: number;
};

export type ChatRole = 'user' | 'assistant';

/** One turn of the office chat, where you brief agents in plain language. */
export type ChatTurn = {
  id: string;
  at: string;
  role: ChatRole;
  content: string;
  /** Tasks the assistant created while answering this turn. */
  taskIds?: string[];
  error?: boolean;
};

export type RuntimeConfig = {
  port: number;
  workspaceRoot: string;
  agents: AgentProfile[];
  projects: ProjectConfig[];
  /** Command prefixes the agent is allowed to run inside a workspace. */
  allowedCommands: string[];
  deniedPatterns: string[];
  commandTimeoutMs: number;
  maxConcurrentTasks: number;
  linear?: {
    teamKey?: string;
    autoImport?: boolean;
    pollIntervalMs?: number;
    defaultProjectId?: string;
    projectByTeam?: Record<string, string>;
    developerAgentIds?: string[];
    autoDeliver?: boolean;
    doneStateName?: string;
  };
};
