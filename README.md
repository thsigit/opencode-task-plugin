# OpenCode Task Plugin

**Plan → task → todos, as files you own.**

`opencode-task-plugin` gives an [OpenCode](https://opencode.ai) agent a small,
durable planning layer: active tasks as plain markdown under
`~/.opencode/plan/active/`, a canonical index, a session handoff, and four
tools that keep them honest. 

The mental model: plan → task → todos

- **plan** — the store, `~/.opencode/plan/`.
- **task** — one file, `active/TASK-<slug>.md`, with a title, a `## To Do`, and an optional raw `## Notes`.
- **todos** — checkboxes inside that task:
  `[ ]` pending, `[~]` in-progress, `[x]` done, `[!]` blocked.

A task is *done* only when every box under `## To Do` is `[x]`. There is no
status tool: you change state by editing the markdown.

`## Notes` is free-form and raw: walls hit, paths ruled out, commands that were
verified. It is never parsed or summarised — at close it is copied verbatim
into the session report.

## Why `plan/` and `TASK-*.md`?

The product name is **OpenCode Task Plugin**; the vocabulary underneath is deliberately `task`. The name is a fossil, kept on purpose. OpenCode V2 hard-coded `~/.opencode/plan` and the store moved from `~/.opencode/task/` to `~/.opencode/plan/` during the OpenCode V1 -> V2 migration. The task files keep the `TASK-` prefix. Migrating one thing at a time —first the directory, then (never) the filenames — left the layered result: **plan** is the directory, **task** is the file. Both words are real and the split tells you which layer you are looking at, so it was left alone.

## Tools

| Tool          | What it does                                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tasks`       | Lists tasks from `session-index.json`, cross-checks `active/` for unindexed files, and prefixes the current session handoff so you read it before acting. Optional `verify: true` appends a full scan. |
| `task_new`    | Scaffolds `active/TASK-<slug>.md` with a `## To Do` heading and registers it in the index.                                                                                                             |
| `task_close`  | Runs `task_verify`, then archives every fully-checked task to `archive/TASK-<name>_YYYY-MM-DD[-N].md`, rebuilds the index, writes the raw session report, and appends a session-end note + report pointer to the handoff. |
| `task_verify` | Reports orphans, collisions, ready-to-archive tasks, and stale in-progress tasks.                                                                                                                      |

## Why the handoff matters

A bare task list describes intentions, not ground truth — and a list that is
presented without the previous session's handoff is how a stale or retracted
claim gets acted on twice. `task` therefore prints a bounded excerpt of
`session-handoff.md` and a pointer, and instructs the agent to read the file
before reporting. The handoff is where corrections, traps and pinned errors
live. 

## How to install this plugin

`opencode-task-plugin` auto-discovers from the `plugins/` directory — no `opencode.json` registration is required.

### Quick install (recommended)

```sh
# Clone fresh from GitHub
git clone https://github.com/thsigit/opencode-task-plugin \
  ~/.config/opencode/plugins/opencode-task-plugin
```

### Verify installation

Start OpenCode and confirm the tools appear:

```bash
opencode task_new "My test task"
opencode task_verify    # Scans for orphans/collisions/stale tasks
opencode task_close     # Verifies then archives completed tasks
opencode session_close  # Closes session safely
```

### No `opencode.json` entry needed

Unlike many plugins, `opencode-task-plugin` loads from the `plugins/` directory alone. Adding `"plugin": ["opencode-task-plugin"]` to `~/.config/opencode/opencode.json` is optional and only required if you want to explicit-register it (evidence shows it loads without it on debianWSL).

### Build from source (if needed)

```sh
cd ~/.config/opencode/plugins/opencode-task-plugin
npm ci              # install dependencies
npm run build       # tsc -> dist/
```

The `dist/` directory is committed, so a build step is usually unnecessary — the plugin bundles itself.

## Layout

```
~/.opencode/plan/
├── active/              # TASK-<slug>.md — the work
├── archive/             # TASK-<slug>_YYYY-MM-DD[-N].md — finished work
├── sessions/            # YYYY-MM-DD-<slug>.md — raw session reports
├── session-index.json   # canonical index, rebuilt from active/ (host-local)
└── session-handoff.md   # durable narrative written by close_task
```

## Session reports

Closing a session writes `sessions/YYYY-MM-DD-<slug>.md` — the raw record,
derived entirely from files, with no generated prose:

```
---
date: 2026-10-24
status: closed
scope: "/path/to/work/repo"     # cwd at close, or its git toplevel
commit: "4adf5a8"               # when the cwd is a git tree
tasks: ["TASK-<slug>.md"]
archived: ["TASK-<slug>_2026-10-24.md"]
---
## Closed      checked To Do lines, per task
## Notes       ## Notes blocks, verbatim
## Open        still-active tasks with their status
## Verify      verbatim task_verify output
```

Rules:

- **One producer.** `task_close` / `session_close` write the report; there is
  no separate report tool. On-demand, polished reports belong to another
  skill that reads `sessions/` and `archive/`.
- **Never rewritten.** Same-day collisions get `-2`, `-3`; a second close on
  the same day produces a second report.
- **Nothing to record → no file.** If no task was archived, no report is
  written; the handoff note is still appended.
- **Always visible.** `task` / `task_list` excerpt the latest report and
  point at the file, the same way they do for the handoff — otherwise
  reports accrete unread.

## Sync (disabled by default)

The plugin can keep the plan tree in sync with a git remote, but **from 0.1.0
this is opt-in**. A public install never commits or pushes on its own. Enable
it in object-form config if your plan tree is a git clone and you want it:

```json
{
  "plugin": [
    {
      "package": "opencode-task-plugin",
      "options": { "sync": true }
    }
  ]
}
```

With `sync: true` the plugin pulls (fast-forward only) before reading in
`tasks`, and commits + pulls + pushes after `close_task`. Sync failures are
warnings, never blockers.

## Development

```sh
npm ci
npm run build     # tsc -> dist/
```

`dist/` is committed so a source clone works without a build step.

## License

[MIT](./LICENSE)
