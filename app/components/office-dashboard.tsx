'use client';

import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { OfficeConfig } from '../office.types';
import type { Task, TaskStep } from '../lib/runtime';
import { STAGE_LABELS, isActive, relativeTime, useRuntime } from '../lib/runtime';
import { ChatDock } from './chat-dock';
import { ProjectManager } from './project-manager';
import { SpriteAgent } from './sprite-agent';
import { TaskComposer } from './task-composer';
import { TaskConsole } from './task-console';

type ThemeStyle = CSSProperties & Record<`--${string}`, string>;

const DONE_STAGES = new Set(['done']);

function stageTone(stage: Task['stage']): string {
  if (stage === 'done') return 'ok';
  if (stage === 'failed' || stage === 'cancelled') return 'bad';
  if (stage === 'awaiting-approval') return 'warn';
  return 'live';
}

/** Newest steps across every task, used as the live activity feed. */
function recentActivity(tasks: Task[], limit: number): { task: Task; step: TaskStep }[] {
  return tasks
    .flatMap((task) => task.steps.slice(-4).map((step) => ({ task, step })))
    .sort((a, b) => b.step.at.localeCompare(a.step.at))
    .slice(0, limit);
}

export function OfficeDashboard({ config }: { config: OfficeConfig }) {
  const runtime = useRuntime();
  const [selectedId, setSelectedId] = useState(config.agents[1]?.id ?? config.agents[0].id);
  const [running, setRunning] = useState(true);
  const [view, setView] = useState<'office' | 'pipeline'>('office');
  const [composerOpen, setComposerOpen] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const selected = config.agents.find((agent) => agent.id === selectedId) ?? config.agents[0];
  const today = useMemo(
    () => new Intl.DateTimeFormat(config.system.locale, { weekday: 'short', day: '2-digit', month: 'short' }).format(new Date()),
    [config.system.locale],
  );

  const tasks = runtime.tasks;
  const openTask = tasks.find((task) => task.id === openTaskId) ?? null;

  /** The one task each agent is actively running, keyed by agent id. */
  const liveByAgent = useMemo(() => {
    const map = new Map<string, Task>();
    for (const task of tasks) {
      if (isActive(task) && !map.has(task.agentId)) map.set(task.agentId, task);
    }
    return map;
  }, [tasks]);

  const visibleTasks = useMemo(
    () => (projectFilter ? tasks.filter((task) => task.projectId === projectFilter) : tasks),
    [tasks, projectFilter],
  );

  const activeCount = tasks.filter(isActive).length;
  const doneCount = tasks.filter((task) => DONE_STAGES.has(task.stage)).length;
  const awaiting = tasks.filter((task) => task.stage === 'awaiting-approval').length;
  const prCount = tasks.filter((task) => task.prUrl).length;
  const readyAgents = runtime.status?.agents.filter((agent) => agent.ready).length ?? 0;
  const totalAgents = runtime.status?.agents.length ?? config.agents.length;

  const liveStats = runtime.connected
    ? [
        { label: 'AGENTS READY', value: `${readyAgents}/${totalAgents}` },
        { label: 'TASKS RUNNING', value: String(activeCount), trend: awaiting ? `${awaiting} to approve` : undefined },
        { label: 'PULL REQUESTS', value: String(prCount) },
        { label: 'DELIVERED', value: String(doneCount) },
      ]
    : config.stats;

  const activity = recentActivity(tasks, 14);
  const selectedTask = liveByAgent.get(selected.id)
    ?? tasks.find((task) => task.agentId === selected.id)
    ?? null;
  const selectedProfile = runtime.status?.agents.find((agent) => agent.id === selected.id);

  const themeStyle: ThemeStyle = {
    '--ink': config.theme.ink,
    '--muted': config.theme.muted,
    '--line': config.theme.line,
    '--panel': config.theme.panel,
    '--bg': config.theme.background,
    '--lime': config.theme.accent,
    '--cyan': config.theme.secondary,
  };

  const goalTarget = Math.max(tasks.length, 1);
  const goalProgress = runtime.connected
    ? Math.round((doneCount / goalTarget) * 100)
    : Math.min(100, Math.round((config.goal.current / config.goal.target) * 100));

  return (
    <main className="app-shell" style={themeStyle}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">{config.brand.mark}</span>
          <div><strong>{config.brand.name}</strong><small>{config.brand.tagline}</small></div>
        </div>
        <nav aria-label="Main views">
          <button className={view === 'office' ? 'selected' : ''} onClick={() => setView('office')}>{config.navigation.office}</button>
          <button className={view === 'pipeline' ? 'selected' : ''} onClick={() => setView('pipeline')}>{config.navigation.pipeline}</button>
        </nav>
        <div className={`live ${runtime.connected ? '' : 'offline'}`}>
          <span /> {runtime.connected ? `${activeCount} AGENT${activeCount === 1 ? '' : 'S'} WORKING` : 'RUNTIME OFFLINE'}
          <b>{today.toUpperCase()}</b>
        </div>
      </header>

      {!runtime.connected && (
        <div className="runtime-banner">
          <b>The agent runtime is not running.</b>
          <span>{runtime.error ?? 'Start it in a second terminal:'}</span>
          <code>npm run agents</code>
        </div>
      )}

      <section className="statsbar">
        {liveStats.map((stat) => (
          <div key={stat.label}>
            <small>{stat.label}</small>
            <strong>{stat.value}</strong>
            {stat.trend && <i>{stat.trend}</i>}
          </div>
        ))}
      </section>

      <div className="workspace">
        <aside className="left-panel panel">
          <div className="panel-title">
            <span>◫</span> PROJECTS
            <button className="panel-action" onClick={() => setProjectsOpen(true)} disabled={!runtime.status}>
              MANAGE
            </button>
          </div>
          {(runtime.status?.projects ?? []).map((project, index) => {
            const count = tasks.filter((task) => task.projectId === project.id && isActive(task)).length;
            return (
              <button
                className={`channel ${projectFilter === project.id ? 'active' : ''}`}
                key={project.id}
                onClick={() => setProjectFilter(projectFilter === project.id ? null : project.id)}
              >
                <span className={`channel-icon c${index % 3}`}>{'</>'}</span>
                <div>
                  <strong>{project.name}</strong>
                  <small title={project.path ?? project.repo}>
                    {count ? `${count} running` : shortPath(project.path) ?? `base: ${project.baseBranch}`}
                  </small>
                </div>
                <i />
              </button>
            );
          })}
          {!runtime.status?.projects.length && (
            <p className="empty-hint">
              No repository yet. Hit <b>MANAGE</b> and give the office the path of a git checkout.
            </p>
          )}

          <div className="panel-title second"><span>◈</span> DELIVERY</div>
          <div className="goal">
            <div>
              <strong>{doneCount} / {tasks.length}</strong>
              <small>TASKS SHIPPED</small>
            </div>
            <span><i style={{ width: `${goalProgress}%` }} /></span>
            <p>{awaiting ? `${awaiting} task(s) verified and waiting for your approval.` : 'Every delivered task went through the project checks first.'}</p>
          </div>

          <button className="new-channel primary-cta" onClick={() => setComposerOpen(true)} disabled={!runtime.status}>
            ＋ ASSIGN TASK
          </button>
          <button className="new-channel" onClick={() => setChatOpen(true)} disabled={!runtime.status}>
            ▣ CHAT WITH THE TEAM
          </button>
        </aside>

        <section className={`office ${view}`}>
          <div className="office-head">
            <div>
              <small>{config.floor.eyebrow}</small>
              <h1>{view === 'office' ? config.floor.officeTitle : config.floor.pipelineTitle}</h1>
            </div>
            <button onClick={() => setRunning(!running)}>{running ? config.labels.pause : config.labels.resume}</button>
          </div>
          <div className={`factory-floor ${running ? 'running' : ''}`}>
            <div className="office-art" style={{ backgroundImage: `url('${config.floor.backgroundImage}')` }} role="img" aria-label={config.floor.ariaLabel} />
            <div className="warm-overlay" />
            {config.floor.zones.map((zone) => <div className={`zone-chip ${zone.className}`} key={zone.label}><i /> {zone.label}</div>)}
            {config.agents.map((agent) => {
              const task = liveByAgent.get(agent.id);
              return (
                <SpriteAgent
                  key={agent.id}
                  agent={agent}
                  active={selected.id === agent.id}
                  paused={!running}
                  busy={Boolean(task)}
                  bubble={task ? `${STAGE_LABELS[task.stage]} — ${task.title}` : undefined}
                  onClick={() => {
                    setSelectedId(agent.id);
                    if (task) setOpenTaskId(task.id);
                  }}
                />
              );
            })}
            <div className="floor-label">{view === 'office' ? config.floor.officeFooter : config.floor.pipelineFooter}</div>
          </div>
        </section>

        <aside className="right-panel panel">
          <div className="panel-title"><span>◎</span> {config.labels.selectedAgent}</div>
          <div className="agent-card" style={{ '--agent': selected.color } as CSSProperties}>
            <span className="sprite-person preview" style={{ '--sprite': `url(${selected.spriteSheet})` } as CSSProperties} />
            <small>{selected.id}</small>
            <h2>{selected.role}</h2>
            {selectedProfile && (
              <p className="agent-model">
                {selectedProfile.provider}
                {selectedProfile.ready ? '' : ' · no API key'}
              </p>
            )}
            <p>{selectedTask ? selectedTask.title : 'Idle — no task assigned.'}</p>
            {selectedTask && (
              <>
                <div className="progress-head">
                  <span>{STAGE_LABELS[selectedTask.stage].toUpperCase()}</span>
                  <b>{selectedTask.usage.calls} calls</b>
                </div>
                <div className="progress">
                  <i className={isActive(selectedTask) ? 'pulsing' : ''} style={{ width: `${stageWidth(selectedTask.stage)}%` }} />
                </div>
                <button className="link-button" onClick={() => setOpenTaskId(selectedTask.id)}>OPEN CONSOLE →</button>
              </>
            )}
          </div>

          <div className="panel-title second"><span>≡</span> {config.labels.activity}</div>
          <div className="activity">
            {activity.length === 0 && <p className="empty-hint">Nothing yet. Assign a task to see agents work.</p>}
            {activity.map(({ task, step }) => (
              <p key={step.id} onClick={() => setOpenTaskId(task.id)} className="clickable">
                <b style={{ color: config.agents.find((agent) => agent.id === task.agentId)?.color ?? '#c7f43d' }}>
                  {task.agentId}
                </b>
                {step.title.length > 74 ? `${step.title.slice(0, 74)}…` : step.title}
                <time>{relativeTime(step.at)}</time>
              </p>
            ))}
          </div>
        </aside>
      </div>

      <section className="bottom-dock">
        <div className="queue-head">
          <div>
            <span>TASK BOARD</span>
            <small>
              {projectFilter ? `FILTERED · ${visibleTasks.length} TASKS` : `${tasks.length} TASKS`}
            </small>
          </div>
          <div className="queue-actions">
            <button onClick={() => setChatOpen(true)} disabled={!runtime.status}>▣ CHAT</button>
            <button onClick={() => setComposerOpen(true)} disabled={!runtime.status}>＋ NEW TASK</button>
          </div>
        </div>
        <div className="queue-list">
          {visibleTasks.length === 0 && (
            <p className="empty-hint wide">
              No tasks yet. Hit <b>ASSIGN TASK</b> to give an agent a bug to fix or a feature to build.
            </p>
          )}
          {visibleTasks.slice(0, 8).map((task, index) => (
            <article key={task.id} className={`task-card ${stageTone(task.stage)}`} onClick={() => setOpenTaskId(task.id)}>
              <span className="rank">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <small>{task.source.ref ?? task.projectId.toUpperCase()}</small>
                <h3>{task.title}</h3>
              </div>
              <div className="score">
                <span>{task.agentId}</span>
                <small>{task.provider}</small>
              </div>
              <b>{STAGE_LABELS[task.stage]}{task.prUrl ? ' · PR open' : ''}</b>
            </article>
          ))}
        </div>
        <p className="asset-credit">{config.assetCredit}</p>
      </section>

      {composerOpen && runtime.status && (
        <TaskComposer
          status={runtime.status}
          defaultAgentId={selected.id}
          onClose={() => setComposerOpen(false)}
          onCreated={(taskId) => setOpenTaskId(taskId)}
        />
      )}

      {projectsOpen && runtime.status && (
        <ProjectManager
          status={runtime.status}
          onClose={() => setProjectsOpen(false)}
          onChanged={runtime.refresh}
        />
      )}

      {chatOpen && runtime.status && (
        <ChatDock
          status={runtime.status}
          chat={runtime.chat}
          tasks={tasks}
          onClose={() => setChatOpen(false)}
          onOpenTask={(taskId) => setOpenTaskId(taskId)}
          onChanged={runtime.refresh}
        />
      )}

      {openTask && <TaskConsole task={openTask} onClose={() => setOpenTaskId(null)} />}
    </main>
  );
}

/** Keeps a long path readable in the narrow projects rail. */
function shortPath(path?: string): string | undefined {
  const parts = (path ?? '').split('/').filter((part) => part && part !== '.');
  if (!parts.length) return undefined;
  return parts.length <= 2 ? parts.join('/') : `…/${parts.slice(-2).join('/')}`;
}

/** Rough visual progress per stage — the pipeline has no better signal to offer. */
function stageWidth(stage: Task['stage']): number {
  const order: Task['stage'][] = [
    'queued', 'preparing', 'planning', 'implementing', 'verifying',
    'repairing', 'awaiting-approval', 'delivering', 'done',
  ];
  const index = order.indexOf(stage);
  if (stage === 'failed' || stage === 'cancelled') return 100;
  return index < 0 ? 5 : Math.round(((index + 1) / order.length) * 100);
}
