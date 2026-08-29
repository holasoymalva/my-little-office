'use client';

import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { OfficeConfig } from '../office.types';
import { SpriteAgent } from './sprite-agent';

type ThemeStyle = CSSProperties & Record<`--${string}`, string>;

export function OfficeDashboard({ config }: { config: OfficeConfig }) {
  const [selectedId, setSelectedId] = useState(config.agents[1]?.id ?? config.agents[0].id);
  const [running, setRunning] = useState(true);
  const [view, setView] = useState<'office' | 'pipeline'>('office');
  const selected = config.agents.find((agent) => agent.id === selectedId) ?? config.agents[0];
  const today = useMemo(() => new Intl.DateTimeFormat(config.system.locale, { weekday: 'short', day: '2-digit', month: 'short' }).format(new Date()), [config.system.locale]);
  const goalProgress = Math.min(100, Math.round((config.goal.current / config.goal.target) * 100));
  const themeStyle: ThemeStyle = {
    '--ink': config.theme.ink,
    '--muted': config.theme.muted,
    '--line': config.theme.line,
    '--panel': config.theme.panel,
    '--bg': config.theme.background,
    '--lime': config.theme.accent,
    '--cyan': config.theme.secondary,
  };

  return (
    <main className="app-shell" style={themeStyle}>
      <header className="topbar">
        <div className="brand"><span className="brand-mark">{config.brand.mark}</span><div><strong>{config.brand.name}</strong><small>{config.brand.tagline}</small></div></div>
        <nav aria-label="Main views">
          <button className={view === 'office' ? 'selected' : ''} onClick={() => setView('office')}>{config.navigation.office}</button>
          <button className={view === 'pipeline' ? 'selected' : ''} onClick={() => setView('pipeline')}>{config.navigation.pipeline}</button>
        </nav>
        <div className="live"><span /> {config.system.status} <b>{today.toUpperCase()}</b></div>
      </header>

      <section className="statsbar">
        {config.stats.map((stat) => <div key={stat.label}><small>{stat.label}</small><strong>{stat.value}</strong>{stat.trend && <i>{stat.trend}</i>}</div>)}
      </section>

      <div className="workspace">
        <aside className="left-panel panel">
          <div className="panel-title"><span>◫</span> {config.labels.workstreams}</div>
          {config.workstreams.map((stream, index) => <button className={`channel ${stream.active ? 'active' : ''}`} key={stream.name}><span className={`channel-icon c${index}`}>{stream.icon}</span><div><strong>{stream.name}</strong><small>{stream.detail}</small></div><i /></button>)}
          <div className="panel-title second"><span>◈</span> {config.labels.goal}</div>
          <div className="goal"><div><strong>{config.goal.current} / {config.goal.target}</strong><small>{config.goal.unit}</small></div><span><i style={{ width: `${goalProgress}%` }} /></span><p>{config.goal.note}</p></div>
          <button className="new-channel">＋ {config.labels.addWorkstream}</button>
        </aside>

        <section className={`office ${view}`}>
          <div className="office-head"><div><small>{config.floor.eyebrow}</small><h1>{view === 'office' ? config.floor.officeTitle : config.floor.pipelineTitle}</h1></div><button onClick={() => setRunning(!running)}>{running ? config.labels.pause : config.labels.resume}</button></div>
          <div className={`factory-floor ${running ? 'running' : ''}`}>
            <div className="office-art" style={{ backgroundImage: `url('${config.floor.backgroundImage}')` }} role="img" aria-label={config.floor.ariaLabel} />
            <div className="warm-overlay" />
            {config.floor.zones.map((zone) => <div className={`zone-chip ${zone.className}`} key={zone.label}><i /> {zone.label}</div>)}
            {config.agents.map((agent) => <SpriteAgent key={agent.id} agent={agent} active={selected.id === agent.id} paused={!running} onClick={() => setSelectedId(agent.id)} />)}
            <div className="floor-label">{view === 'office' ? config.floor.officeFooter : config.floor.pipelineFooter}</div>
          </div>
        </section>

        <aside className="right-panel panel">
          <div className="panel-title"><span>◎</span> {config.labels.selectedAgent}</div>
          <div className="agent-card" style={{ '--agent': selected.color } as CSSProperties}>
            <span className="sprite-person preview" style={{ '--row': selected.spriteRow } as CSSProperties} />
            <small>{selected.id}</small><h2>{selected.role}</h2><p>{selected.tasks[0]}</p>
            <div className="progress-head"><span>{config.labels.progress}</span><b>{selected.progress}%</b></div><div className="progress"><i style={{ width: `${selected.progress}%` }} /></div>
          </div>
          <div className="panel-title second"><span>≡</span> {config.labels.activity}</div>
          <div className="activity">
            {config.activity.map((item) => <p key={`${item.agent}-${item.message}`}><b style={{ color: item.color }}>{item.agent}</b> {item.message} <time>{item.age}</time></p>)}
          </div>
        </aside>
      </div>

      <section className="bottom-dock">
        <div className="queue-head"><div><span>{config.labels.queue}</span><small>{config.labels.queueNote}</small></div><button>{config.labels.queueAction}</button></div>
        <div className="queue-list">{config.queue.map((item, index) => <article key={item.title}><span className="rank">{String(index + 1).padStart(2, '0')}</span><div><small>{item.category}</small><h3>{item.title}</h3></div><div className="score"><span>{item.priority}</span><small>{config.labels.score}</small></div><b>{item.state}</b></article>)}</div>
        <p className="asset-credit">{config.assetCredit}</p>
      </section>
    </main>
  );
}
