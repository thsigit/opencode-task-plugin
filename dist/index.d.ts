/**
 * opencode-task-plugin plugin (OpenCode V2 API)
 *
 * Exposes tools:
 *  - tasks:       list active plans from session-index.json, cross-check active/ for unindexed files
 *  - task_new:    scaffold a new active/TASK-<name>.md with a To Do template and register it in the index
 *  - close_task: archive completed plans, regenerate index, append a session-end note to the handoff
 *  - verify:      report orphans, collisions, ready-to-archive, and stale in-progress plans
 */
import { Plugin } from "@opencode/plugin";
declare const _default: Plugin.Plugin;
export default _default;
