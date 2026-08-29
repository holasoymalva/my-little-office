/**
 * Checks the pieces that usually go wrong before you spend a single token:
 * config validity, provider keys and models, git access to every project,
 * and the sandbox that keeps agents inside their workspace.
 *
 *   npm run agents:check
 */
import { PROVIDER_KEYS, PROVIDER_LABELS, loadConfig, providerConfigured } from './src/config.ts';
import { runShell, runTool } from './src/agent/tools.ts';
import { getProvider } from './src/providers/index.ts';
import { linearConfigured, fetchOpenIssues } from './src/integrations/linear.ts';
import type { ProviderId } from './src/types.ts';

const pass = (message: string) => console.log(`  \x1b[32m✓\x1b[0m ${message}`);
const warn = (message: string) => console.log(`  \x1b[33m!\x1b[0m ${message}`);
const fail = (message: string) => console.log(`  \x1b[31m✗\x1b[0m ${message}`);

let problems = 0;

console.log('\nConfiguration');
const config = loadConfig();
if (!config.agents.length) { fail('No agents defined in super-agent.config.json'); problems += 1; }
else pass(`${config.agents.length} agents defined`);
if (!config.projects.length) { fail('No projects defined in super-agent.config.json'); problems += 1; }
else pass(`${config.projects.length} project(s) defined`);

for (const agent of config.agents) {
  if (!providerConfigured(agent.provider)) {
    warn(`${agent.id} uses ${agent.provider} but ${PROVIDER_KEYS[agent.provider]} is not set — it cannot take work`);
  }
}

console.log('\nModel providers');
for (const id of Object.keys(PROVIDER_KEYS) as ProviderId[]) {
  if (!providerConfigured(id)) {
    warn(`${PROVIDER_LABELS[id]}: ${PROVIDER_KEYS[id]} not set — skipped`);
    continue;
  }
  const provider = getProvider(id);
  try {
    const result = await provider.chat(
      [{ role: 'user', content: 'Reply with the single word: ready' }],
      { model: provider.defaultModel, maxTokens: 16 },
    );
    pass(`${PROVIDER_LABELS[id]} · ${provider.defaultModel} · replied "${result.text.trim().slice(0, 20)}"`);
  } catch (error) {
    fail(`${PROVIDER_LABELS[id]} · ${provider.defaultModel} · ${(error as Error).message.slice(0, 200)}`);
    problems += 1;
  }
}

console.log('\nProjects');
for (const project of config.projects) {
  const source = project.repo ?? project.path ?? '';
  const check = project.repo
    ? await runShell(`git ls-remote --exit-code ${JSON.stringify(project.repo)} HEAD`, { cwd: process.cwd(), timeoutMs: 30_000 })
    : await runShell('git rev-parse --is-inside-work-tree', { cwd: source, timeoutMs: 15_000 });

  if (check.code === 0) pass(`${project.name} · reachable · base ${project.baseBranch} · verify: ${project.verify.join(' && ') || '(none)'}`);
  else { fail(`${project.name} · cannot reach ${source}: ${(check.stderr || check.stdout).trim().slice(0, 160)}`); problems += 1; }

  if (!project.verify.length) warn(`${project.name} has no verify commands — changes will be delivered unchecked`);
}

console.log('\nDelivery');
const gh = await runShell('gh auth status', { cwd: process.cwd(), timeoutMs: 20_000 });
if (gh.code === 0) pass('GitHub CLI authenticated — pull requests can be opened');
else warn('gh is not authenticated; agents will commit and push but cannot open pull requests');

if (linearConfigured()) {
  try {
    const issues = await fetchOpenIssues(config.linear?.teamKey, 3);
    pass(`Linear reachable · ${issues.length} open issue(s) visible`);
  } catch (error) {
    fail(`Linear: ${(error as Error).message.slice(0, 180)}`);
    problems += 1;
  }
} else {
  warn('LINEAR_API_KEY not set — the Linear tab in the dashboard will be empty');
}

console.log('\nSandbox');
const sandbox = {
  cwd: process.cwd(),
  allowedCommands: config.allowedCommands,
  deniedPatterns: config.deniedPatterns,
  timeoutMs: 10_000,
};
const escape = await runTool(sandbox, 'read_file', { path: '../../../etc/passwd' });
const denied = await runTool(sandbox, 'run_command', { command: 'curl http://example.com' });
if (escape.isError && denied.isError) pass('Path escapes and denied commands are blocked');
else { fail('Sandbox is not blocking escapes — review deniedPatterns in super-agent.config.json'); problems += 1; }

console.log(problems ? `\n${problems} problem(s) to fix before agents can deliver.\n` : '\nReady. Start the runtime with: npm run agents\n');
process.exit(problems ? 1 : 0);
