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
import { sessionDone, verify, listTasks, newTask, rebuildIndex, configureSync } from "./task-manager.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url));
const BUNDLED_SKILLS = join(PACKAGE_ROOT, "skills");
/**
 * OpenCode discovers skills from disk (skills.paths), NOT through the plugin
 * API. So we carry a `skills/` dir in the plugin and copy each SKILL.md into
 * the global `~/.config/opencode/skills/` on load. Idempotent: existing skills
 * are never overwritten, so user-customized or hub-synced skills take precedence.
 */
function installSkills() {
    const target = join(homedir(), ".config", "opencode", "skills");
    if (!existsSync(BUNDLED_SKILLS)) {
        console.log(`opencode-task-plugin: no bundled skills dir at ${BUNDLED_SKILLS}`);
        return;
    }
    mkdirSync(target, { recursive: true });
    let copied = 0;
    let skipped = 0;
    for (const entry of readdirSync(BUNDLED_SKILLS, { withFileTypes: true })) {
        if (!entry.isDirectory())
            continue;
        const source = join(BUNDLED_SKILLS, entry.name, "SKILL.md");
        if (!existsSync(source))
            continue;
        const destDir = join(target, entry.name);
        if (existsSync(join(destDir, "SKILL.md"))) {
            skipped++;
            continue;
        }
        mkdirSync(destDir, { recursive: true });
        copyFileSync(source, join(destDir, "SKILL.md"));
        copied++;
    }
    console.log(`opencode-task-plugin: skills ready (${copied} copied to ${target}, ${skipped} already present, existing never overwritten)`);
}
export default Plugin.define({
    id: "opencode-task-plugin",
    async setup(ctx) {
        // Plan-repo sync is opt-in since 0.1.0. Enable it in object-form config:
        // { "package": "opencode-task-plugin", "options": { "sync": true } }
        const syncEnabled = ctx.options?.sync === true;
        configureSync(syncEnabled);
        console.log(`opencode-task-plugin: plan-repo sync ${syncEnabled ? "ENABLED" : "DISABLED"}` +
            (syncEnabled ? "" : " (default) — enable with options { sync: true }"));
        // Distribute bundled skills into the global skills dir (idempotent).
        installSkills();
        await ctx.tool.transform((editor) => {
            editor.add({
                name: "task",
                description: "List tasks from the session index (session-index.json, populated from active/TASK-*.md), " +
                    "cross-check the active/ directory for unindexed files, " +
                    "and optionally run verify scan for orphans/collisions/ready-to-archive/stale tasks.",
                input: {
                    type: "object",
                    properties: {
                        verify: {
                            type: "boolean",
                            description: "Also run verify scan (orphans, collisions, ready-to-archive, stale in-progress)",
                        },
                    },
                    additionalProperties: false,
                },
                async execute(input) {
                    let output = listTasks();
                    if (input?.verify) {
                        output += "\n\n" + verify();
                    }
                    return { content: output };
                },
            });
            editor.add({
                name: "task_list",
                description: "List tasks from the session index (session-index.json, populated from active/TASK-*.md), " +
                    "cross-check the active/ directory for unindexed files, and optionally run verify scan for orphans/collisions/ready-to-archive/stale tasks.",
                input: {
                    type: "object",
                    properties: {
                        verify: {
                            type: "boolean",
                            description: "Also run verify scan (orphans, collisions, ready-to-archive, stale in-progress)",
                        },
                    },
                    additionalProperties: false,
                },
                async execute(input) {
                    let output = listTasks();
                    if (input?.verify) {
                        output += "\n\n" + verify();
                    }
                    return { content: output };
                },
            });
            editor.add({
                name: "task_new",
                description: "Create a new task: scaffold active/TASK-<slug>.md with a '## To Do' template " +
                    "and register it in session-index.json. Use when the user asks to add a task.",
                input: {
                    type: "object",
                    properties: {
                        name: {
                            type: "string",
                            description: "Human-readable task name; will be slugified into the TASK-<slug>.md filename",
                        },
                        summary: {
                            type: "string",
                            description: "Optional first To Do line / short description",
                        },
                        status: {
                            type: "string",
                            enum: ["pending", "in-progress", "blocked"],
                            description: "Initial status; sets the first checkbox marker ([ ], [~], or [!])",
                        },
                    },
                    required: ["name"],
                    additionalProperties: false,
                },
                async execute(input) {
                    const { name, summary, status } = input;
                    return { content: newTask({ name, summary, status }) };
                },
            });
            editor.add({
                name: "task_close",
                description: "Verify tasks (orphans, collisions, ready-to-archive, stale), then archive all completed tasks " +
                    "(every checkbox in ## To Do is - [x]) by moving them from active/ to archive/ as " +
                    "TASK-<name>_YYYY-MM-DD[-N].md (collision-safe), then rebuild session-index.json, " +
                    "write the raw session report to sessions/YYYY-MM-DD-<slug>.md and append a session-end " +
                    "note to session-handoff.md. Use when the user says 'close task' or 'task done'.",
                input: { type: "object", properties: {}, additionalProperties: false },
                async execute() {
                    const verifyResult = verify();
                    const archiveResult = sessionDone({ verifyText: verifyResult });
                    return { content: verifyResult + "\n\n" + archiveResult };
                },
            });
            editor.add({
                name: "task_verify",
                description: "Scan active task files for orphans (active copy beside an identical archive copy), " +
                    "collisions (different content in archive/), ready-to-archive tasks (all To Do checked but not yet moved), " +
                    "and stale in-progress tasks (not edited in 7+ days).",
                input: { type: "object", properties: {}, additionalProperties: false },
                async execute() {
                    return { content: verify() };
                },
            });
            editor.add({
                name: "session_close",
                description: "Safely close a session: run verify first, abort on orphans/collisions, then archive all " +
                    "completed tasks, rebuild the index, and write a raw session report to " +
                    "sessions/YYYY-MM-DD-<slug>.md (from checked To Do items and each task's verbatim ## Notes), " +
                    "plus a session-end note and report pointer in session-handoff.md. Optional title names the file.",
                input: {
                    type: "object",
                    properties: {
                        title: { type: "string", description: "Optional report title; also the filename slug" },
                    },
                    additionalProperties: false,
                },
                async execute(input) {
                    const { title } = (input ?? {});
                    const v = verify();
                    if (v.includes("ORPHAN") || v.includes("COLLISION")) {
                        return { content: "SESSION CLOSE ABORTED:\n" + v + "\n\nResolve orphans/collisions before closing." };
                    }
                    const r = sessionDone({ title, verifyText: v });
                    return { content: v + "\n\n" + r };
                },
            });
            editor.add({
                name: "task_triage",
                description: "Suggest the next task to work on. Prefers blocked tasks, then oldest in-progress, then oldest pending.",
                input: { type: "object", properties: {}, additionalProperties: false },
                async execute() {
                    const index = listTasks();
                    return { content: "Task triage output:\n" + index };
                },
            });
            editor.add({
                name: "task_claim_audit",
                description: "Audit a task file's completion claims against disk/git/process state. Provide a task name to audit.",
                input: {
                    type: "object",
                    properties: {
                        name: { type: "string", description: "Task filename or slug to audit" }
                    },
                    required: ["name"],
                    additionalProperties: false,
                },
                async execute(input) {
                    const { name } = input;
                    return { content: `Task claim audit not yet implemented for ${name}. Use verify and manual checks.` };
                },
            });
            // Rebuild the index once at plugin load so it reflects the current active/ dir.
            try {
                rebuildIndex();
            }
            catch (e) {
                console.error(`WARN: initial index rebuild failed: ${e.message}`);
            }
        });
    },
});
