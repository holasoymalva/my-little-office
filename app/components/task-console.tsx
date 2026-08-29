'use client';

import { useEffect, useRef, useState } from 'react';
import type { Task, TaskStep } from '../lib/runtime';
import { STAGE_LABELS, isActive, relativeTime, runtimeApi } from '../lib/runtime';

const KIND_MARK: Record<TaskStep['kind'], string> = {
  stage: '◆',
  tool: '›',
  model: '✎',
  log: '·',
  error: '!',
};

export function TaskConsole({ task, onClose }: { task: Task; onClose: () => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  useEffect(() => {
    const node = streamRef.current;
    if (node && pinnedToBottom.current) node.scrollTop = node.scrollHeight;
  }, [task.steps.length]);

  async function act(action: 'cancel' | 'approve' | 'retry') {
    setBusy(true);
    setActionError(null);
    try {
      if (action === 'cancel') await runtimeApi.cancel(task.id);
      if (action === 'approve') await runtimeApi.approve(task.id);
      if (action === 'retry') await runtimeApi.retry(task.id);
    } catch (cause) {
      setActionError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`Task ${task.title}`}>
      <div className="modal console">
        <header>
          <div>
            <small>
              {task.agentId} · {task.provider} · {task.model}
              {task.source.ref && ` · ${task.source.ref}`}
            </small>
            <h2>{task.title}</h2>
          </div>
          <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className={`stage-strip stage-${task.stage}`}>
          <b>{STAGE_LABELS[task.stage]}</b>
          {task.branch && <span>{task.branch}</span>}
          {task.verifyPassed !== undefined && (
            <span className={task.verifyPassed ? 'ok' : 'bad'}>
              checks {task.verifyPassed ? 'passed' : 'failing'}
            </span>
          )}
          <span>{task.usage.calls} model calls</span>
          <span>{task.usage.inputTokens + task.usage.outputTokens} tokens</span>
        </div>

        <div className="console-body">
          <div
            className="stream"
            ref={streamRef}
            onScroll={(event) => {
              const node = event.currentTarget;
              pinnedToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
            }}
          >
            {task.steps.length === 0 && <p className="notice">Waiting for the agent to start…</p>}
            {task.steps.map((step) => (
              <div key={step.id} className={`step ${step.kind}`}>
                <button
                  onClick={() => setExpanded(expanded === step.id ? null : step.id)}
                  disabled={!step.detail}
                >
                  <i>{KIND_MARK[step.kind]}</i>
                  <span>{step.title}</span>
                  <time>{relativeTime(step.at)}</time>
                </button>
                {expanded === step.id && step.detail && <pre>{step.detail}</pre>}
              </div>
            ))}
          </div>

          <aside className="console-side">
            <h3>BRIEF</h3>
            <p>{task.brief}</p>

            {task.plan && (
              <>
                <h3>PLAN</h3>
                <pre className="soft">{task.plan}</pre>
              </>
            )}

            {task.filesChanged.length > 0 && (
              <>
                <h3>FILES CHANGED ({task.filesChanged.length})</h3>
                <ul>{task.filesChanged.map((file) => <li key={file}>{file}</li>)}</ul>
              </>
            )}

            {task.summary && (
              <>
                <h3>SUMMARY</h3>
                <pre className="soft">{task.summary}</pre>
              </>
            )}

            {task.error && (
              <>
                <h3>PROBLEM</h3>
                <pre className="soft bad">{task.error}</pre>
              </>
            )}
          </aside>
        </div>

        {actionError && <p className="notice error">{actionError}</p>}

        <footer>
          {task.prUrl && (
            <a className="primary" href={task.prUrl} target="_blank" rel="noreferrer">OPEN PULL REQUEST →</a>
          )}
          {task.source.url && (
            <a className="ghost" href={task.source.url} target="_blank" rel="noreferrer">VIEW IN LINEAR</a>
          )}
          {isActive(task) || task.stage === 'queued' ? (
            <button className="ghost" disabled={busy} onClick={() => act('cancel')}>STOP AGENT</button>
          ) : null}
          {task.stage === 'awaiting-approval' && (
            <button className="primary" disabled={busy} onClick={() => act('approve')}>
              APPROVE &amp; OPEN PR
            </button>
          )}
          {(task.stage === 'failed' || task.stage === 'cancelled') && (
            <button className="primary" disabled={busy} onClick={() => act('retry')}>RUN AGAIN</button>
          )}
        </footer>
      </div>
    </div>
  );
}
