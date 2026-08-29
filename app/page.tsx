'use client';

import { useMemo, useState } from 'react';

const agents = [
  { id: 'NOVA', role: 'Tendencias', color: '#c7f43d', task: 'Rastreando 42 temas', progress: 78, x: '15%', y: '30%' },
  { id: 'DARWIN', role: 'Investigación', color: '#54e1d5', task: 'Verificando pulpos', progress: 62, x: '37%', y: '58%' },
  { id: 'BYTE', role: 'Guion', color: '#ffb13b', task: 'Escribiendo hook #18', progress: 86, x: '53%', y: '29%' },
  { id: 'PIXEL', role: 'Producción', color: '#a884ff', task: 'Renderizando 9:16', progress: 45, x: '70%', y: '57%' },
  { id: 'ATLAS', role: 'Distribución', color: '#ff6868', task: 'Llenando calendario', progress: 91, x: '86%', y: '31%' },
];

const queue = [
  { title: 'El animal que puede “editar” su ARN', niche: 'ANIMALES', score: 94, state: 'Guion aprobado' },
  { title: '¿Qué pasaría si la Luna desaparece?', niche: 'CIENCIA', score: 91, state: 'En producción' },
  { title: 'El bug que paralizó medio internet', niche: 'CÓDIGO', score: 87, state: 'Investigando' },
  { title: 'La lluvia más extraña del planeta', niche: 'CURIOSIDAD', score: 84, state: 'Idea nueva' },
];

function PixelAgent({ agent, active, onClick }: { agent: typeof agents[number]; active: boolean; onClick: () => void }) {
  return (
    <button className={`agent ${active ? 'active' : ''}`} style={{ left: agent.x, top: agent.y, '--agent': agent.color } as React.CSSProperties} onClick={onClick} aria-label={`Abrir agente ${agent.id}`}>
      <span className="bubble">{agent.task}</span>
      <span className="pixel-person"><i /><b /><em /></span>
      <span className="agent-name">{agent.id}</span>
      <span className="agent-role">{agent.role}</span>
    </button>
  );
}

export default function Home() {
  const [selected, setSelected] = useState(agents[2]);
  const [running, setRunning] = useState(true);
  const [view, setView] = useState<'oficina' | 'pipeline'>('oficina');
  const today = useMemo(() => new Intl.DateTimeFormat('es-MX', { weekday: 'short', day: '2-digit', month: 'short' }).format(new Date()), []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">S</span><div><strong>SHORTS FOUNDRY</strong><small>AI CONTENT OPERATIONS</small></div></div>
        <nav aria-label="Vistas principales">
          <button className={view === 'oficina' ? 'selected' : ''} onClick={() => setView('oficina')}>OFICINA</button>
          <button className={view === 'pipeline' ? 'selected' : ''} onClick={() => setView('pipeline')}>PIPELINE</button>
        </nav>
        <div className="live"><span /> SISTEMA ACTIVO <b>{today.toUpperCase()}</b></div>
      </header>

      <section className="statsbar">
        <div><small>AGENTES EN TURNO</small><strong>5/5</strong></div>
        <div><small>SHORTS ESTA SEMANA</small><strong>18</strong><i>+28%</i></div>
        <div><small>COLA DE PRODUCCIÓN</small><strong>12</strong></div>
        <div><small>PRÓXIMA PUBLICACIÓN</small><strong>01:42:18</strong></div>
      </section>

      <div className="workspace">
        <aside className="left-panel panel">
          <div className="panel-title"><span>◫</span> CANALES</div>
          {['Ciencia diaria', 'Fauna secreta', 'Código curioso'].map((name, i) => <button className={`channel ${i === 0 ? 'active' : ''}`} key={name}><span className={`channel-icon c${i}`}>{['⚛','◆','⌘'][i]}</span><div><strong>{name}</strong><small>{[7,5,6][i]} clips activos</small></div><i /></button>)}
          <div className="panel-title second"><span>◈</span> OBJETIVO SEMANAL</div>
          <div className="goal"><div><strong>18 / 24</strong><small>SHORTS</small></div><span><i /></span><p>6 piezas para completar la semana</p></div>
          <button className="new-channel">＋ NUEVO CANAL</button>
        </aside>

        <section className={`office ${view}`}>
          <div className="office-head"><div><small>PLANTA 01 / PRODUCCIÓN</small><h1>{view === 'oficina' ? 'La oficina nunca duerme.' : 'Flujo editorial en tiempo real.'}</h1></div><button onClick={() => setRunning(!running)}>{running ? 'Ⅱ PAUSAR TURNO' : '▶ REANUDAR'}</button></div>
          <div className={`factory-floor ${running ? 'running' : ''}`}>
            <div className="grid-lines" />
            <div className="room research"><span>RADAR DE IDEAS</span><div className="radar"><i /></div></div>
            <div className="room writers"><span>MESA DE GUIONES</span><div className="desk d1"/><div className="desk d2"/></div>
            <div className="room studio"><span>ESTUDIO VERTICAL</span><div className="screen">9:16<small>00:24</small></div></div>
            <div className="conveyor"><i/><i/><i/><i/><i/></div>
            {agents.map(agent => <PixelAgent key={agent.id} agent={agent} active={selected.id === agent.id} onClick={() => setSelected(agent)} />)}
            <div className="floor-label">{view === 'oficina' ? 'TURNO AUTOMÁTICO · 08:00—22:00' : 'DESCUBRIR → VERIFICAR → ESCRIBIR → PRODUCIR → PUBLICAR'}</div>
          </div>
        </section>

        <aside className="right-panel panel">
          <div className="panel-title"><span>◎</span> AGENTE SELECCIONADO</div>
          <div className="agent-card" style={{ '--agent': selected.color } as React.CSSProperties}>
            <span className="pixel-person large"><i /><b /><em /></span>
            <small>AGENTE {selected.id}</small><h2>{selected.role}</h2><p>{selected.task}</p>
            <div className="progress-head"><span>PROGRESO</span><b>{selected.progress}%</b></div><div className="progress"><i style={{ width: `${selected.progress}%` }}/></div>
          </div>
          <div className="panel-title second"><span>≡</span> ACTIVIDAD EN VIVO</div>
          <div className="activity">
            <p><b className="green">NOVA</b> detectó una tendencia <time>ahora</time></p>
            <p><b className="orange">BYTE</b> aprobó el hook #18 <time>2m</time></p>
            <p><b className="purple">PIXEL</b> exportó 1080×1920 <time>4m</time></p>
            <p><b className="red">ATLAS</b> programó YouTube <time>7m</time></p>
          </div>
        </aside>
      </div>

      <section className="bottom-dock">
        <div className="queue-head"><div><span>COLA EDITORIAL</span><small>4 PIEZAS PRIORITARIAS</small></div><button>VER CALENDARIO →</button></div>
        <div className="queue-list">{queue.map((item, i) => <article key={item.title}><span className="rank">0{i+1}</span><div><small>{item.niche}</small><h3>{item.title}</h3></div><div className="score"><span>{item.score}</span><small>VIRAL SCORE</small></div><b>{item.state}</b></article>)}</div>
      </section>
    </main>
  );
}
