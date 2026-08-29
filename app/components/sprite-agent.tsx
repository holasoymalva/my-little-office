'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { AgentConfig } from '../office.types';

type Direction = 'down' | 'up' | 'left' | 'right';

export function SpriteAgent({ agent, active, paused, onClick }: {
  agent: AgentConfig;
  active: boolean;
  paused: boolean;
  onClick: () => void;
}) {
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
      interval = setInterval(walk, 3900 + agent.id.length * 130);
    }, 700 + agent.id.length * 180);

    return () => { clearTimeout(start); clearTimeout(rest); clearInterval(interval); };
  }, [agent, paused]);

  const [x, y] = agent.route[stop];
  const style = { left: `${x}%`, top: `${y}%`, '--agent': agent.color, '--sprite': `url(${agent.spriteSheet})` } as CSSProperties;

  return (
    <button className={`agent sprite-agent ${direction} ${moving ? 'moving' : 'resting'} ${active ? 'active' : ''}`} style={style} onClick={onClick} aria-label={`Open ${agent.id}, ${agent.role}`}>
      <span className="bubble">{agent.tasks[stop]}</span>
      <span className="sprite-person" />
      <span className="agent-name">{agent.id}</span>
      <span className="agent-role">{agent.role}</span>
    </button>
  );
}
