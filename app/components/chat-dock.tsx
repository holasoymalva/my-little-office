'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChatTurn, RuntimeStatus, Task } from '../lib/runtime';
import { STAGE_LABELS, relativeTime, runtimeApi } from '../lib/runtime';

/**
 * Talk to the office in plain language. The manager on the other side picks a
 * teammate, writes the brief and dispatches the task, so the tasks it creates
 * are the same tasks the composer would have made.
 */
export function ChatDock({
  status,
  chat,
  tasks,
  onClose,
  onOpenTask,
  onChanged,
}: {
  status: RuntimeStatus;
  chat: ChatTurn[];
  tasks: Task[];
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight });
  }, [chat.length, busy]);

  async function send() {
    const message = draft.trim();
    if (!message || busy) return;
    setDraft('');
    setBusy(true);
    setError(null);
    try {
      await runtimeApi.chat(message);
      onChanged();
    } catch (cause) {
      setError((cause as Error).message);
      setDraft(message);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    try {
      await runtimeApi.resetChat();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Office chat">
      <div className="modal chat">
        <header>
          <div>
            <small>OFFICE CHAT</small>
            <h2>Tell the team what you need</h2>
          </div>
          <div className="chat-head-actions">
            {chat.length > 0 && <button className="ghost" onClick={reset}>CLEAR</button>}
            <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </header>

        {!status.chat.ready && <p className="notice error chat-notice">{status.chat.hint}</p>}

        <div className="chat-stream" ref={streamRef}>
          {chat.length === 0 && (
            <p className="empty-hint">
              Describe a bug or a feature and the manager assigns it. It can also register a repository
              for you — try <b>&ldquo;add the project at ~/code/my-app&rdquo;</b>.
            </p>
          )}
          {chat.map((turn) => (
            <div key={turn.id} className={`chat-turn ${turn.role}${turn.error ? ' bad' : ''}`}>
              <b>{turn.role === 'user' ? 'YOU' : 'MANAGER'}<time>{relativeTime(turn.at)}</time></b>
              <p>{turn.content}</p>
              {turn.taskIds?.map((taskId) => {
                const task = tasks.find((entry) => entry.id === taskId);
                return (
                  <button key={taskId} className="chat-task" onClick={() => onOpenTask(taskId)}>
                    <span>{task?.agentId ?? 'TASK'}</span>
                    {task ? `${task.title} — ${STAGE_LABELS[task.stage]}` : 'Open task'}
                  </button>
                );
              })}
            </div>
          ))}
          {busy && <div className="chat-turn assistant pending"><b>MANAGER</b><p>Thinking…</p></div>}
        </div>

        {error && <p className="notice error chat-notice">{error}</p>}

        <footer className="chat-footer">
          <textarea
            rows={2}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder={
              status.chat.ready
                ? 'The checkout page throws on an empty cart — get someone on it.'
                : 'Add a provider API key to .env to use the chat.'
            }
            disabled={!status.chat.ready || busy}
          />
          <button className="primary" onClick={send} disabled={!status.chat.ready || busy || !draft.trim()}>
            {busy ? 'SENDING…' : 'SEND ⏎'}
          </button>
        </footer>
      </div>
    </div>
  );
}
