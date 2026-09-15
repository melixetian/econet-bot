import "dotenv/config";
import { loadWorkerConfig } from "../src/config.js";
import { renderDashboard } from "../src/audit/read.js";

process.once("uncaughtException", () => { process.stderr.write("Audit dashboard failed: audit_read_error\n"); process.exitCode = 1; });

function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
const profile = argument("--profile");
if (profile !== undefined && profile !== "baseline" && profile !== "optimized") throw new Error("--profile must be baseline or optimized");
const runId = argument("--run");
if (runId !== undefined && !/^[0-9a-f-]{36}$/i.test(runId)) throw new Error("--run must be an opaque UUID");
const config = loadWorkerConfig();
process.stdout.write(`${renderDashboard(config.tokenAuditDbPath, { ...(profile ? { profile } : {}), ...(runId ? { runId } : {}) }, {
  inputUsdPer1M: config.tokenAuditInputUsdPer1M,
  cachedInputUsdPer1M: config.tokenAuditCachedInputUsdPer1M,
  outputUsdPer1M: config.tokenAuditOutputUsdPer1M,
  reasoningUsdPer1M: config.tokenAuditReasoningUsdPer1M,
})}\n`);
