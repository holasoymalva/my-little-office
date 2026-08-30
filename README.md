# My Little Office

<img width="1024" height="682" alt="image" src="https://github.com/user-attachments/assets/a8b6142e-998e-491a-8fbe-eaa34ae66e40" />

A pixel-art office where AI agents actually do the work. The dashboard is not a
simulation any more: each character maps to a real coding agent backed by
ChatGPT, Gemini or Grok. You hand one a bug or a feature, and it clones the
repository, writes the change, runs your project's own checks, and opens a pull
request.

## How it is put together

There are two processes, and the split is not cosmetic:

| Piece | Runs on | Job |
| --- | --- | --- |
| **Dashboard** (`app/`) | Next.js on Cloudflare Workers | The office UI. Assign tasks, watch agents work, approve delivery. |
| **Agent runtime** (`agent-runtime/`) | Node on your machine | Clones repos, edits files, runs commands, commits, pushes, opens PRs. |

Cloudflare Workers has no filesystem, no git and no subprocesses, so a real
coding agent cannot live inside it. The runtime does the work; the dashboard
talks to it over HTTP and a server-sent-event stream, and re-renders the office
as each step lands.

```
 dashboard ──POST /api/tasks──▶ runtime ──▶ clone repo into .workspaces/<task>
     ▲                             │        plan → implement (tool loop) → verify
     └──── SSE /api/events ────────┘        → repair → commit → push → gh pr create
                                            └─▶ Linear: comment + move issue
```

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env` with at least one provider key:

| Provider | Key | Where to get it |
| --- | --- | --- |
| ChatGPT | `OPENAI_API_KEY` | platform.openai.com |
| Gemini | `GEMINI_API_KEY` | aistudio.google.com |
| Grok | `XAI_API_KEY` | console.x.ai |

Optionally `LINEAR_API_KEY` (Linear → Settings → Security & access → API keys)
to pull issues straight into the office, and `CHAT_PROVIDER` / `CHAT_MODEL` to
choose which model answers in the office chat.

Then check the wiring before spending any tokens:

```bash
npm run agents:check
```

It validates the config, sends a one-word probe to every configured provider,
confirms git access to each project, checks `gh` auth, and proves the agent
sandbox blocks path escapes and denied commands.

## Run it

Two terminals:

```bash
npm run agents
```

```bash
npm run dev
```

Open `http://localhost:3000`. If the office says **RUNTIME OFFLINE**, the first
command is not running.

## Configure your projects and agents

Everything the agents need lives in [`super-agent.config.json`](super-agent.config.json).

**Projects** are the repositories agents may work on. The quickest way to add
one is from the dashboard: open **PROJECTS → MANAGE** and either

- **A PATH ON THIS MACHINE** — type the path of a git checkout on the machine
  running the runtime (`~/code/my-app` works), or
- **CLONE FROM GITHUB** — paste a clone URL for a repository that is not here
  yet,

then hit **DETECT**. The runtime reads the project — cloning a shallow throwaway
copy for a URL — and fills in the remote, the default branch, the install
command and the checks it can find, for Node, Python, Go, Rust, Make, Swift
packages and Xcode projects. All you do is confirm them. Saving writes the
project into `super-agent.config.json`, so the file stays the single source of
truth and you can still edit it by hand:

```jsonc
{
  "id": "web-app",
  "name": "Web App",
  "path": "~/code/web-app",                      // or "repo": "https://github.com/you/web-app.git"
  "baseBranch": "main",
  "source": "remote",                            // "local" clones your checkout instead of origin
  "setup": ["npm install --no-audit --no-fund"], // run once per workspace
  "verify": ["npm run lint", "npm test"],        // the definition of "it works"
  "conventions": "Guidance handed to the agent for this codebase."
}
```

`verify` is the gate: a task is **never** delivered on a failing check. If a
check fails, the agent gets the output and up to two repair attempts before the
task is marked failed.

If you give a project a `path`, the runtime reads that checkout's `origin` and
clones *from the remote* — your working tree is never touched. Set
`"source": "local"` to clone the checkout itself instead, which is what you want
while you are iterating locally: commits you have not pushed yet are part of what
the agent works on. Either way the pull request still targets the real remote,
and uncommitted changes in your working tree are never copied.

**Agents** map the office characters onto models and personalities:

```jsonc
{
  "id": "DEV",              // must match an agent id in app/office.config.ts
  "role": "Software Engineer",
  "provider": "openai",     // openai | gemini | xai
  "specialty": "You implement features and fix bugs…",
  "maxIterations": 40       // tool-loop budget before the agent is stopped
}
```

You can override the provider per task from the composer, so the same character
can run on Grok today and Gemini tomorrow.

### Xcode and iOS projects

An Xcode project is detected like any other, and the suggested check is a real
build:

```
xcodebuild -project MyApp.xcodeproj -scheme "MyApp" \
  -destination 'generic/platform=iOS Simulator' -configuration Debug \
  CODE_SIGNING_ALLOWED=NO build
```

`xcodebuild` needs a full Xcode rather than the command line tools. If
`xcode-select -p` points at `/Library/Developer/CommandLineTools`, the suggested
command carries `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`
itself, which works without `sudo`. Xcode builds are also slow, so raise
`commandTimeoutMs` in the config — 900000 (15 minutes) is a sane floor for a
cold build.

## Talking to the office

**CHAT WITH THE TEAM** opens a conversation with the office manager. Describe
work the way you would in Slack and it picks the teammate whose skills fit,
writes the brief and dispatches the task — the same task the composer would have
created, visible on the board straight away:

> **you** — el checkout revienta cuando el carrito está vacío, que alguien lo vea
>
> **manager** — Se lo asigné a TESS: reproduce el caso del carrito vacío, añade el
> test y arregla la causa. → *TESS · Fix empty-cart checkout crash · Planning*

It can also register a project for you — from a path (*"add the project at
~/code/my-app"*) or from a URL (*"clone github.com/me/my-app and add it"*) —
tell you what the board is doing, and cancel a task. When a request is too vague
to implement it asks one question instead of guessing.

The chat runs on the first provider with a key, in the order ChatGPT → Grok →
Gemini. Pin it with `CHAT_PROVIDER=gemini` and `CHAT_MODEL=...` in `.env`.

## What an agent can and cannot do

Each task gets its own throwaway clone under `.workspaces/<task-id>`. Inside it
the agent can list, read, write and edit files, search, run allowlisted commands
and read its own diff. It cannot:

- touch anything outside the workspace (path escapes are rejected),
- run a command that is not in `allowedCommands`, or that matches
  `deniedPatterns` — `curl`, `wget`, `ssh`, `sudo`, `npm publish` and `git push`
  are blocked by default,
- push or publish anything. Committing, pushing and opening the pull request
  happen in the pipeline *after* the agent finishes and the checks pass.

Both lists live in `super-agent.config.json`. Widen them deliberately.

## Continuous delivery

With **auto-deliver** on (the default), a task that passes `verify` goes
straight to a commit, a pushed `agent/<slug>` branch and a pull request via the
GitHub CLI — your existing CI then runs on the PR like any other.

Turn auto-deliver off in the composer and the task parks at
**awaiting approval** instead: you read the diff, the summary and the check
output in the console, then hit *Approve & open PR*.

For Linear-sourced tasks the runtime also comments on the issue when work
starts and when it lands, and moves the issue to *In Progress* and then to the
state named in `linear.doneStateName`.

## Deploying the dashboard

`npm run build` and deploy as before. The published page still needs a runtime
to talk to: point it at one with `NEXT_PUBLIC_AGENT_API` (inlined at build
time). A browser on `https://` cannot reach `http://localhost:8787`, so a
deployed dashboard needs the runtime exposed over HTTPS — a tunnel or a small
VM. Without that, run both locally.

## Customising the office itself

The visual layer is still data-driven from
[`app/office.config.ts`](app/office.config.ts): brand, theme, zones, sprites and
the routes characters walk. Agent ids there are what tie a character to a
runtime agent profile.

## Assets

Character sprites come from the MetroCity Character Pack by JIK-A-4 under CC0 1.0.
See `public/assets/metrocity/LICENSE.txt`.
