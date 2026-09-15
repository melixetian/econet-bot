import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadModelEvaluationConfig, parseEvaluationModelArguments, runModelEvaluation } from "../src/evaluation/benchmark.js";
import { parseEvaluationDataset } from "../src/evaluation/dataset.js";
import { prepareModelEvaluationOutputDirectory, writeModelEvaluationReports } from "../src/evaluation/report.js";

const datasetPath = fileURLToPath(new URL("../tests/fixtures/llm-evaluation-cases.json", import.meta.url));

async function main(): Promise<void> {
  const modelArguments = parseEvaluationModelArguments(process.argv.slice(2));
  const config = loadModelEvaluationConfig(process.env, process.cwd(), modelArguments);
  const datasetBytes = readFileSync(datasetPath);
  let raw: unknown;
  try { raw = JSON.parse(datasetBytes.toString("utf8")); }
  catch { throw new Error("Evaluation dataset is not valid JSON"); }
  const dataset = parseEvaluationDataset(raw);
  prepareModelEvaluationOutputDirectory(config.outputDir);
  process.stdout.write(`Starting isolated evaluation: ${config.models.length} models, ${dataset.cases.length} cases, ${config.repetitions} repetition(s).\n`);
  const results = await runModelEvaluation(dataset, datasetBytes, config);
  writeModelEvaluationReports(results, config.outputDir);
  process.stdout.write(`Evaluation complete. Recommendation: ${results.recommendation}\n`);
  process.stdout.write("Reports: results.json and report.md under the configured EVAL_OUTPUT_DIR.\n");
}

await main().catch((error: unknown) => {
  const message = error instanceof Error && /^(?:EVAL_|OLLAMA_BASE_URL|LLM_TIMEOUT_MS|Evaluation dataset|Dataset|Case |CLI model|Use --model_|Both --model_|--model_)/.test(error.message)
    ? error.message
    : "check configuration, report-directory access, and local Ollama availability";
  process.stderr.write(`Model evaluation failed: ${message}.\n`);
  process.exitCode = 1;
});
