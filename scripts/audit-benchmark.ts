import "dotenv/config";
import { readFileSync, openSync, closeSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpus, release, totalmem } from "node:os";
import { loadWorkerConfig } from "../src/config.js";
import { loadSkills } from "../src/agent/skills.js";
import { OllamaProvider } from "../src/inference/providers/ollama.js";
import { SqliteAudit } from "../src/audit/sqlite-audit.js";
import { benchmarkSettings, effectiveConfig, preflight, compatibleSettings, verifyPreflightEvidence, BenchmarkError } from "../src/audit/benchmark-preflight.js";
import { BenchmarkStore, evidenceLog, safeLabel } from "../src/audit/benchmark-store.js";
import { runCase } from "../src/audit/benchmark-runner.js";
import { INVALID_REASONS, type Dataset } from "../src/audit/benchmark-cases.js";
import { compareBenchmarks, renderComparison } from "../src/audit/comparison.js";
import { canonicalJson } from "../src/audit/metrics.js";
import type { AuditProfile } from "../src/audit/types.js";

function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = join(root, "reports", "audit-v2");
async function main(): Promise<void> {
  const pair = process.argv.includes("--pair"), onlyPreflight = process.argv.includes("--preflight");
  const requested = argument("--profile");
  const labels = pair ? [argument("--before"), argument("--after")] : [onlyPreflight ? "preflight" : argument("--label")];
  if (labels.some((label) => !label || !safeLabel(label)) || (pair && labels[0] === labels[1]) || (!pair && !onlyPreflight && requested !== "baseline" && requested !== "optimized")) throw new BenchmarkError("invalid_selector");
  const safeLabels = labels as string[];
  const log = evidenceLog(directory, onlyPreflight ? "preflight" : pair ? "pair" : "execution", safeLabels[0]!);
  const write = (line: string) => { log.write(line); process.stdout.write(line + "\n"); };
  let audit: SqliteAudit | undefined, store: BenchmarkStore | undefined, lock: number | undefined, lockPath: string | undefined;
  let auditPath: string | undefined;
  let started = false;
  try {
    const config = loadWorkerConfig();
    auditPath = config.tokenAuditDbPath;
    if (config.inferenceProvider !== "ollama") throw new BenchmarkError("unsupported_benchmark_provider");
    const settings = benchmarkSettings(config);
    const bytes = readFileSync(join(root, "benchmarks", "token-audit-v2.json"));
    const dataset = JSON.parse(bytes.toString("utf8")) as Dataset;
    const skills = loadSkills(join(root, "skills"));
    const effective = effectiveConfig(config, settings);
    if (!compatibleSettings(benchmarkSettings({ ...effective, tokenAuditProfile: "baseline" }), benchmarkSettings({ ...effective, tokenAuditProfile: "optimized" }))) throw new BenchmarkError("incompatible_options_limits_pricing");
    mkdirSync(dirname(config.tokenAuditDbPath), { recursive: true });
    lockPath = config.tokenAuditDbPath + ".benchmark.lock";
    try { lock = openSync(lockPath, "wx", 0o600); } catch { throw new BenchmarkError("benchmark_locked"); }
    // Opening applies additive migrations only; existing audit records survive.
    audit = new SqliteAudit(config.tokenAuditDbPath, config.tokenAuditAgentId, false);
    store = new BenchmarkStore(config.tokenAuditDbPath);
    const overwrite = process.argv.includes("--overwrite");
    if (!onlyPreflight) store.checkLabels(safeLabels, overwrite);
    const makeProvider = () => new OllamaProvider({ baseUrl: config.ollamaBaseUrl, model: config.ollamaModel, timeoutMs: settings.llmTimeoutMs, chatOptions: settings.options });
    const evidence = await preflight(dataset, skills, config, settings, makeProvider());
    write("Preflight PASS " + canonicalJson({ settings, ...evidence }));
    if (onlyPreflight) return;
    const revision = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return "unavailable"; } })();
    // A random cohort ties comparable labels to one loaded implementation,
    // fixture and Skills snapshot without hashing reusable runtime content.
    // Separate single-profile executions remain diagnostic, not comparable.
    const environment = canonicalJson({ ...evidence, cohort: randomUUID(), implementation: "audit-v2", platform: process.platform, arch: process.arch, node: process.versions.node, os: release(), cpu: cpus()[0]?.model ?? "unavailable", memoryBytes: totalmem(), skills: "bundled-v2" });
    const profiles: AuditProfile[] = pair ? ["baseline", "optimized"] : [requested as AuditProfile];
    for (const [index, profile] of profiles.entries()) {
      const provider = makeProvider();
      const current = index === 0 ? evidence : await preflight(dataset, skills, config, settings, provider);
      if (!compatibleSettings(current, evidence)) throw new BenchmarkError("incompatible_environment");
      const label = safeLabels[index]!;
      const execution = evidenceLog(directory, profile, label);
      const id = store.begin({ label, profile, datasetHash: createHash("sha256").update(bytes).digest("hex"), model: config.ollamaModel, settings: canonicalJson(settings), environment, gitRevision: revision, caseCount: dataset.cases.length }, overwrite);
      started = true;
      const invalid: string[] = [];
      try {
        for (const testCase of dataset.cases) {
          const result = await runCase(testCase, profile, config, settings, skills, provider, audit);
          store.saveCase(id, testCase.id, result.diagnostics, testCase.prompts.length, result.runIds);
          invalid.push(...result.diagnostics.reasons.filter((code) => INVALID_REASONS.includes(code)));
          const line = canonicalJson({ case: testCase.id, ...result.diagnostics });
          execution.write(line); write(profile + " " + line);
        }
        try { await verifyPreflightEvidence(config, settings, evidence); } catch { invalid.push("incompatible_environment"); }
        store.finish(id, invalid);
        write(label + ": " + (invalid.length ? "INVALID " + [...new Set(invalid)].join(",") : "valid; quality/target require comparison"));
      } catch { store.finish(id, ["incomplete_case", "audit_storage_error"]); throw new BenchmarkError("benchmark_execution_failed"); }
      finally { execution.close(); }
      if (invalid.length) process.exitCode = 1;
    }
  } catch (error) {
    write("Benchmark INVALID: " + (error instanceof BenchmarkError ? error.code : "benchmark_error"));
    process.exitCode = 1;
  } finally {
    if (pair && auditPath && store) {
      const comparisonLog = evidenceLog(directory, "comparison", safeLabels[0]!);
      try {
        if (!started) throw new BenchmarkError("no_measured_run");
        const result = compareBenchmarks(auditPath, safeLabels[0]!, safeLabels[1]!);
        const output = renderComparison(result);
        comparisonLog.write(output); write(output);
        if (!result.accepted) process.exitCode = 1;
      } catch (error) { comparisonLog.write("Comparison INVALID: " + (error instanceof BenchmarkError ? error.code : "audit_read_error")); process.exitCode = 1; }
      finally { comparisonLog.close(); }
    }
    store?.close(); audit?.close();
    if (lock !== undefined) { closeSync(lock); unlinkSync(lockPath!); }
    log.close();
  }
}
await main().catch(() => { process.stderr.write("Benchmark INVALID: invalid_selector_or_output\n"); process.exitCode = 1; });
