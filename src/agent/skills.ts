import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
export function loadSkills(skillsDir: string): string[] {
  let entries: string[]; try { entries = readdirSync(skillsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(skillsDir, entry.name, "SKILL.md")).sort(); } catch { throw new Error(`Could not read Skills directory: ${skillsDir}`); }
  if (entries.length === 0) throw new Error("No SKILL.md files found in Skills directory");
  return entries.map((path) => { try { return readFileSync(path, "utf8"); } catch { throw new Error(`Could not read Skill file: ${path}`); } });
}
