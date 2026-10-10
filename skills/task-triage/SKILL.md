---
name: Task Triage
description: Decide what to work on next from the opencode-task-plugin task list. Use when the user asks "what should I work on", "what's next", "what task should I pick", "anything to do", or otherwise wants to choose a task to start or resume.
---

The `opencode-task-plugin` plugin maintains task files under
`~/.opencode/plan/active/TASK-<slug>.md`, a canonical `session-index.json`,
and four tools: `tasks`, `task_new`, `close_task`, `verify`. This skill
orchestrates those tools to pick the next piece of work.

## Workflow

0. **Sync first, then read.** The task tree is a git clone of the bare repo on
   the Windows disk (`opencode-tasks.git`), synced **on
   demand — there is no timer**. Without this step you triage whatever was last
   pulled rather than the current tree:

       bash ~/.opencode/bin/sync-plan.sh

   Exit `0` converged, `1` error, `2` skipped (mid-merge, lock held, or not on
   `main`). A non-zero code is **not** fatal for triage: say the tree may be
   stale, then continue with what is on disk. Never present a stale list as
   current. The script also *commits* local edits, so re-run it after you change
   anything — that is the whole push mechanism, and there is nothing else.

   Solo since 2026-10-08: Fedora WSL is the only live worktree, so this is
   publish-and-pull against a single bare repo on the Windows disk, not
   host-to-host sync. It stays quiet when there is nothing new either way.

   The **mem0** store is a second, separate git repo at `~/.opencode/mem0`,
   converged by `sync-mem0.sh`. It is published by the `session-close` skill, so
   triage does **not** need to touch it — pulling tasks does not pull memories, and that is deliberate.

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
