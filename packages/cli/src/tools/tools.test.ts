import { afterAll, beforeAll, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Mode } from "@codepilot/database/enums";

import { createTools } from "./index";

/**
 * These tests exist for the sandbox, not for the happy path.
 *
 * Each one names an escape a model could actually attempt — `..` traversal, a
 * symlink pointing out of the workspace, a blind overwrite of a file it never
 * read, a command inheriting the server's API keys — and asserts the tool
 * refuses it *and* that the file on the other side is untouched. A regression
 * in this file is a security regression, so prefer adding a case over
 * loosening one.
 *
 * Run with `bun test`.
 */

let root: string;
let outside: string;

// Minimal shim for the AI SDK's ToolExecutionOptions.
const opts = { toolCallId: "t", messages: [], context: {} } as any;
const call = async (tools: any, name: string, input: any) =>
  await tools[name].execute(input, opts);

beforeAll(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "cp-tools-test-"));
  root = path.join(base, "workspace");
  outside = path.join(base, "outside");
  fs.mkdirSync(root);
  fs.mkdirSync(outside);

  fs.writeFileSync(path.join(outside, "secret.txt"), "TOP SECRET");
  fs.writeFileSync(path.join(root, ".env"), "API_KEY=leaked");
  fs.writeFileSync(path.join(root, ".env.example"), "API_KEY=");
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(
    path.join(root, "src", "index.ts"),
    "export const a = 1;\nexport const b = 2;\nconst dup = 1;\nconst dup2 = 1;\n",
  );
  fs.writeFileSync(path.join(root, "src", "util.ts"), "export function u() {}\n");
  fs.mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules", "pkg", "index.ts"), "export const a = 1;\n");
  fs.writeFileSync(path.join(root, "bin.dat"), Buffer.from([0x00, 0x01, 0x02, 0x00]));
  fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "escape.txt"));
  fs.symlinkSync(outside, path.join(root, "escapedir"));
});

afterAll(() => {
  fs.rmSync(path.dirname(root), { recursive: true, force: true });
});

const build = () => createTools({ workspaceRoot: root, mode: Mode.BUILD });
const plan = () => createTools({ workspaceRoot: root, mode: Mode.PLAN });

test("PLAN mode exposes no mutating tools", () => {
  expect(Object.keys(plan()).sort()).toEqual(["glob", "grep", "listDirectory", "readFile"]);
  expect(Object.keys(build()).sort()).toEqual([
    "editFile", "glob", "grep", "listDirectory", "readFile", "runCommand", "writeFile",
  ]);
});

test("path traversal is rejected", async () => {
  const t = build();
  for (const p of ["../outside/secret.txt", "src/../../outside/secret.txt", outside + "/secret.txt", "/etc/passwd"]) {
    const r = await call(t, "readFile", { path: p });
    expect(r.success).toBe(false);
    expect(r.code).toBe("outside_workspace");
  }
});

test("NUL byte in path is rejected", async () => {
  const r = await call(build(), "readFile", { path: "src/index.ts\0../../etc/passwd" });
  expect(r.code).toBe("invalid_input");
});

test("symlink escape is rejected on read and on write", async () => {
  const t = build();
  const read = await call(t, "readFile", { path: "escape.txt" });
  expect(read.success).toBe(false);
  expect(read.code).toBe("outside_workspace");

  const viaDir = await call(t, "readFile", { path: "escapedir/secret.txt" });
  expect(viaDir.success).toBe(false);
  expect(viaDir.code).toBe("outside_workspace");

  const write = await call(t, "writeFile", { path: "escape.txt", content: "pwned" });
  expect(write.success).toBe(false);
  expect(write.code).toBe("is_symlink");
  expect(fs.readFileSync(path.join(outside, "secret.txt"), "utf8")).toBe("TOP SECRET");

  const writeViaDir = await call(t, "writeFile", { path: "escapedir/new.txt", content: "pwned" });
  expect(writeViaDir.success).toBe(false);
  expect(fs.existsSync(path.join(outside, "new.txt"))).toBe(false);
});

test("secrets denylist blocks .env but allows .env.example", async () => {
  const t = build();
  const denied = await call(t, "readFile", { path: ".env" });
  expect(denied.code).toBe("denied_path");
  expect(JSON.stringify(denied)).not.toContain("leaked");

  const allowed = await call(t, "readFile", { path: ".env.example" });
  expect(allowed.success).toBe(true);

  expect((await call(t, "writeFile", { path: ".git/hooks/pre-commit", content: "x" })).code).toBe("denied_path");
  expect((await call(t, "writeFile", { path: "deploy.pem", content: "x" })).code).toBe("denied_path");
});

test("errors never leak absolute host paths", async () => {
  const r = await call(build(), "readFile", { path: "does/not/exist.ts" });
  expect(r.success).toBe(false);
  expect(JSON.stringify(r)).not.toContain(root);
});

test("readFile numbers lines and pages", async () => {
  const t = build();
  const r = await call(t, "readFile", { path: "src/index.ts" });
  expect(r.success).toBe(true);
  expect(r.content).toContain("1\texport const a = 1;");
  expect(r.totalLines).toBe(4);

  const page = await call(t, "readFile", { path: "src/index.ts", offset: 2, limit: 1 });
  expect(page.content).toBe("2\texport const b = 2;");
  expect(page.truncated).toBe(true);

  expect((await call(t, "readFile", { path: "bin.dat" })).code).toBe("binary_file");
  expect((await call(t, "readFile", { path: "src" })).code).toBe("not_a_file");
});

test("overwrite requires a prior read, and detects staleness", async () => {
  const t = build();
  const blind = await call(t, "writeFile", { path: "src/util.ts", content: "nope" });
  expect(blind.code).toBe("read_required");
  expect(fs.readFileSync(path.join(root, "src/util.ts"), "utf8")).toBe("export function u() {}\n");

  await call(t, "readFile", { path: "src/util.ts" });
  const ok = await call(t, "writeFile", { path: "src/util.ts", content: "export function u() { return 1 }\n" });
  expect(ok.success).toBe(true);
  expect(ok.created).toBe(false);

  // Someone else edits the file behind the model's back.
  const future = new Date(Date.now() + 5000);
  fs.writeFileSync(path.join(root, "src/util.ts"), "user edit\n");
  fs.utimesSync(path.join(root, "src/util.ts"), future, future);
  const stale = await call(t, "writeFile", { path: "src/util.ts", content: "clobber" });
  expect(stale.code).toBe("stale_read");
  expect(fs.readFileSync(path.join(root, "src/util.ts"), "utf8")).toBe("user edit\n");
});

test("new files need no prior read, and nested dirs are created", async () => {
  const r = await call(build(), "writeFile", { path: "a/b/c.ts", content: "export {}\n" });
  expect(r.success).toBe(true);
  expect(r.created).toBe(true);
  expect(fs.readFileSync(path.join(root, "a/b/c.ts"), "utf8")).toBe("export {}\n");
});

test("editFile refuses ambiguous and missing matches", async () => {
  const t = build();
  await call(t, "readFile", { path: "src/index.ts" });

  const missing = await call(t, "editFile", { path: "src/index.ts", oldString: "nothere", newString: "x" });
  expect(missing.code).toBe("no_match");

  const ambiguous = await call(t, "editFile", { path: "src/index.ts", oldString: "= 1;", newString: "= 9;" });
  expect(ambiguous.code).toBe("not_unique");
  expect(fs.readFileSync(path.join(root, "src/index.ts"), "utf8")).toContain("export const a = 1;");

  const ok = await call(t, "editFile", { path: "src/index.ts", oldString: "export const b = 2;", newString: "export const b = 3;" });
  expect(ok.success).toBe(true);
  expect(ok.replacements).toBe(1);
  expect(ok.line).toBe(2);
  expect(fs.readFileSync(path.join(root, "src/index.ts"), "utf8")).toContain("export const b = 3;");

  await call(t, "readFile", { path: "src/index.ts" });
  const all = await call(t, "editFile", { path: "src/index.ts", oldString: "= 1;", newString: "= 7;", replaceAll: true });
  expect(all.replacements).toBe(3);

  const nonexistent = await call(t, "editFile", { path: "nope.ts", oldString: "a", newString: "b" });
  expect(nonexistent.code).toBe("not_found");
});

test("edits preserve file mode", async () => {
  const t = build();
  fs.writeFileSync(path.join(root, "run.sh"), "echo hi\n", { mode: 0o755 });
  await call(t, "readFile", { path: "run.sh" });
  await call(t, "editFile", { path: "run.sh", oldString: "hi", newString: "there" });
  expect(fs.statSync(path.join(root, "run.sh")).mode & 0o777).toBe(0o755);
});

test("glob matches, skips node_modules, and sorts by mtime", async () => {
  const t = build();
  const r = await call(t, "glob", { pattern: "**/*.ts" });
  expect(r.success).toBe(true);
  expect(r.paths).toContain("src/index.ts");
  expect(r.paths.some((p: string) => p.startsWith("node_modules"))).toBe(false);

  expect((await call(t, "glob", { pattern: "src/*.ts" })).paths.sort()).toEqual(["src/index.ts", "src/util.ts"]);
  expect((await call(t, "glob", { pattern: "**/{index,util}.ts" })).count).toBe(2);
  expect((await call(t, "glob", { pattern: "../*" })).code).toBe("outside_workspace");
  expect((await call(t, "glob", { pattern: "/etc/*" })).code).toBe("invalid_input");
  expect((await call(t, "glob", { pattern: "*.ts", path: "src" })).count).toBe(2);
  // Symlinks are never reported.
  expect((await call(t, "glob", { pattern: "**/*.txt", includeHidden: true })).paths).toEqual([]);
});

test("grep finds content, respects glob filter and output modes", async () => {
  const t = build();
  const r = await call(t, "grep", { pattern: "export const", glob: "**/*.ts" });
  expect(r.success).toBe(true);
  expect(r.matches.some((m: any) => m.path === "src/index.ts")).toBe(true);
  expect(r.matches.some((m: any) => m.path.startsWith("node_modules"))).toBe(false);

  const files = await call(t, "grep", { pattern: "export", outputMode: "files" });
  expect(Array.isArray(files.paths)).toBe(true);

  const counts = await call(t, "grep", { pattern: "export", outputMode: "count" });
  expect(counts.counts[0]).toHaveProperty("count");

  const ctx = await call(t, "grep", { pattern: "const dup2", contextLines: 1 });
  expect(ctx.matches[0].before.length).toBe(1);

  // .env is never searched, so its contents cannot leak through grep.
  const env = await call(t, "grep", { pattern: "API_KEY", includeHidden: true });
  expect(JSON.stringify(env)).not.toContain("leaked");

  expect((await call(t, "grep", { pattern: "(a+)+$" })).code).toBe("policy");
  expect((await call(t, "grep", { pattern: "[unclosed" })).code).toBe("invalid_input");
  expect((await call(t, "grep", { pattern: "(a+)+$", literal: true })).success).toBe(true);
  expect((await call(t, "grep", { pattern: "EXPORT CONST", caseInsensitive: true })).totalMatches).toBeGreaterThan(0);
});

test("listDirectory hides ignored and denied entries", async () => {
  const t = build();
  const r = await call(t, "listDirectory", {});
  const names = r.entries.map((e: any) => e.name);
  expect(names).toContain("src");
  expect(names).not.toContain("node_modules");
  expect(names).not.toContain(".env");
  expect(r.entries[0].type).toBe("directory");

  const hidden = await call(t, "listDirectory", { includeHidden: true });
  expect(hidden.entries.map((e: any) => e.name)).not.toContain(".env");
  expect((await call(t, "listDirectory", { path: "src/index.ts" })).code).toBe("not_a_directory");
});

test("runCommand runs in the workspace with a scrubbed environment", async () => {
  process.env.SECRET_API_KEY = "super-secret";
  const t = build();

  const pwd = await call(t, "runCommand", { command: "pwd" });
  expect(pwd.success).toBe(true);
  expect(pwd.stdout.trim()).toBe(fs.realpathSync.native(root));

  const leak = await call(t, "runCommand", { command: "env" });
  expect(leak.stdout).not.toContain("super-secret");

  const fail = await call(t, "runCommand", { command: "exit 3" });
  expect(fail.success).toBe(false);
  expect(fail.exitCode).toBe(3);

  const timeout = await call(t, "runCommand", { command: "sleep 5", timeout: 1000 });
  expect(timeout.code).toBe("timeout");

  // stdin is closed, so an interactive read returns immediately instead of hanging.
  const stdin = await call(t, "runCommand", { command: "read x; echo done", timeout: 3000 });
  expect(stdin.code).not.toBe("timeout");

  const blocked = await call(t, "runCommand", { command: "sudo rm -rf /" });
  expect(blocked.code).toBe("policy");

  const big = await call(t, "runCommand", { command: "yes hello | head -100000" });
  expect(big.truncated).toBe(true);
  expect(big.stdout.length).toBeLessThan(40_000);
});

test("runCommand allowlist rejects everything else", async () => {
  const t = createTools({ workspaceRoot: root, mode: Mode.BUILD, allowedBinaries: ["echo"] });
  expect((await call(t, "runCommand", { command: "echo hi" })).success).toBe(true);
  expect((await call(t, "runCommand", { command: "cat .env" })).code).toBe("policy");
  expect((await call(t, "runCommand", { command: "FOO=1 cat .env" })).code).toBe("policy");
});

test("runCommand kills the whole process group on timeout", async () => {
  const t = build();
  const marker = path.join(root, "grandchild.txt");
  await call(t, "runCommand", {
    command: `sh -c '(sleep 2; echo alive > ${marker}) & sleep 10'`,
    timeout: 1000,
  });
  await Bun.sleep(3000);
  expect(fs.existsSync(marker)).toBe(false);
});

test("concurrent sessions do not share a read ledger", async () => {
  const a = build();
  const b = build();
  await call(a, "readFile", { path: "src/util.ts" });
  expect((await call(b, "writeFile", { path: "src/util.ts", content: "x" })).code).toBe("read_required");
});
