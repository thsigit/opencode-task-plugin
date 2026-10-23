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

import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";

// ── Paths ────────────────────────────────────────────────────────────────

const HOME = (await import("os")).homedir();
const BASE = path.join(HOME, ".opencode", "plan");
const ACTIVE = path.join(BASE, "active");
const ARCHIVE = path.join(BASE, "archive");
const SESSIONS = path.join(BASE, "sessions");
const HANDOFF = path.join(BASE, "session-handoff.md");
const INDEX = path.join(BASE, "session-index.json");

// Tasks whose last edit is older than this many days and are still in-progress
// are flagged by `verify` as stale.
const STALE_DAYS = 7;

// ── Prefixes ─────────────────────────────────────────────────────────────

const TASK_PREFIX = "TASK-";

// ── Startup guards ───────────────────────────────────────────────────────

function ensureDirs(): void {
  for (const dir of [BASE, ACTIVE, ARCHIVE, SESSIONS]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}
ensureDirs();

// ── Git sync (plan repo) ──────────────────────────────────────────────────
//
// OPT-IN SINCE 0.1.0: syncing is DISABLED unless the plugin is loaded with
// options { sync: true } (object-form config entry). The original auto-sync
// pulled before every read and pushed after every write against a bare origin
// each host cloned — useful on a private fleet, but surprising and risky as a
// public default (it would commit, pull and push on a stranger's machine
// without consent). Public installs therefore run purely local; private
// installs re-enable sync by configuring the plugin with "sync": true.
//
// When enabled, the plan tree is expected to be a git clone of a bare origin.
// Each host pulls before reading and pushes after writing, so the task list is
// always fresh at session start and published at session close.
//
// Design rules:
//   - Sync is opt-in; a missing option means fully local operation.
//   - Non-fatal at runtime: sync failures are warnings, never block the tool.
//   - --ff only: never auto-merge. If diverged, warn and continue.
//   - Commit first: so the working tree is clean for the pull.
//   - session-index.json is gitignored, so `git add -A` won't stage it.

interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function runGit(args: string[]): GitResult {
  const r = spawnSync("git", args, {
    cwd: BASE,
    encoding: "utf-8",
    timeout: 30_000,
  });
  if (r.error) {
    return { ok: false, stdout: "", stderr: r.error.message };
  }
  return {
    ok: r.status === 0,
    stdout: (r.stdout || "").trim(),
    stderr: (r.stderr || "").trim(),
  };
}

let gitRepoChecked = false;
let isGitRepo = false;
let syncEnabled = false;

/**
 * Turn plan-repo syncing on or off. Called by the plugin with the `sync`
 * option (default false). Safe to call at any time; from 0.1.0 the plugin
 * calls it once in setup before any tool runs.
 */
export function configureSync(enabled: boolean): void {
  syncEnabled = Boolean(enabled);
  if (!syncEnabled) {
    gitRepoChecked = false;
    isGitRepo = false;
  }
}

function checkGitRepo(): boolean {
  if (!gitRepoChecked) {
    isGitRepo = runGit(["rev-parse", "--is-inside-work-tree"]).ok;
    gitRepoChecked = true;
  }
  return isGitRepo;
}

/**
 * Pull the latest task changes from the remote.
 * Called by `listTasks()` so a new session always sees the current task list.
 * Non-fatal: returns a warning string on failure, empty string on success.
 * No-op when sync is disabled (the 0.1.0 default).
 */
export function pullTasks(): string {
  if (!syncEnabled) return "";
  if (!checkGitRepo()) return "";
  const pull = runGit(["pull", "--ff-only", "origin", "main"]);
  if (!pull.ok) {
    return `sync: pull failed — ${pull.stderr.split("\n")[0]}`;
  }
  return "";
}

/**
 * Commit, pull, and push task changes to the remote.
 * Called by `sessionDone()` so closing a session publishes its work.
 * Non-fatal: returns a warning string on failure, empty string on success.
 * No-op when sync is disabled (the 0.1.0 default).
 */
export function pushTasks(): string {
  if (!syncEnabled) return "";
  if (!checkGitRepo()) return "";
  const results: string[] = [];

  // Commit local changes (session-index.json is gitignored, so this only
  // commits task files and the handoff).
  runGit(["add", "-A"]);
  const staged = runGit(["diff", "--cached", "--quiet"]);
  if (!staged.ok) {
    const commit = runGit(["commit", "-m", `plan: auto-sync (${new Date().toISOString()})`]);
    if (!commit.ok) {
      results.push(`sync: commit failed — ${commit.stderr.split("\n")[0]}`);
    }
  }

  // Pull (fast-forward only) — another host may have pushed while we worked.
  const pull = runGit(["pull", "--ff-only", "origin", "main"]);
  if (!pull.ok) {
    results.push(`sync: pull failed — ${pull.stderr.split("\n")[0]}`);
  }

  // Push.
  const push = runGit(["push", "origin", "main"]);
  if (!push.ok) {
    results.push(`sync: push failed — ${push.stderr.split("\n")[0]}`);
  }

  return results.join("\n");
}

// ── Helpers ──────────────────────────────────────────────────────────────

function basename(fp: string): string {
  return path.basename(fp);
}

function stripPrefix(name: string): string {
  if (name.startsWith(TASK_PREFIX)) return name.slice(TASK_PREFIX.length);
  return name;
}

/** Active file name from any task name. */
function toTaskName(name: string): string {
  return TASK_PREFIX + stripPrefix(name);
}

/** Archive file base name (without collision counter): TASK-<name>_YYYY-MM-DD.md */
function archiveBaseName(name: string, date: string): string {
  return `${TASK_PREFIX}${stripPrefix(name)}_${date}`;
}

/** Archive file base name WITHOUT date — used by verify to match any dated copy. */
function archiveNameNoDate(name: string): string {
  return `${TASK_PREFIX}${stripPrefix(name)}`;
}

function activeFiles(): string[] {
  try {
    return fs
      .readdirSync(ACTIVE)
      .filter((f) => f.endsWith(".md"))
      .map((f) => path.join(ACTIVE, f))
      .sort();
  } catch {
    return [];
  }
}

function todoSection(content: string): string | null {
  const header = /^#+\s+To Do\s*$/m.exec(content);
  if (!header) return null;
  const level = (header[0].match(/^#+/) || [""])[0].length;
  // Skip the header line plus its trailing newline.
  const afterHeader = header.index + header[0].length + 1;
  const section = content.slice(afterHeader);
  // Stop at the next heading of the SAME OR HIGHER level only. A lower-level
  // heading (e.g. "### 1. ..." under "## To Do") is a subsection of the To Do
  // list and must not terminate it -- treating it as a terminator truncated the
  // section to a blank line, so checkboxMarkers() found nothing and the task
  // reported "pending" forever no matter how many boxes were checked.
  const nextHeader = new RegExp("^#{1," + level + "}\\s+\\S", "m").exec(section);
  if (nextHeader) return section.slice(0, nextHeader.index);
  return section;
}

function checkboxMarkers(content: string): string[] {
  const section = todoSection(content);
  if (!section) return [];
  return section.match(/-\s+\[(.)\]/g) || [];
}

/**
 * The raw `## Notes` block of a task, minus HTML comments. Notes are copied
 * verbatim into the session report -- no parsing, no rewriting.
 */
function notesSection(content: string): string {
  const header = /^#+\s+Notes\s*$/m.exec(content);
  if (!header) return "";
  const level = (header[0].match(/^#+/) || [""])[0].length;
  const afterHeader = header.index + header[0].length + 1;
  const section = content.slice(afterHeader);
  const nextHeader = new RegExp("^#{1," + level + "}\\s+\\S", "m").exec(section);
  const raw = nextHeader ? section.slice(0, nextHeader.index) : section;
  return raw.replace(/<!--[\s\S]*?-->/g, "").trim();
}

/** Checked To Do lines -- the mechanical "what got done" of a task. */
function checkedTodoLines(content: string): string[] {
  const section = todoSection(content);
  if (!section) return [];
  return section
    .split("\n")
    .filter((line) => /^\s*-\s+\[x\]/.test(line))
    .map((line) => line.trim());
}

/** Working directory at close time, and its repo/commit when it is a git tree. */
function cwdScope(): { cwd: string; repo: string | null; commit: string | null } {
  const cwd = process.cwd();
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf-8", timeout: 5_000 });
  const sha = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf-8", timeout: 5_000 });
  const repo = top.status === 0 ? top.stdout.trim() : "";
  const commit = sha.status === 0 ? sha.stdout.trim() : "";
  return { cwd, repo: repo || null, commit: commit || null };
}

/** YAML flow list of JSON-quoted strings (valid YAML, no escaping edge cases). */
function yamlList(items: string[]): string {
  return `[${items.map((item) => JSON.stringify(item)).join(", ")}]`;
}

/** A task is "done" (ready to archive) only when every To Do box is [x]. */
function isDone(filePath: string): boolean {
  const markers = checkboxMarkers(fs.readFileSync(filePath, "utf-8"));
  if (markers.length === 0) return false;
  return markers.every((b) => b.includes("[x]"));
}

/** Derive a granular status from the To Do markers. */
function deriveStatus(filePath: string): string {
  const markers = checkboxMarkers(fs.readFileSync(filePath, "utf-8"));
  if (markers.length === 0) return "pending";
  if (markers.every((b) => b.includes("[x]"))) return "completed";
  if (markers.some((b) => b.includes("[!]"))) return "blocked";
  if (markers.some((b) => b.includes("[~]"))) return "in-progress";
  return "pending";
}

function deriveSummary(filePath: string): string {
  const content = fs.readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const stripped = line.trim();
    if (!stripped) continue;
    if (stripped.startsWith("#")) {
      const title = stripped.replace(/^#+\s*/, "").trim();
      return title.slice(0, 160);
    }
    return stripped.slice(0, 160);
  }
  return "Task";
}

function buffersEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoStamp(d: Date): string {
  return d.toISOString();
}

/** A free `<base>.md`, `<base>-2.md`, ... in `dir`; collision-safe, never overwrites. */
function uniqueFile(dir: string, baseName: string): string {
  let candidate = `${baseName}.md`;
  let i = 2;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${baseName}-${i}.md`;
    i++;
  }
  return candidate;
}

/** A free archive destination for `name` on `date`, collision-safe. */
function archiveDest(name: string, date: string): string {
  return uniqueFile(ARCHIVE, archiveBaseName(name, date));
}

// ── Index (session-index.json) ───────────────────────────────────────────

interface IndexEntry {
  file: string;
  status: string;
  summary: string;
  created: string;
  updated: string;
}

function statTimes(filePath: string): { created: string; updated: string } {
  try {
    const st = fs.statSync(filePath);
    return { created: isoStamp(st.birthtimeMs ? st.birthtime : st.ctime), updated: isoStamp(st.mtime) };
  } catch {
    const now = new Date();
    return { created: isoStamp(now), updated: isoStamp(now) };
  }
}

function parseIndex(): { tasks: IndexEntry[] } | null {
  try {
    const data = JSON.parse(fs.readFileSync(INDEX, "utf-8"));
    if (data && Array.isArray(data.tasks)) return data as { tasks: IndexEntry[] };
    return null;
  } catch {
    return null;
  }
}

/** Atomic write: tmp file + rename to avoid clobbering on concurrent hosts. */
function writeIndex(tasks: IndexEntry[]): void {
  const tmp = `${INDEX}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ tasks }, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, INDEX);
  console.log(`Task index written: ${tasks.length} active task(s) -> ${basename(INDEX)}`);
}

/** Rebuild the entire index from the active/ directory (canonical source). */
export function rebuildIndex(): IndexEntry[] {
  const tasks: IndexEntry[] = [];
  for (const filePath of activeFiles()) {
    const name = basename(filePath);
    const times = statTimes(filePath);
    tasks.push({
      file: name,
      status: deriveStatus(filePath),
      summary: deriveSummary(filePath),
      created: times.created,
      updated: times.updated,
    });
  }
  tasks.sort((a, b) => a.file.localeCompare(b.file));
  writeIndex(tasks);
  return tasks;
}

// ── Handoff prose append (session is done) ───────────────────────────────

function appendHandoff(block: string): void {
  try {
    const prev = fs.existsSync(HANDOFF) ? fs.readFileSync(HANDOFF, "utf-8") : "";
    const sep = prev.length > 0 && !prev.endsWith("\n") ? "\n\n" : prev.length > 0 ? "\n" : "";
    fs.writeFileSync(HANDOFF, prev + sep + block, "utf-8");
  } catch (e) {
    console.error(`WARN: could not append to handoff: ${(e as Error).message}`);
  }
}

// ── Session reports (raw, written by sessionDone) ───────────────────────

interface SessionInput {
  title?: string;
  verifyText?: string;
  archived: Array<{ name: string; dest: string; leftover: boolean }>;
  kept: string[];
}

/** Date-first slug; explicit title wins, else the first closed task name. */
function sessionSlug(title: string | undefined, archivedNames: string[]): string {
  if (title?.trim()) return slugify(title);
  const first = archivedNames[0];
  if (first) return slugify(stripPrefix(first).replace(/_\d{4}-\d{2}-\d{2}(-\d+)?\.md$/, ""));
  return "session";
}

/**
 * Render the raw report. Everything here is derived from files: checked To Do
 * lines, verbatim `## Notes`, the still-active tasks, and the verify output.
 * No prose is generated -- summarising is another tool's job.
 */
function renderSession(input: SessionInput, date: string): string {
  const scope = cwdScope();
  const archivedNames = input.archived.map((a) => a.name);
  const archivedFiles = input.archived.map((a) => a.dest);
  const heading = input.title?.trim() || stripPrefix(archivedNames[0] ?? "session").replace(/_/g, " ");

  const lines: string[] = [];
  lines.push("---");
  lines.push(`date: ${date}`);
  lines.push("status: closed");
  lines.push(`scope: ${JSON.stringify(scope.repo ?? scope.cwd)}`);
  if (scope.commit) lines.push(`commit: ${scope.commit}`);
  lines.push(`tasks: ${yamlList(archivedNames)}`);
  lines.push(`archived: ${yamlList(archivedFiles)}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${heading}`);
  lines.push("");
  lines.push("## Closed");
  if (input.archived.length === 0) {
    lines.push("- none");
  } else {
    for (const entry of input.archived) {
      const content = fs.readFileSync(path.join(ARCHIVE, entry.dest), "utf-8");
      lines.push(`### ${entry.name}`);
      const checked = checkedTodoLines(content);
      if (checked.length === 0) lines.push("- (no checked To Do items)");
      for (const line of checked) lines.push(line);
      lines.push("");
    }
  }
  lines.push("## Notes");
  let notes = 0;
  for (const entry of input.archived) {
    const content = fs.readFileSync(path.join(ARCHIVE, entry.dest), "utf-8");
    const block = notesSection(content);
    if (!block) continue;
    notes++;
    lines.push(`### ${entry.name}`);
    lines.push(block);
    lines.push("");
  }
  if (notes === 0) {
    lines.push("(none)");
    lines.push("");
  }
  lines.push("## Open");
  if (input.kept.length === 0) {
    lines.push("- none");
  } else {
    for (const name of input.kept) {
      const filePath = path.join(ACTIVE, name);
      const status = fs.existsSync(filePath) ? deriveStatus(filePath) : "unknown";
      lines.push(`- ${name} [${status}]`);
    }
  }
  lines.push("");
  if (input.verifyText?.trim()) {
    lines.push("## Verify");
    lines.push("```");
    lines.push(input.verifyText.trim());
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n");
}

/** Write the report; returns its path relative to BASE, or null when there is nothing to record. */
function writeSessionReport(input: SessionInput, date: string): string | null {
  if (input.archived.length === 0) return null;
  const base = `${date}-${sessionSlug(input.title, input.archived.map((a) => a.name))}`;
  const file = uniqueFile(SESSIONS, base);
  fs.writeFileSync(path.join(SESSIONS, file), renderSession(input, date), "utf-8");
  return `sessions/${file}`;
}

// ── Archive / Move Logic ─────────────────────────────────────────────────

export function sessionDone(opts: { title?: string; verifyText?: string } = {}): string {
  const date = todayISO();

  const archived: Array<{ name: string; dest: string; leftover: boolean }> = [];
  const kept: string[] = [];

  for (const filePath of activeFiles()) {
    const name = basename(filePath);
    if (!isDone(filePath)) {
      kept.push(name);
      continue;
    }
    const target = archiveDest(name, date);
    const destPath = path.join(ARCHIVE, target);
    if (fs.existsSync(destPath)) {
      // dest only exists if it is byte-identical (archiveDest skips existing)
      const same = buffersEqual(fs.readFileSync(filePath), fs.readFileSync(destPath));
      if (!same) {
        const err = `ERROR: archive target ${target} exists with different content; ${name} left untouched`;
        console.error(err);
        kept.push(name);
        continue;
      }
      fs.unlinkSync(filePath);
      archived.push({ name, dest: target, leftover: true });
    } else {
      fs.renameSync(filePath, destPath);
      if (fs.existsSync(filePath)) {
        console.error(`ERROR: fail-safe re-check — ${name} still present after move`);
        kept.push(name);
        continue;
      }
      archived.push({ name, dest: target, leftover: false });
    }
  }

  const lines: string[] = [];
  for (const { name, leftover } of archived) {
    const label = leftover ? " (leftover removed, already in archive)" : "";
    lines.push(`"${stripPrefix(name)}" is marked done and moved to archive/${archiveBaseName(name, date)}.md${label}`);
  }
  lines.push(`\nArchived: ${archived.map((a) => a.dest).join(", ") || "none"}`);
  lines.push(`Remaining: ${kept.join(", ") || "none"}`);

  rebuildIndex();

  // Raw session report: derived from the files, never summarised. A failure
  // here must not fail the close -- the archive already happened.
  let reportPath: string | null = null;
  try {
    reportPath = writeSessionReport(
      { title: opts.title, verifyText: opts.verifyText, archived, kept },
      date
    );
  } catch (e) {
    console.error(`WARN: could not write session report: ${(e as Error).message}`);
  }

  // Append a short session-end note to the handoff prose.
  const stamp = todayISO();
  appendHandoff(
    `## Session archived (${stamp})\n\n` +
      `- Archived ${archived.length} task(s)${archived.length ? ": " + archived.map((a) => a.dest).join(", ") : ""}.\n` +
      `- Remaining ${kept.length} active task(s).\n` +
      (reportPath ? `- Session report: ${reportPath}.\n` : "")
  );
  if (reportPath) {
    lines.push(`\nSession report: ${reportPath}`);
  }

  // Publish the session's work to the remote. Non-fatal: a sync failure is
  // a warning, never a blocker — the archive already happened locally.
  const syncMsg = pushTasks();
  if (syncMsg) {
    lines.push(syncMsg);
  }

  return lines.join("\n");
}

// ── New task scaffold ─────────────────────────────────────────────────────

/** Normalize a human task name into the `TASK-<slug>.md` active filename. */
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function newTask(input: { name: string; summary?: string; status?: string }): string {
  const raw = input.name;
  if (!raw || !raw.trim()) return "ERROR: task name is required";
  const file = `${TASK_PREFIX}${slugify(raw)}.md`;
  const filePath = path.join(ACTIVE, file);
  if (fs.existsSync(filePath)) return `ERROR: ${file} already exists in active/`;

  const title = raw.trim().replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const firstTodo = input.summary?.trim() || "Describe this task";
  const statusMarker = input.status === "in-progress" ? "[~]" : input.status === "blocked" ? "[!]" : "[ ]";
  const body =
    `# ${title}\n\n` +
    `**Created:** ${isoStamp(new Date())}\n\n` +
    `## To Do\n` +
    `- ${statusMarker} ${firstTodo}\n\n` +
    `## Notes\n\n` +
    `<!-- raw: walls, ruled-out paths, verified commands. Copied verbatim into the session report at session_close. -->\n`;
  fs.writeFileSync(filePath, body, "utf-8");

  rebuildIndex();
  return `Created active/${file} and registered it in session-index.json.`;
}

// ── Verify Logic ─────────────────────────────────────────────────────────

export function verify(): string {
  const results: Array<{ kind: string; name: string; dest: string; same: boolean }> = [];
  const archiveFiles = fs.existsSync(ARCHIVE) ? fs.readdirSync(ARCHIVE) : [];
  const now = Date.now();
  const staleMs = STALE_DAYS * 24 * 60 * 60 * 1000;

  for (const filePath of activeFiles()) {
    const name = basename(filePath);
    const matchBase = archiveNameNoDate(name);
    const matches = archiveFiles.filter((f) => f.startsWith(matchBase) && f.endsWith(".md"));
    if (matches.length > 0) {
      const archivePath = path.join(ARCHIVE, matches[0]);
      const same = buffersEqual(fs.readFileSync(filePath), fs.readFileSync(archivePath));
      results.push({ kind: same ? "orphan" : "collision", name, dest: matches[0], same });
    } else if (isDone(filePath)) {
      results.push({ kind: "ready-to-archive", name, dest: `${archiveBaseName(name, todayISO())}.md`, same: false });
    } else {
      // Flag stale in-progress tasks.
      const status = deriveStatus(filePath);
      if (status === "in-progress") {
        try {
          const mtime = fs.statSync(filePath).mtimeMs;
          if (now - mtime > staleMs) {
            results.push({ kind: "stale-in-progress", name, dest: "", same: false });
          }
        } catch {
          /* ignore */
        }
      }
    }
  }

  if (results.length === 0) {
    return "OK: no orphans, no collisions, no ready-to-archive tasks, no stale in-progress tasks";
  }

  const lines: string[] = [];
  for (const r of results) {
    if (r.kind === "orphan") {
      lines.push(`ORPHAN: '${r.name}' also exists as '${r.dest}' in archive/ (identical -> active copy is a leftover of a cp, not a mv)`);
    } else if (r.kind === "collision") {
      lines.push(`COLLISION: '${r.name}' vs '${r.dest}' in archive/ with DIFFERENT content (do NOT remove; needs manual attention)`);
    } else if (r.kind === "ready-to-archive") {
      lines.push(`READY-TO-ARCHIVE: '${r.name}' (all To Do checked; archive as '${r.dest}')`);
    } else {
      lines.push(`STALE-IN-PROGRESS: '${r.name}' has not been edited in ${STALE_DAYS}+ days (check if still active or archive it)`);
    }
  }
  return lines.join("\n");
}

// ── Tasks List Logic ─────────────────────────────────────────────────────

/**
 * Summarise the head of session-handoff.md for the `tasks` tool.
 * Prints a bounded excerpt (title, recent headings, path pointer).
 * The agent reads the full file separately when needed.
 */
function handoffSummary(): string | null {
  if (!fs.existsSync(HANDOFF)) return null;
  let text: string;
  let bytes = 0;
  try {
    text = fs.readFileSync(HANDOFF, "utf8");
    bytes = Buffer.byteLength(text, "utf8");
  } catch {
    return null;
  }
  const lines = text.split("\n");

  // The datestamped heading the previous session wrote, e.g. "**Date:** 2026-09-30".
  const dated = lines.find((l) => /^\*\*Date:\*\*/.test(l)) ?? null;

  // Canonical: numbered top-level sections, file order == most recent last.
  const canonical = lines.filter((l) => /^##\s+\d+\./.test(l));

  // Fallback: any `## ` heading, de-duplicated, order preserved. `###` is
  // excluded so a `## Work Completed` with twelve `### 1.` subsections does not
  // flood the excerpt.
  const fallback = dedupeHeadings(
    lines
      .filter((l) => /^##\s+\S/.test(l))
      .map((l) => l.replace(/^##\s+/, "").trim()),
  );

  const sections = (canonical.length > 0 ? canonical : fallback).slice(-8);

  if (text.trim().length === 0) return null;

  const out: string[] = [
    "## Session Handoff — AGENT ACTION REQUIRED: read the handoff file (path below) before you present the task list",
  ];

  // A `**Date:**` line is the strongest signal of recency; fall back to the
  // document's own mtime, and never to nothing.
  if (dated) {
    out.push(dated.trim());
  } else {
    try {
      const when = fs.statSync(HANDOFF).mtime.toISOString().slice(0, 10);
      out.push(`**Date:** ${when} (from file mtime; no **Date:** line in the handoff)`);
    } catch {
      /* unreadable mtime is not worth failing over */
    }
  }

  if (sections.length > 0) {
    out.push("");
    out.push("Most recent session recorded:");
    for (const s of sections) out.push(`- ${s.replace(/^##\s+/, "").trim()}`);
  } else {
    // Content exists but no heading matched even the fallback. Say so with a
    // size, so the reader knows there is something to go read.
    out.push("");
    out.push(`(no section headings found in ${bytes} bytes — read the file directly)`);
  }

  out.push("");
  out.push(
    `Full narrative: ${HANDOFF}\n` +
      `AGENT INSTRUCTION (not for the user): before outputting the task list below, ` +
      `use the read tool on that path and act on what it says. It records what the ` +
      `last session established, including corrections to earlier claims. Relaying ` +
      `this pointer to the user instead of reading the file does not comply.`,
  );
  return out.join("\n");
}

/** De-duplicate heading titles while preserving first-seen order. */
function dedupeHeadings(titles: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of titles) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Newest report by date-first filename, or null when none exists. */
function latestSessionFile(): string | null {
  try {
    const files = fs.readdirSync(SESSIONS).filter((f) => f.endsWith(".md")).sort();
    return files.length > 0 ? path.join(SESSIONS, files[files.length - 1]) : null;
  } catch {
    return null;
  }
}

/**
 * Bounded excerpt of the most recent session report. Same intent as the
 * handoff excerpt: the next session has to SEE that the record exists, or
 * reports accrete unread.
 */
function sessionSummary(): string | null {
  const filePath = latestSessionFile();
  if (!filePath) return null;
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
  const title = (text.split("\n").find((l) => l.startsWith("# ")) ?? "").replace(/^#\s*/, "").trim();
  const sections = text
    .split("\n")
    .filter((l) => /^##\s+\S/.test(l))
    .map((l) => l.replace(/^##\s+/, "").trim());
  const out = [
    "## Latest Session Report — AGENT ACTION REQUIRED: read the report file before acting",
    `- file: ${filePath}`,
    `- title: ${title || "(untitled)"}`,
  ];
  if (sections.length > 0) out.push(`- sections: ${sections.slice(0, 6).join(", ")}`);
  out.push(
    "Read it with the read tool. It is the raw record of the last closed session: " +
      "closed tasks, verbatim notes, open work and verify output."
  );
  return out.join("\n");
}

export function listTasks(): string {
  // Pull the latest task changes from the remote so a new session always sees
  // the current task list. Non-fatal: a sync failure is a warning, never a
  // blocker — the local list is still shown.
  const syncMsg = pullTasks();

  let index = parseIndex();
  if (!index || !Array.isArray(index.tasks)) {
    // session-index.json is host-local and untracked (see the task tree's
    // .gitignore), so a `git pull` can remove it and a first run can precede the
    // load-time rebuild. Regenerate from active/, the canonical source, rather
    // than reporting an empty list that reads like data loss.
    try {
      rebuildIndex();
      index = parseIndex();
    } catch {
      // fall through to the message below
    }
  }

  const lines: string[] = [];

  // Sync status comes first so a failed pull is impossible to miss.
  if (syncMsg) {
    lines.push(syncMsg);
    lines.push("");
  }

  // The handoff comes FIRST. A task list without it reads as "this is all you
  // need to know", which is exactly how a stale handoff survived three syncs.
  const handoff = handoffSummary();
  if (handoff) {
    lines.push(handoff);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  const session = sessionSummary();
  if (session) {
    lines.push(session);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  if (!index || !Array.isArray(index.tasks)) {
    lines.push("No tasks indexed in session-index.json.");
    return lines.join("\n");
  }

  lines.push("## Task Index (from session-index.json)");
  for (const t of index.tasks) {
    const when = t.updated ? ` (updated ${t.updated.slice(0, 10)})` : "";
    lines.push(`- ${t.file} [${t.status}]${when} — ${t.summary}`);
  }

  // Cross-check: find unindexed active files
  const indexed = new Set(index.tasks.map((t) => t.file));
  const unindexed = activeFiles().filter((f) => !indexed.has(basename(f)));
  if (unindexed.length > 0) {
    lines.push("\n## Unindexed task files (not in index)");
    for (const f of unindexed) {
      lines.push(`- ${basename(f)}`);
    }
  }

  return lines.join("\n");
}
