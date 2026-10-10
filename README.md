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
| `close_task` | Runs `verify`, then archives every fully-checked task to `archive/TASK-<name>_YYYY-MM-DD[-N].md`, rebuilds the index, and appends a session-end note to the handoff. |
| `verify` | Reports orphans, collisions, ready-to-archive tasks, and stale in-progress tasks. |

## Why the handoff matters

A bare task list describes intentions, not ground truth — and a list that is
presented without the previous session's handoff is how a stale or retracted
claim gets acted on twice. `tasks` therefore prints a bounded excerpt of
`session-handoff.md` and a pointer, and instructs the agent to read the file
before reporting. The handoff is where corrections, traps and pinned errors
live. (Hardened 2026-10-09 after an agent quoted the pointer to the user
instead of opening the file.)

## Install

Requires **Node.js ≥ 20** and a POSIX shell with `git` available.

**Via npm** — add the package to the `plugin` array in
`~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-task-plugin"]
}
```

**From source** — clone into the plugin directory:

```sh
git clone https://github.com/thsigit/opencode-task-plugin \
  ~/.config/opencode/plugins/opencode-task-plugin
```

Then restart OpenCode. The four tools appear in the tool list.

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
