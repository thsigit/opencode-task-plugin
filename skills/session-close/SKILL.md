---
name: Session Close
description: Safely end an opencode session by archiving completed tasks and writing a handoff note. Use when the user says "session done", "wrap up", "close out", "end session", or wants to archive finished tasks and leave a handoff. Runs verify then close_task in the correct order.
---

This skill wraps the `opencode-task-plugin` tools `verify` and `close_task`
in the right order so the session-end routine is reliable and doesn't lose or
corrupt task data.

## Workflow

1. **Always run `verify` first.** It reports:
   - orphans (an active copy sitting next to an identical archive copy)
   - collisions (different content in `archive/` for a task)
   - ready-to-archive (all To Do boxes `[x]` but not yet moved)
   - stale in-progress (not edited in 7+ days)

2. **Branch on the verify result:**
   - If it reports **orphans or collisions** → STOP. Tell the user these must be
     resolved manually before archiving (they indicate data inconsistency). Do
     **not** call `close_task`.
   - If it reports **ready-to-archive** tasks and the user wants them archived
     → proceed to step 3.
   - If it reports **clean** (no orphans/collisions) → proceed to step 3.

3. Call **`close_task`**. It:
   - moves every task whose `## To Do` is fully `[x]` from `active/` to
     `archive/TASK-<name>_YYYY-MM-DD[-N].md` (collision-safe),
   - rebuilds `session-index.json`,
   - appends a session-end note to `session-handoff.md`.

4. Report what was archived and where the handoff note landed
   (`~/.opencode/plan/session-handoff.md`).

## Marking work done

`close_task` only archives a task when **every** To Do box is `- [x]`. There
is **no status-update tool**, so before running it, edit the relevant
`TASK-<slug>.md` files to flip their To Do items to `[x]`. Blocked or partial
tasks stay in `active/`.

## Gotcha: only a `## To Do` section counts

The task manager reads checkboxes **only** inside a section literally headed
`## To Do`. A task written with numbered sections (`## 1. …`, `## 2. …`) has
`markers.length === 0`, so `close_task` will never archive it no matter how many
boxes are ticked. Two archived tasks hit exactly this and had to be moved by hand.

When writing a new task, give it a real `## To Do` section. When a "complete" task
refuses to archive, check its heading before anything else.

## Step 5: publish the session (only if syncing is enabled)

If the plugin is configured with `options.sync: true` and the plan tree is a
git clone, `close_task` already committed, pulled and pushed — there is no
separate `git push` to remember.

If syncing is **not** enabled (the default), `close_task` left the session's
work entirely local: archive moves, index rewrite, handoff note. Publishing is
up to you — commit and push the plan directory yourself if it is a git repo,
or back it up however you would. **Report to the user whether the work is
published or still local.** An unpublished edit is the one thing that cannot
come back, so do not end a session silent about it.
