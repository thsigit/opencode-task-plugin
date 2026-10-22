# OpenCode Plan Manager

**Plan → task → todos, as files you own.**

`opencode-task-plugin` gives an [OpenCode](https://opencode.ai) agent a small,
durable planning layer: active tasks as plain markdown under
`~/.opencode/plan/active/`, a canonical index, a session handoff, and four
tools that keep them honest.

> Package, plugin id and directory are all `opencode-task-plugin`. The product
> name is **OpenCode Plan Manager**; the vocabulary underneath is deliberately
> `task` (see *Why `plan/` and `TASK-*.md`?*).

## The mental model: plan → task → todos

- **plan** — the store, `~/.opencode/plan/`.
- **task** — one file, `active/TASK-<slug>.md`, with a title and a `## To Do`.
- **todos** — checkboxes inside that task:
  `[ ]` pending, `[~]` in-progress, `[x]` done, `[!]` blocked.

A task is *done* only when every box under `## To Do` is `[x]`. There is no
status tool: you change state by editing the markdown.

## Why `plan/` and `TASK-*.md`?

The name is a fossil, kept on purpose. The store moved from
`~/.opencode/task/` to `~/.opencode/plan/` during the OpenCode V2 era, and the
task files already carried a `TASK-` prefix. Migrating one thing at a time —
first the directory, then (never) the filenames — left the layered result:
**plan** is the directory, **task** is the file. Both words are real and the
split tells you which layer you are looking at, so it was left alone.

## Tools

| Tool | What it does |
| --- | --- |
| `tasks` | Lists tasks from `session-index.json`, cross-checks `active/` for unindexed files, and prefixes the current session handoff so you read it before acting. Optional `verify: true` appends a full scan. |
| `task_new` | Scaffolds `active/TASK-<slug>.md` with a `## To Do` heading and registers it in the index. |
| `task_close` | Runs `task_verify`, then archives every fully-checked task to `archive/TASK-<name>_YYYY-MM-DD[-N].md`, rebuilds the index, and appends a session-end note to the handoff. |
| `task_verify` | Reports orphans, collisions, ready-to-archive tasks, and stale in-progress tasks. |

## Why the handoff matters

A bare task list describes intentions, not ground truth — and a list that is
presented without the previous session's handoff is how a stale or retracted
claim gets acted on twice. `tasks` therefore prints a bounded excerpt of
`session-handoff.md` and a pointer, and instructs the agent to read the file
before reporting. The handoff is where corrections, traps and pinned errors
live. (Hardened 2026-10-09 after an agent quoted the pointer to the user
instead of opening the file.)

## How to install this plugin

`opencode-task-plugin` auto-discovers from the `plugins/` directory — no `opencode.json` registration is required.

### Quick install (recommended)

```sh
# From a host where the plugin is already built (e.g., fedoraWSL)
rsync -a opencode-task-plugin /home/sigit/.config/opencode/plugins/

# Or clone fresh from GitHub
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
cd /home/sigit/.config/opencode/plugins/opencode-task-plugin
npm ci              # install dependencies
npm run build       # tsc -> dist/
```

The `dist/` directory is committed, so a build step is usually unnecessary — the plugin bundles itself.

## Layout

```
~/.opencode/plan/
├── active/              # TASK-<slug>.md — the work
├── archive/             # TASK-<slug>_YYYY-MM-DD[-N].md — finished work
├── session-index.json   # canonical index, rebuilt from active/ (host-local)
└── session-handoff.md   # durable narrative written by close_task
```

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

## Bundled skills

The package carries two skills (`session-close`, `task-triage`) under `skills/`.
On load they are copied into `~/.config/opencode/skills/`, **once**: an existing
skill is never overwritten, so your edited or hub-synced copy always wins.

## Development

```sh
npm ci
npm run build     # tsc -> dist/
```

`dist/` is committed so a source clone works without a build step.

## License

[MIT](./LICENSE)
