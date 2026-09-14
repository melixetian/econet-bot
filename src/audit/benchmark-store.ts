import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync, openSync, closeSync, writeSync } from "node:fs";
import { join } from "node:path";
import { BenchmarkError } from "./benchmark-preflight.js";
import type { AuditProfile } from "./types.js";
import type { CaseDiagnostics } from "./benchmark-cases.js";

export function safeLabel(label: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(label); }
export function evidenceLog(directory: string, kind: string, label: string): { path: string; write(text: string): void; close(): void } {
  if (!safeLabel(label) || !/^[a-z-]+$/.test(kind)) throw new BenchmarkError("invalid_selector");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, new Date().toISOString().replace(/[:.]/g, "-") + "-" + kind + "-" + label + "-" + randomUUID() + ".txt");
  const fd = openSync(path, "wx", 0o600);
  return { path, write: (text) => { writeSync(fd, text + "\n"); }, close: () => closeSync(fd) };
}
export interface BenchmarkMetadata {
  label: string; profile: AuditProfile; datasetHash: string; model: string;
  settings: string; environment: string; gitRevision: string; caseCount: number;
}
export class BenchmarkStore {
  readonly db: Database.Database;
  constructor(path: string) { this.db = new Database(path); this.db.pragma("foreign_keys = ON"); }
  checkLabels(labels: string[], overwrite: boolean): void {
    if (new Set(labels).size !== labels.length || labels.some((label) => !safeLabel(label))) throw new BenchmarkError("duplicate_or_invalid_label");
    for (const label of labels) if (!overwrite && this.db.prepare("SELECT 1 FROM benchmark_runs WHERE label=?").get(label)) throw new BenchmarkError("duplicate_label");
  }
  begin(meta: BenchmarkMetadata, overwrite: boolean): number {
    return this.db.transaction(() => {
      this.checkLabels([meta.label], overwrite);
      // An explicit overwrite archives the old label, retaining every linked row.
      if (overwrite) this.db.prepare("UPDATE benchmark_runs SET label=? WHERE label=?").run("archived-" + randomUUID(), meta.label);
      return Number(this.db.prepare("INSERT INTO benchmark_runs(label,profile,dataset_hash,model,settings,environment,git_revision,started_at,completed_at,case_count,format_version,validity,invalid_reasons) VALUES(?,?,?,?,?,?,?,?,?,?,2,'running','[\"incomplete_case\"]')").run(meta.label, meta.profile, meta.datasetHash, meta.model, meta.settings, meta.environment, meta.gitRevision, new Date().toISOString(), "", meta.caseCount).lastInsertRowid);
    })();
  }
  saveCase(benchmark: number, caseId: string, diagnostics: CaseDiagnostics, expectedRuns: number, runIds: string[]): void {
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO benchmark_cases(benchmark_id,case_id,passed,status,audit_run_id,diagnostics,expected_runs) VALUES(?,?,?,?,?,?,?)")
        .run(benchmark, caseId, diagnostics.reasons.length === 0 ? 1 : 0, diagnostics.completion, runIds.at(-1) ?? null, JSON.stringify(diagnostics), expectedRuns);
      const insert = this.db.prepare("INSERT INTO benchmark_case_runs VALUES(?,?,?,?)");
      runIds.forEach((id, ordinal) => insert.run(benchmark, caseId, ordinal, id));
    })();
  }
  finish(id: number, reasons: string[]): void {
    this.db.prepare("UPDATE benchmark_runs SET validity=?,invalid_reasons=?,completed_at=? WHERE id=?").run(reasons.length ? "invalid" : "valid", JSON.stringify([...new Set(reasons)]), new Date().toISOString(), id);
  }
  close(): void { this.db.close(); }
}

