'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { AgentConfig } from '../office.types';

type Direction = 'down' | 'up' | 'left' | 'right';

export function SpriteAgent({ agent, active, paused, busy, bubble, onClick }: {
  agent: AgentConfig;
  active: boolean;
  paused: boolean;
  /** True while the agent has a task running in the runtime. */
  busy?: boolean;
  /** Overrides the idle flavour text with what the agent is really doing. */
  bubble?: string;
  onClick: () => void;
}) {
  const [stop, setStop] = useState(0);
  const [moving, setMoving] = useState(false);
  const [direction, setDirection] = useState<Direction>('down');
  const stopRef = useRef(0);

  useEffect(() => {
    if (paused) return;

    let interval: ReturnType<typeof setInterval>;
    let rest: ReturnType<typeof setTimeout>;

    const walk = () => {
      const current = stopRef.current;
      const next = (current + 1) % agent.route.length;
      const [x, y] = agent.route[current];
      const [nextX, nextY] = agent.route[next];
      const dx = nextX - x;
      const dy = nextY - y;

      stopRef.current = next;
      setDirection(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
      setStop(next);
      setMoving(true);
      clearTimeout(rest);
      rest = setTimeout(() => setMoving(false), 1900);
    };

    const start = setTimeout(() => {
      walk();
      interval = setInterval(walk, 3900 + agent.id.length * 130);
    }, 700 + agent.id.length * 180);

    return () => { clearTimeout(start); clearTimeout(rest); clearInterval(interval); };
  }, [agent, paused]);

  const [x, y] = agent.route[stop];
  const style = { left: `${x}%`, top: `${y}%`, '--agent': agent.color, '--sprite': `url(${agent.spriteSheet})` } as CSSProperties;
  const caption = bubble ?? agent.tasks[stop];

  return (
    <button
      className={`agent sprite-agent ${direction} ${moving && !paused ? 'moving' : 'resting'} ${active ? 'active' : ''} ${busy ? 'busy' : ''}`}
      style={style}
      onClick={onClick}
      aria-label={`Open ${agent.id}, ${agent.role}${busy ? ', currently working' : ''}`}
    >
      <span className="bubble">{caption}</span>
      <span className="sprite-person" />
      <span className="agent-name">{agent.id}{busy && <em className="working-dot" />}</span>
      <span className="agent-role">{agent.role}</span>
    </button>
  );
}
