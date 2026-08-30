'use client';

import { useState } from 'react';
import type { ProjectInspection, ProjectSummary, RuntimeStatus } from '../lib/runtime';
import { runtimeApi } from '../lib/runtime';

/**
 * Points the office at a repository on this machine, the way you would `cd`
 * into it: type a path, let the runtime read what is there, confirm the
 * commands that decide whether work ships.
 */

type Mode = 'path' | 'repo';

const EMPTY = {
  path: '',
  repo: '',
  id: '',
  name: '',
  baseBranch: '',
  source: 'remote' as 'remote' | 'local',
  setup: '',
  verify: '',
  conventions: '',
};

function toLines(commands: string[]): string {
  return commands.join('\n');
}

function fromLines(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

export function ProjectManager({
  status,
  onClose,
  onChanged,
}: {
  status: RuntimeStatus;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>(status.projects);
  const [mode, setMode] = useState<Mode>('path');
  const [form, setForm] = useState(EMPTY);
  const [inspection, setInspection] = useState<ProjectInspection | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'inspect' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);

  function patch(next: Partial<typeof EMPTY>) {
    setForm((current) => ({ ...current, ...next }));
  }

  function reset() {
    setForm(EMPTY);
    setMode('path');
    setInspection(null);
    setEditingId(null);
    setError(null);
  }

  async function detect() {
    setBusy('inspect');
    setError(null);
    try {
      const { inspection: result } = mode === 'repo'
        ? await runtimeApi.inspectRepo(form.repo)
        : await runtimeApi.inspectPath(form.path);
      setInspection(result);
      if (result.problem) {
        setError(result.problem);
        return;
      }
      patch({
        path: mode === 'repo' ? '' : result.path,
        id: form.id || result.suggestedId,
        name: form.name || result.suggestedName,
        baseBranch: form.baseBranch || result.baseBranch || 'main',
        source: mode === 'repo' || result.remoteUrl ? form.source : 'local',
        setup: form.setup || toLines(result.suggestedSetup),
        verify: form.verify || toLines(result.suggestedVerify),
      });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy('save');
    setError(null);
    try {
      const { project } = await runtimeApi.saveProject({
        id: form.id || undefined,
        name: form.name || undefined,
        path: mode === 'repo' ? undefined : form.path,
        repo: mode === 'repo' ? form.repo : undefined,
        baseBranch: form.baseBranch || undefined,
        source: form.source,
        setup: fromLines(form.setup),
        verify: fromLines(form.verify),
        conventions: form.conventions || undefined,
      });
      setProjects((current) => {
        const rest = current.filter((entry) => entry.id !== project.id);
        return [...rest, project];
      });
      reset();
      onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await runtimeApi.removeProject(id);
      setProjects((current) => current.filter((entry) => entry.id !== id));
      if (editingId === id) reset();
      onChanged();
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  function edit(project: ProjectSummary) {
    setEditingId(project.id);
    setInspection(null);
    setError(null);
    setMode(project.path ? 'path' : 'repo');
    setForm({
      path: project.path ?? '',
      repo: project.repo ?? '',
      id: project.id,
      name: project.name,
      baseBranch: project.baseBranch,
      source: project.source,
      setup: toLines(project.setup),
      verify: toLines(project.verify),
      conventions: project.conventions ?? '',
    });
  }

  const target = mode === 'repo' ? form.repo : form.path;
  const canSave = Boolean(target.trim() && fromLines(form.verify).length && busy !== 'save');

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Projects">
      <div className="modal">
        <header>
          <div>
            <small>PROJECTS</small>
            <h2>{editingId ? `Edit ${editingId}` : 'Point the office at a repository'}</h2>
          </div>
          <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="mode-switch">
          <button className={mode === 'path' ? 'on' : ''} onClick={() => setMode('path')}>A PATH ON THIS MACHINE</button>
          <button className={mode === 'repo' ? 'on' : ''} onClick={() => setMode('repo')}>CLONE FROM GITHUB</button>
        </div>

        <div className="modal-body">
          <div className="project-list">
            {projects.length === 0 && (
              <p className="notice">No projects yet. Add the path of a git checkout below.</p>
            )}
            {projects.map((project) => (
              <div className={`project-row ${editingId === project.id ? 'on' : ''}`} key={project.id}>
                <div>
                  <b>{project.name}</b>
                  <code>{project.path ?? project.repo}</code>
                  <i>
                    {project.baseBranch} · clones {project.source === 'local' ? 'your checkout' : 'origin'} ·{' '}
                    {project.verify.join(' && ') || 'no checks'}
                  </i>
                </div>
                <button className="ghost" onClick={() => edit(project)}>EDIT</button>
                <button className="ghost" onClick={() => remove(project.id)}>REMOVE</button>
              </div>
            ))}
          </div>

          <label>
            <span>
              {mode === 'repo' ? <>REPOSITORY URL <i>cloned fresh for every task</i></> : <>PROJECT PATH <i>on the machine running the agents</i></>}
            </span>
            <div className="path-row">
              <input
                value={mode === 'repo' ? form.repo : form.path}
                onChange={(event) =>
                  patch(mode === 'repo' ? { repo: event.target.value } : { path: event.target.value })
                }
                placeholder={mode === 'repo' ? 'https://github.com/you/my-app.git' : '~/code/my-app'}
                spellCheck={false}
              />
              <button className="ghost" onClick={detect} disabled={!target.trim() || busy === 'inspect'}>
                {busy === 'inspect' ? (mode === 'repo' ? 'CLONING…' : 'READING…') : 'DETECT'}
              </button>
            </div>
          </label>

          {inspection && !inspection.problem && (
            <p className="notice">
              {inspection.stack ? `${inspection.stack} · ` : ''}
              branch <code>{inspection.currentBranch ?? inspection.baseBranch}</code> ·{' '}
              {inspection.remoteUrl ? <>remote <code>{inspection.remoteUrl}</code></> : 'no remote — work stays local'}
              {inspection.path ? '' : ' · cloned fresh into a workspace for every task'}
              {inspection.dirty ? ' · uncommitted changes in your working tree are not copied' : ''}
            </p>
          )}

          <div className="field-row">
            <label>
              <span>NAME</span>
              <input value={form.name} onChange={(event) => patch({ name: event.target.value })} placeholder="My App" />
            </label>
            <label>
              <span>BASE BRANCH</span>
              <input value={form.baseBranch} onChange={(event) => patch({ baseBranch: event.target.value })} placeholder="main" />
            </label>
            <label>
              <span>CLONE FROM</span>
              <select
                value={mode === 'repo' ? 'remote' : form.source}
                disabled={mode === 'repo'}
                onChange={(event) => patch({ source: event.target.value as 'remote' | 'local' })}
              >
                <option value="remote">origin — what everyone else sees</option>
                <option value="local">your checkout — includes unpushed commits</option>
              </select>
            </label>
          </div>

          <label>
            <span>SETUP COMMANDS <i>one per line, run once per workspace</i></span>
            <textarea
              rows={2}
              value={form.setup}
              onChange={(event) => patch({ setup: event.target.value })}
              placeholder="npm install --no-audit --no-fund"
              spellCheck={false}
            />
          </label>

          <label>
            <span>VERIFY COMMANDS <i>one per line — nothing ships unless these pass</i></span>
            <textarea
              rows={3}
              value={form.verify}
              onChange={(event) => patch({ verify: event.target.value })}
              placeholder={'npm run lint\nnpm test'}
              spellCheck={false}
            />
          </label>

          <label>
            <span>CONVENTIONS <i>optional — handed to every agent working here</i></span>
            <textarea
              rows={3}
              value={form.conventions}
              onChange={(event) => patch({ conventions: event.target.value })}
              placeholder="TypeScript strict mode. Prefer editing configuration over adding components. No new dependencies without a strong reason."
            />
          </label>

          {error && <p className="notice error">{error}</p>}
        </div>

        <footer>
          {editingId && <button className="ghost" onClick={reset}>NEW PROJECT</button>}
          <button className="ghost" onClick={onClose}>CLOSE</button>
          <button className="primary" disabled={!canSave} onClick={save}>
            {busy === 'save' ? 'SAVING…' : editingId ? 'SAVE CHANGES' : '＋ ADD PROJECT'}
          </button>
        </footer>
      </div>
    </div>
  );
}
