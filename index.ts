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
import { sessionDone, verify, listTasks, newTask, rebuildIndex } from "./task-manager.js";
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
    if (!entry.isDirectory()) continue;
    const source = join(BUNDLED_SKILLS, entry.name, "SKILL.md");
    if (!existsSync(source)) continue;
    const destDir = join(target, entry.name);
    if (existsSync(join(destDir, "SKILL.md"))) {
      skipped++;
      continue;
    }
    mkdirSync(destDir, { recursive: true });
    copyFileSync(source, join(destDir, "SKILL.md"));
    copied++;
  }
  console.log(
    `opencode-task-plugin: skills ready (${copied} copied to ${target}, ${skipped} already present, existing never overwritten)`,
  );
}

export default Plugin.define({
  id: "opencode-task-plugin",
  async setup(ctx) {
    // Distribute bundled skills into the global skills dir (idempotent).
    installSkills();

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "tasks",
        description:
          "List tasks from the session index (session-index.json, populated from active/TASK-*.md), " +
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
          if ((input as { verify?: boolean })?.verify) {
            output += "\n\n" + verify();
          }
          return { content: output };
        },
      });

      editor.add({
        name: "task_new",
        description:
          "Create a new task: scaffold active/TASK-<slug>.md with a '## To Do' template " +
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
          const { name, summary, status } = input as { name: string; summary?: string; status?: string };
          return { content: newTask({ name, summary, status }) };
        },
      });

      editor.add({
        name: "close_task",
        description:
          "Verify tasks (orphans, collisions, ready-to-archive, stale), then archive all completed tasks " +
          "(every checkbox in ## To Do is - [x]) by moving them from active/ to archive/ as " +
          "TASK-<name>_YYYY-MM-DD[-N].md (collision-safe), then rebuild session-index.json and " +
          "append a session-end note to session-handoff.md. " +
          "Use when the user says 'close task' or 'task done'.",
        input: { type: "object", properties: {}, additionalProperties: false },
        async execute() {
          const verifyResult = verify();
          const archiveResult = sessionDone();
          return { content: verifyResult + "\n\n" + archiveResult };
        },
      });

      editor.add({
        name: "verify",
        description:
          "Scan active task files for orphans (active copy beside an identical archive copy), " +
          "collisions (different content in archive/), ready-to-archive tasks (all To Do checked but not yet moved), " +
          "and stale in-progress tasks (not edited in 7+ days).",
        input: { type: "object", properties: {}, additionalProperties: false },
        async execute() {
          return { content: verify() };
        },
      });

      // Rebuild the index once at plugin load so it reflects the current active/ dir.
      try {
        rebuildIndex();
      } catch (e) {
        console.error(`WARN: initial index rebuild failed: ${(e as Error).message}`);
      }
    });
  },
});
