import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSkills } from "../src/agent/skills.js";
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
describe("Skill loading", () => { it("sorts one-level Skill files", () => { const root = mkdtempSync(join(tmpdir(), "skills-")); directories.push(root); for (const [name, content] of [["z", "z"], ["a", "a"]] as const) { mkdirSync(join(root, name)); writeFileSync(join(root, name, "SKILL.md"), content); } expect(loadSkills(root)).toEqual(["a", "z"]); }); it("rejects absent and empty directories", () => { expect(() => loadSkills("/not/a/skill-directory")).toThrow(); const root = mkdtempSync(join(tmpdir(), "skills-")); directories.push(root); expect(() => loadSkills(root)).toThrow("No SKILL.md files found"); }); });
