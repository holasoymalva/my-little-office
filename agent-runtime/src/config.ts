import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { env, REPO_ROOT } from './env.ts';
import type { AgentProfile, ProjectConfig, ProviderId, RuntimeConfig } from './types.ts';

const CONFIG_PATH = resolve(REPO_ROOT, 'super-agent.config.json');

const DEFAULT_ALLOWED_COMMANDS = [
  'npm', 'npx', 'pnpm', 'yarn', 'node', 'tsc', 'eslint', 'vitest', 'jest',
  'python', 'python3', 'pytest', 'pip', 'go', 'cargo', 'make',
  'git status', 'git diff', 'git log', 'git add', 'git show', 'git rev-parse',
  'ls', 'cat', 'head', 'tail', 'grep', 'rg', 'find', 'wc', 'sed', 'awk', 'echo', 'pwd',
];

const DEFAULT_DENIED = [
  'rm -rf /', 'rm -rf ~', ':(){', 'mkfs', 'shutdown', 'reboot', 'dd if=',
  'chmod 777 /', 'curl', 'wget', 'ssh', 'scp', 'sudo', 'npm publish',
  'git push', 'git reset --hard origin', 'history', 'crontab',
];

function readConfigFile(): Record<string, unknown> {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `super-agent.config.json is not valid JSON: ${(error as Error).message}`,
    );
  }
}

export function resolveProjectPath(project: ProjectConfig): string | undefined {
  if (!project.path) return undefined;
  return isAbsolute(project.path) ? project.path : resolve(REPO_ROOT, project.path);
}

export function loadConfig(): RuntimeConfig {
  const raw = readConfigFile();
  const workspaceRoot = typeof raw.workspaceRoot === 'string'
    ? raw.workspaceRoot
    : '.workspaces';

  return {
    port: Number(env('AGENT_PORT', '8787')),
    workspaceRoot: isAbsolute(workspaceRoot)
      ? workspaceRoot
      : resolve(REPO_ROOT, workspaceRoot),
    agents: (raw.agents as AgentProfile[] | undefined) ?? [],
    projects: (raw.projects as ProjectConfig[] | undefined) ?? [],
    allowedCommands: (raw.allowedCommands as string[] | undefined) ?? DEFAULT_ALLOWED_COMMANDS,
    deniedPatterns: (raw.deniedPatterns as string[] | undefined) ?? DEFAULT_DENIED,
    commandTimeoutMs: Number(raw.commandTimeoutMs ?? 240_000),
    maxConcurrentTasks: Number(raw.maxConcurrentTasks ?? 2),
    linear: raw.linear as RuntimeConfig['linear'],
  };
}

export const PROVIDER_KEYS: Record<ProviderId, string> = {
  openai: 'OPENAI_API_KEY',
  gemini: 'GEMINI_API_KEY',
  xai: 'XAI_API_KEY',
};

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: 'ChatGPT (OpenAI)',
  gemini: 'Gemini (Google)',
  xai: 'Grok (xAI)',
};

export function providerConfigured(provider: ProviderId): boolean {
  return Boolean(env(PROVIDER_KEYS[provider]));
}
