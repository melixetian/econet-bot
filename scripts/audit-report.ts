import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, extname } from "node:path";
import { loadWorkerConfig } from "../src/config.js";
import { compareBenchmarks } from "../src/audit/comparison.js";
import { renderReport } from "../src/audit/report.js";
import { safeLabel } from "../src/audit/benchmark-store.js";
function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
try {
  const before = argument("--before"), after = argument("--after"), output = argument("--out");
  if (!before || !after || !output || !safeLabel(before) || !safeLabel(after) || extname(output) !== ".md") throw new Error();
  const config = loadWorkerConfig();
  const target = resolve(output);
  if ([config.tokenAuditDbPath, config.chatDbPath, config.ragDbPath].includes(target)) throw new Error();
  const result = compareBenchmarks(config.tokenAuditDbPath, before, after);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, renderReport(result), { encoding: "utf8", flag: "wx", mode: 0o600 });
  process.stdout.write("Audit report written.\n");
  if (!result.compatible) process.exitCode = 1;
} catch { process.stderr.write("Audit report failed: invalid_selector_existing_output_or_read_error\n"); process.exitCode = 1; }
