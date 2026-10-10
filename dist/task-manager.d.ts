/**
 * Core logic for opencode-task-plugin plugin.
 *
 * Finetuned conventions:
 *  - Active tasks live in <BASE>/active/ with a `TASK-` prefix: active/TASK-<name>.md
 *  - Completed tasks are moved to <BASE>/archive/ as TASK-<name>_YYYY-MM-DD[-N].md
 *  - The handoff prose lives in <BASE>/session-handoff.md (no embedded JSON)
 *  - The canonical task index is <BASE>/session-index.json (atomic tmp+rename)
 *  - To Do checkbox markers:
 *      [ ]  pending
 *      [~]  in-progress
 *      [x]  completed   (all boxes [x] => task is archived by `session is done`)
 *      [!]  blocked
 */
/**
 * Pull the latest task changes from the remote.
 * Called by `listTasks()` so a new session always sees the current task list.
 * Non-fatal: returns a warning string on failure, empty string on success.
 */
export declare function pullTasks(): string;
/**
 * Commit, pull, and push task changes to the remote.
 * Called by `sessionDone()` so closing a session publishes its work.
 * Non-fatal: returns a warning string on failure, empty string on success.
 */
export declare function pushTasks(): string;
interface IndexEntry {
    file: string;
    status: string;
    summary: string;
    created: string;
    updated: string;
}
/** Rebuild the entire index from the active/ directory (canonical source). */
export declare function rebuildIndex(): IndexEntry[];
export declare function sessionDone(): string;
export declare function newTask(input: {
    name: string;
    summary?: string;
    status?: string;
}): string;
export declare function verify(): string;
export declare function listTasks(): string;
export {};
