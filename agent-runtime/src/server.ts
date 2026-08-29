import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PROVIDER_KEYS, PROVIDER_LABELS, loadConfig, providerConfigured } from './config.ts';
import { getProvider } from './providers/index.ts';
import { fetchIssueByIdentifier, fetchOpenIssues, linearConfigured } from './integrations/linear.ts';
import {
  agentWorkload,
  cancel,
  deliver,
  enqueue,
  initOrchestrator,
} from './orchestrator.ts';
import { createTask, getTask, listTasks, loadTasks, subscribe } from './store.ts';
import type { ProviderId, Task } from './types.ts';

const config = loadConfig();
initOrchestrator(config);
loadTasks();

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    ...CORS_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new Error('Request body is not valid JSON');
  }
}

function runtimeStatus() {
  const providers = (Object.keys(PROVIDER_KEYS) as ProviderId[]).map((id) => ({
    id,
    label: PROVIDER_LABELS[id],
    configured: providerConfigured(id),
    envVar: PROVIDER_KEYS[id],
    defaultModel: providerConfigured(id) ? getProvider(id).defaultModel : undefined,
  }));

  return {
    ok: true,
    providers,
    integrations: { linear: linearConfigured() },
    agents: config.agents.map((agent) => ({
      ...agent,
      ready: providerConfigured(agent.provider),
    })),
    projects: config.projects.map((project) => ({
      id: project.id,
      name: project.name,
      baseBranch: project.baseBranch,
      verify: project.verify,
    })),
    workload: agentWorkload(),
  };
}

function handleEvents(response: ServerResponse): void {
  response.writeHead(200, {
    ...CORS_HEADERS,
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });

  const send = (data: unknown) => {
    response.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send({ type: 'hello', tasks: listTasks() });
  const unsubscribe = subscribe(send);
  const heartbeat = setInterval(() => response.write(': ping\n\n'), 25_000);

  response.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

async function createTaskFromRequest(body: Record<string, unknown>): Promise<Task> {
  const agentId = String(body.agentId ?? '');
  const agent = config.agents.find((entry) => entry.id === agentId);
  if (!agent) throw new Error(`Unknown agent "${agentId}"`);

  const projectId = String(body.projectId ?? '');
  const project = config.projects.find((entry) => entry.id === projectId);
  if (!project) throw new Error(`Unknown project "${projectId}"`);

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

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      response.writeHead(204, CORS_HEADERS);
      response.end();
      return;
    }

    try {
      if (path === '/api/health' || path === '/api/status') {
        json(response, 200, runtimeStatus());
        return;
      }

      if (path === '/api/events') {
        handleEvents(response);
        return;
      }

      if (path === '/api/tasks' && request.method === 'GET') {
        json(response, 200, { tasks: listTasks() });
        return;
      }

      if (path === '/api/tasks' && request.method === 'POST') {
        const task = await createTaskFromRequest(await readBody(request));
        enqueue(task.id);
        json(response, 201, { task });
        return;
      }

      const taskMatch = /^\/api\/tasks\/([^/]+)(?:\/(cancel|approve|retry))?$/.exec(path);
      if (taskMatch) {
        const [, id, action] = taskMatch;
        const task = getTask(id);
        if (!task) {
          json(response, 404, { error: 'Task not found' });
          return;
        }

        if (!action) {
          json(response, 200, { task });
          return;
        }
        if (action === 'cancel') {
          json(response, 200, { cancelled: cancel(id) });
          return;
        }
        if (action === 'approve') {
          if (task.stage !== 'awaiting-approval') {
            json(response, 409, { error: `Task is ${task.stage}, not awaiting approval` });
            return;
          }
          json(response, 200, { task: await deliver(id) });
          return;
        }
        if (action === 'retry') {
          enqueue(id);
          json(response, 200, { task: getTask(id) });
          return;
        }
      }

      if (path === '/api/linear/issues' && request.method === 'GET') {
        if (!linearConfigured()) {
          json(response, 400, { error: 'LINEAR_API_KEY is not set' });
          return;
        }
        const issues = await fetchOpenIssues(
          url.searchParams.get('team') ?? config.linear?.teamKey,
        );
        json(response, 200, { issues });
        return;
      }

      if (path === '/api/linear/assign' && request.method === 'POST') {
        const body = await readBody(request);
        const identifier = String(body.identifier ?? '');
        const issue = await fetchIssueByIdentifier(identifier);
        if (!issue) {
          json(response, 404, { error: `Linear issue ${identifier} not found` });
          return;
        }
        const task = await createTaskFromRequest({
          ...body,
          title: `${issue.identifier} ${issue.title}`,
          brief: [issue.title, '', issue.description].join('\n').trim(),
          source: { kind: 'linear', ref: issue.identifier, url: issue.url, id: issue.id },
        });
        enqueue(task.id);
        json(response, 201, { task });
        return;
      }

      json(response, 404, { error: `No route for ${request.method} ${path}` });
    } catch (error) {
      json(response, 400, { error: (error as Error).message });
    }
  })();
});

server.listen(config.port, () => {
  const ready = config.agents.filter((agent) => providerConfigured(agent.provider)).length;
  console.log(`\n  Super Agent runtime → http://localhost:${config.port}`);
  console.log(`  Agents: ${ready}/${config.agents.length} ready · Projects: ${config.projects.length}`);
  const missing = (Object.keys(PROVIDER_KEYS) as ProviderId[]).filter((id) => !providerConfigured(id));
  if (missing.length) {
    console.log(`  Not configured: ${missing.map((id) => PROVIDER_KEYS[id]).join(', ')}`);
  }
  if (!linearConfigured()) console.log('  Linear: set LINEAR_API_KEY to import issues');
  console.log('');
});
