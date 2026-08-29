'use client';

import { useEffect, useMemo, useState } from 'react';

const agents = [
  { id: 'NOVA', role: 'Tendencias', color: '#c7f43d', progress: 78, spriteRow: 0, tasks: ['Rastreando tendencias', 'Compartiendo 3 hallazgos', 'Preparando café'], route: [[24, 47], [43, 53], [11, 59]] },
  { id: 'DARWIN', role: 'Investigación', color: '#54e1d5', progress: 62, spriteRow: 2, tasks: ['Verificando una fuente', 'Revisando con Byte', 'Anotando en el pizarrón'], route: [[24, 79], [46, 65], [50, 38]] },
  { id: 'BYTE', role: 'Guion', color: '#ffb13b', progress: 86, spriteRow: 3, tasks: ['Escribiendo el hook #18', 'Pidiendo contexto a Darwin', 'Enviando guion a Pixel'], route: [[50, 47], [50, 65], [64, 58]] },
  { id: 'PIXEL', role: 'Producción', color: '#a884ff', progress: 45, spriteRow: 1, tasks: ['Renderizando en 9:16', 'Recibiendo el guion', 'Revisando el corte final'], route: [[75, 78], [62, 68], [75, 47]] },
  { id: 'ATLAS', role: 'Distribución', color: '#ff6868', progress: 91, spriteRow: 1, tasks: ['Revisando calendario', 'Sincronizando con Pixel', 'Programando desde el lounge'], route: [[75, 47], [66, 57], [88, 62]] },
] as const;

const queue = [
  { title: 'El animal que puede “editar” su ARN', niche: 'ANIMALES', score: 94, state: 'Guion aprobado' },
  { title: '¿Qué pasaría si la Luna desaparece?', niche: 'CIENCIA', score: 91, state: 'En producción' },
  { title: 'El bug que paralizó medio internet', niche: 'CÓDIGO', score: 87, state: 'Investigando' },
  { title: 'La lluvia más extraña del planeta', niche: 'CURIOSIDAD', score: 84, state: 'Idea nueva' },
];

type Direction = 'down' | 'up' | 'left' | 'right';

function SpriteAgent({ agent, active, paused, onClick }: { agent: typeof agents[number]; active: boolean; paused: boolean; onClick: () => void }) {
  const [stop, setStop] = useState(0);
  const [moving, setMoving] = useState(false);
  const [direction, setDirection] = useState<Direction>('down');

  useEffect(() => {
    if (paused) {
      setMoving(false);
      return;
    }
    let interval: ReturnType<typeof setInterval>;
    let rest: ReturnType<typeof setTimeout>;
    const walk = () => {
      setStop((current) => {
        const next = (current + 1) % agent.route.length;
        const [x, y] = agent.route[current];
        const [nextX, nextY] = agent.route[next];
        const dx = nextX - x;
        const dy = nextY - y;
        setDirection(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
        setMoving(true);
        clearTimeout(rest);
        rest = setTimeout(() => setMoving(false), 1900);
        return next;
      });
    };
    const start = setTimeout(() => {
      walk();
      interval = setInterval(walk, 3900 + agent.spriteRow * 260);
    }, 700 + agent.spriteRow * 430);
    return () => { clearTimeout(start); clearTimeout(rest); clearInterval(interval); };
  }, [agent, paused]);

  const [x, y] = agent.route[stop];
  return (
    <button className={`agent sprite-agent ${direction} ${moving ? 'moving' : 'resting'} ${active ? 'active' : ''}`} style={{ left: `${x}%`, top: `${y}%`, '--agent': agent.color, '--row': agent.spriteRow } as React.CSSProperties} onClick={onClick} aria-label={`Abrir agente ${agent.id}`}>
      <span className="bubble">{agent.tasks[stop]}</span>
      <span className="sprite-person" />
      <span className="agent-name">{agent.id}</span>
      <span className="agent-role">{agent.role}</span>
    </button>
  );
}

export default function Home() {
  const [selected, setSelected] = useState<(typeof agents)[number]>(agents[2]);
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
            <div className="office-art" role="img" aria-label="Oficina pixel art rústica con ladrillo, madera, plantas y estaciones de trabajo" />
            <div className="warm-overlay" />
            <div className="zone-chip zone-radar"><i /> RADAR & CAFÉ</div>
            <div className="zone-chip zone-lab"><i /> RESEARCH LAB</div>
            <div className="zone-chip zone-story"><i /> STORY ROOM</div>
            <div className="zone-chip zone-studio"><i /> EDIT SUITE</div>
            <div className="zone-chip zone-lounge"><i /> LAUNCH LOUNGE</div>
            {agents.map(agent => <SpriteAgent key={agent.id} agent={agent} active={selected.id === agent.id} paused={!running} onClick={() => setSelected(agent)} />)}
            <div className="floor-label">{view === 'oficina' ? 'TURNO AUTOMÁTICO · 08:00—22:00' : 'DESCUBRIR → VERIFICAR → ESCRIBIR → PRODUCIR → PUBLICAR'}</div>
          </div>
        </section>

        <aside className="right-panel panel">
          <div className="panel-title"><span>◎</span> AGENTE SELECCIONADO</div>
          <div className="agent-card" style={{ '--agent': selected.color } as React.CSSProperties}>
            <span className="sprite-person preview" style={{ '--row': selected.spriteRow } as React.CSSProperties} />
            <small>AGENTE {selected.id}</small><h2>{selected.role}</h2><p>{selected.tasks[0]}</p>
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
        <p className="asset-credit">Personajes: MetroCity Character Pack por JIK-A-4 · CC0 1.0</p>
      </section>
    </main>
  );
}
