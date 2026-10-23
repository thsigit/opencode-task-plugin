/**
 * opencode-task-plugin plugin (OpenCode V2 API)
 *
 * Exposes tools:
 *  - task:         list active plans from session-index.json, cross-check active/ for unindexed files
 *  - task_new:     scaffold a new active/TASK-<name>.md with a To Do template and register it in the index
 *  - close_task:   archive completed plans, regenerate index, write the raw session report
 *  - verify:       report orphans, collisions, ready-to-archive, and stale in-progress plans
 *  - session_close: safely close a session: verify, archive, write the raw session report
 *  - task_triage:  suggest next task to work on based on status and staleness
 *  - task_claim_audit: audit task claims against disk/git/process state
 */
import { Plugin } from "@opencode/plugin";
declare const _default: Plugin.Plugin;
export default _default;
