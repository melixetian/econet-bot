import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { DocumentFileType } from "../src/inference/protocol.js";
import { SqliteRag } from "../src/rag/sqlite-rag.js";

type Topic = "leave" | "security" | "benefits" | "office" | "cobalt" | "missing";
type Evaluation = {
  documents: Array<{ userId: string; filename: string; fileType: DocumentFileType; pageNumber?: number; text: string; topic: Topic }>;
  cases: Array<{ name: string; userId: string; question: string; topic: Topic; expectedSource: string | null; identifyingText: string | null }>;
};
const topics: Topic[] = ["leave", "security", "benefits", "office", "cobalt", "missing"];
function vector(topic: Topic): number[] { return topics.map((candidate) => candidate === topic ? 1 : 0); }

const dataset = JSON.parse(readFileSync(new URL("../tests/rag-evaluation.json", import.meta.url), "utf8")) as Evaluation;
const path = join(tmpdir(), `econet-rag-evaluation-${randomUUID()}.sqlite`);
const rag = new SqliteRag(path, "deterministic-evaluation", topics.length);
let failures = 0;
try {
  for (const document of dataset.documents) rag.insertDocument(document.userId, document.filename, document.fileType, [{ text: document.text, chunkIndex: 0, ...(document.pageNumber === undefined ? {} : { pageNumber: document.pageNumber }) }], [vector(document.topic)]);
  for (const testCase of dataset.cases) {
    const results = rag.search(testCase.userId, vector(testCase.topic), 3).filter((result) => result.distance <= 0.8);
    const passed = testCase.expectedSource === null ? results.length === 0 : results[0]?.filename === testCase.expectedSource && results[0].text.includes(testCase.identifyingText ?? "");
    process.stdout.write(`${passed ? "PASS" : "FAIL"} ${testCase.name}\n`);
    if (!passed) failures += 1;
  }
} finally { rag.close(); rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true }); }
if (failures > 0) { process.stderr.write(`${failures} retrieval evaluation case(s) failed.\n`); process.exitCode = 1; }
else process.stdout.write(`${dataset.cases.length} retrieval evaluation cases passed.\n`);
