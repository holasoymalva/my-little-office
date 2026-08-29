'use client';

import { useEffect, useState } from 'react';
import type { LinearIssue, ProviderId, RuntimeStatus } from '../lib/runtime';
import { runtimeApi } from '../lib/runtime';

type Mode = 'brief' | 'linear';

export function TaskComposer({
  status,
  defaultAgentId,
  onClose,
  onCreated,
}: {
  status: RuntimeStatus;
  defaultAgentId: string;
  onClose: () => void;
  onCreated: (taskId: string) => void;
}) {
  const readyAgents = status.agents.filter((agent) => agent.ready);
  const fallbackAgent = readyAgents[0]?.id ?? status.agents[0]?.id ?? '';

  const [mode, setMode] = useState<Mode>('brief');
  const [agentId, setAgentId] = useState(
    status.agents.some((agent) => agent.id === defaultAgentId && agent.ready) ? defaultAgentId : fallbackAgent,
  );
  const [projectId, setProjectId] = useState(status.projects[0]?.id ?? '');
  const [provider, setProvider] = useState<ProviderId | ''>('');
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [autoDeliver, setAutoDeliver] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [issues, setIssues] = useState<LinearIssue[]>([]);
  const [issuesError, setIssuesError] = useState<string | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<string>('');

  useEffect(() => {
    if (mode !== 'linear' || !status.integrations.linear) return;
    runtimeApi
      .linearIssues()
      .then((result) => {
        setIssues(result.issues);
        setIssuesError(null);
      })
      .catch((cause: Error) => setIssuesError(cause.message));
  }, [mode, status.integrations.linear]);

  const agent = status.agents.find((entry) => entry.id === agentId);
  const effectiveProvider = provider || agent?.provider;
  const providerReady = status.providers.find((entry) => entry.id === effectiveProvider)?.configured ?? false;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const shared = {
        agentId,
        projectId,
        provider: provider || undefined,
        autoDeliver,
      };
      const result = mode === 'linear'
        ? await runtimeApi.assignLinear({ ...shared, identifier: selectedIssue })
        : await runtimeApi.createTask({ ...shared, title: title.trim() || undefined, brief: brief.trim() });
      onCreated(result.task.id);
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = Boolean(
    agentId && projectId && providerReady && !busy &&
    (mode === 'linear' ? selectedIssue : brief.trim().length > 8),
  );

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Assign a task">
      <div className="modal">
        <header>
          <div>
            <small>ASSIGN WORK</small>
            <h2>Hand a task to an agent</h2>
          </div>
          <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="mode-switch">
          <button className={mode === 'brief' ? 'on' : ''} onClick={() => setMode('brief')}>WRITE A BRIEF</button>
          <button className={mode === 'linear' ? 'on' : ''} onClick={() => setMode('linear')}>FROM LINEAR</button>
        </div>

        <div className="modal-body">
          {mode === 'brief' ? (
            <>
              <label>
                <span>TITLE <i>optional</i></span>
                <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Fix the flaky checkout test" />
              </label>
              <label>
                <span>WHAT NEEDS TO HAPPEN</span>
                <textarea
                  rows={7}
                  value={brief}
                  onChange={(event) => setBrief(event.target.value)}
                  placeholder={'Describe the bug or feature the way you would to a teammate.\n\nInclude how to reproduce it, which part of the product it affects, and what "done" looks like.'}
                />
              </label>
            </>
          ) : !status.integrations.linear ? (
            <p className="notice">Set <code>LINEAR_API_KEY</code> in <code>.env</code> and restart the runtime to pull issues.</p>
          ) : issuesError ? (
            <p className="notice error">{issuesError}</p>
          ) : (
            <div className="issue-list">
              {issues.length === 0 && <p className="notice">No open issues found.</p>}
              {issues.map((issue) => (
                <button
                  key={issue.id}
                  className={`issue ${selectedIssue === issue.identifier ? 'on' : ''}`}
                  onClick={() => setSelectedIssue(issue.identifier)}
                >
                  <b>{issue.identifier}</b>
                  <span>{issue.title}</span>
                  <i>{issue.stateName}</i>
                </button>
              ))}
            </div>
          )}

          <div className="field-row">
            <label>
              <span>PROJECT</span>
              <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                {status.projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>AGENT</span>
              <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                {status.agents.map((entry) => (
                  <option key={entry.id} value={entry.id} disabled={!entry.ready}>
                    {entry.id} — {entry.role}{entry.ready ? '' : ' (no API key)'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>MODEL PROVIDER</span>
              <select value={provider} onChange={(event) => setProvider(event.target.value as ProviderId | '')}>
                <option value="">Agent default{agent ? ` (${agent.provider})` : ''}</option>
                {status.providers.map((entry) => (
                  <option key={entry.id} value={entry.id} disabled={!entry.configured}>
                    {entry.label}{entry.configured ? '' : ' — key missing'}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="checkbox">
            <input type="checkbox" checked={autoDeliver} onChange={(event) => setAutoDeliver(event.target.checked)} />
            <span>
              Open the pull request automatically once the project&apos;s checks pass.
              <i>Uncheck to review the diff and approve delivery yourself.</i>
            </span>
          </label>

          {!providerReady && effectiveProvider && (
            <p className="notice error">
              This agent&apos;s provider has no API key. Add{' '}
              <code>{status.providers.find((entry) => entry.id === effectiveProvider)?.envVar}</code> to <code>.env</code>.
            </p>
          )}
          {error && <p className="notice error">{error}</p>}
        </div>

        <footer>
          <button className="ghost" onClick={onClose}>CANCEL</button>
          <button className="primary" disabled={!canSubmit} onClick={submit}>
            {busy ? 'DISPATCHING…' : '▶ START WORKING'}
          </button>
        </footer>
      </div>
    </div>
  );
}
