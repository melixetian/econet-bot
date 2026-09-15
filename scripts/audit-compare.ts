import "dotenv/config";
import { fileURLToPath } from "node:url";
import { loadWorkerConfig } from "../src/config.js";
import { compareBenchmarks, renderComparison } from "../src/audit/comparison.js";
import { evidenceDirectory, evidenceLog } from "../src/audit/benchmark-store.js";

process.once("uncaughtException", () => { process.stderr.write("Audit comparison failed: audit_read_error\n"); process.exitCode = 1; });

function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
const before = argument("--before"); const after = argument("--after");
if (!before || !after || !/^[A-Za-z0-9._-]{1,64}$/.test(before) || !/^[A-Za-z0-9._-]{1,64}$/.test(after)) throw new Error("--before and --after require safe benchmark labels");
const result = compareBenchmarks(loadWorkerConfig().tokenAuditDbPath, before, after);
const root = fileURLToPath(new URL("../", import.meta.url));
const evidenceId = argument("--evidence-id") ?? before.replace(/^before-/, "");
const log = evidenceLog(evidenceDirectory(root, evidenceId), "comparison", before);
try { const output = renderComparison(result); log.write(output); process.stdout.write(output + "\n"); } finally { log.close(); }
if (!result.accepted) process.exitCode = 1;
