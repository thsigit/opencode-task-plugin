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

## Step 5: publish the session

The task tree is a git clone of the bare repo on the Windows disk. **Publishing is on demand -
there is no timer.** Nothing will push for you, so this step is what publishes
the session:

    bash ~/.opencode/bin/sync-plan.sh

Run it **after** `close_task`, since archiving is what changes the tree. It
auto-commits local edits, fast-forwards from origin, and pushes - so it is both
the publish and the converge step; there is no separate `git push` to remember.

Exit `0` converged, `1` error, `2` skipped (mid-merge, lock held, or not on
`main`). **Report a non-zero code to the user** - the session's work is still
local, which means it is not on the bare repo: a Fedora WSL reset re-clones from
`opencode-tasks.git`, and an unpublished edit is the one thing that cannot come
back. `1` on a rebase conflict means two clones edited the same task file -
restore/recovery territory since 2026-10-08, when Fedora became the only live
worktree - and the script aborts rather than guess, which is the right call. The
run log is `~/.opencode/plan/.git/sync-state.log`.

Publishing lands on the bare repo on the Windows disk and stops there: the
off-disk third copy at `homelab:/srv/repo/opencode-v2/tasks.git` is refreshed by
a different command with a different job, `scripts/mirror-umbrella.sh`. Solo
since 2026-10-08, "sync" here means publish-and-pull against that one bare repo,
not fan-out to other machines.

### Also publish mem0

The mem0 store is a second git repo, and memories saved this session
are the other thing worth keeping:

    bash ~/.opencode/bin/sync-mem0.sh

This matters more than it looks: `mem0-local.py add` writes a file and stops, so
without this step every memory saved in this session is local-only and never
reaches the bare repo.

Run it too, but **do not let it block the close**. A mem0 sync failure is worth
one line in the handoff note, never a reason to stall the session.

Layout: `~/.opencode/mem0` is the working clone of `opencode-mem0.git`.
