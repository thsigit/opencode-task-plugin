---
name: Task Triage
description: Decide what to work on next from the opencode-task-plugin task list. Use when the user asks "what should I work on", "what's next", "what task should I pick", "anything to do", or otherwise wants to choose a task to start or resume.
---

The `opencode-task-plugin` plugin maintains task files under
`~/.opencode/plan/active/TASK-<slug>.md`, a canonical `session-index.json`,
and four tools: `tasks`, `task_new`, `close_task`, `verify`. This skill
orchestrates those tools to pick the next piece of work.

## Workflow

0. **Read the live tree.** Tasks live under `~/.opencode/plan/`. Plan-repo
   syncing is **opt-in** (plugin option `sync: true`) and, when enabled, the
   plugin has already pulled the latest changes by the time `tasks` runs — so
   you can read the tree as current without a separate step. When syncing is
   **not** configured (the default), read what is on disk and treat it as
   current. Never present a stale list as current: if you do not know whether
   the tree came from a remote, say so.

1. Call the **`tasks`** tool (optionally with `verify: true`) to pull the current
   index. Each line shows a status marker and an `updated` date:
   - `[ ]` pending
   - `[~]` in-progress
   - `[x]` done (already archived or ready to archive)
   - `[!]` blocked

   `session-index.json` is host-local and untracked, rebuilt by the plugin from
   `active/`. The `updated` date is that file's mtime **on this host**, so after a
   pull it reads as the pull time until you actually edit the task. Do not read
   "recently updated" as "recently worked on".

2. **Surface blocked first.** If any task is `[!]`, list it and ask the user how
   to unblock before suggesting anything else. Never silently route around a
   blocked task.

3. **Pick the best candidate** using these rules, in order:
   - Prefer `[~]` in-progress tasks with the **oldest** `updated` date (you're
     mid-way; the stalest one is likely stuck and worth finishing).
   - Otherwise prefer `[ ]` pending tasks with the **oldest** `updated` date
     (longest waiting).
   - Never suggest an `[x]` task.

4. Present 1–3 candidates with their status and *why* you picked them (e.g.
   "oldest in-progress, stale 5 days"). Then either:
   - Ask the user which to start, or
   - If the user said "just pick", start the top candidate.

## Starting / resuming a task

- To start **new** work, use `task_new` (it scaffolds the file + index entry).
- To **resume** existing work, just begin — and flip the task's marker to
  `[~]` by editing its `TASK-<slug>.md` To Do header line. There is **no
  status-update tool**; status changes are made by editing the markdown marker
  directly.
- When finished, mark every box in `## To Do` as `- [x]` so `close_task`
  (or `verify`) will see it as ready to archive.
