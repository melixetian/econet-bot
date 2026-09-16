import { readFileSync } from "node:fs";

export type EvaluationCategory = "prompt_injection" | "hallucination" | "memory";

export interface Expectations {
  containsAll?: string[];
  containsAny?: string[];
  containsNone?: string[];
  matchesAll?: string[];
  maxChars?: number;
}

export type EvaluationStep =
  | { action: "message"; input: string; expect: Expectations }
  | { action: "reset" }
  | { action: "switch_conversation"; conversationId: string };

export interface EvaluationCase {
  id: string;
  category: EvaluationCategory;
  critical: boolean;
  description: string;
  steps: EvaluationStep[];
}

export interface EvaluationDataset {
  version: 1;
  cases: EvaluationCase[];
}

export class EvaluationDatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationDatasetError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmptyString);
}

function parseExpectations(value: unknown, location: string): Expectations {
  if (!record(value)) throw new EvaluationDatasetError(`${location}: expect must be an object`);
  const permitted = new Set(["containsAll", "containsAny", "containsNone", "matchesAll", "maxChars"]);
  if (Object.keys(value).some((key) => !permitted.has(key))) throw new EvaluationDatasetError(`${location}: expect contains an unknown field`);
  if (Object.keys(value).length === 0) throw new EvaluationDatasetError(`${location}: expect must not be empty`);
  const output: Expectations = {};
  for (const key of ["containsAll", "containsAny", "containsNone", "matchesAll"] as const) {
    const list = value[key];
    if (list !== undefined) {
      if (!stringList(list)) throw new EvaluationDatasetError(`${location}: ${key} must be a non-empty string array`);
      output[key] = list;
    }
  }
  if (value.maxChars !== undefined) {
    if (!Number.isInteger(value.maxChars) || (value.maxChars as number) <= 0) throw new EvaluationDatasetError(`${location}: maxChars must be a positive integer`);
    output.maxChars = value.maxChars as number;
  }
  for (const source of output.matchesAll ?? []) {
    try { new RegExp(source, "iu"); }
    catch { throw new EvaluationDatasetError(`${location}: matchesAll contains an invalid regular expression`); }
  }
  return output;
}

function parseStep(value: unknown, location: string): EvaluationStep {
  if (!record(value) || !nonEmptyString(value.action)) throw new EvaluationDatasetError(`${location}: step must have an action`);
  if (value.action === "message") {
    if (!exactKeys(value, ["action", "input", "expect"]) || !nonEmptyString(value.input)) throw new EvaluationDatasetError(`${location}: message step is invalid`);
    return { action: "message", input: value.input, expect: parseExpectations(value.expect, location) };
  }
  if (value.action === "reset") {
    if (!exactKeys(value, ["action"])) throw new EvaluationDatasetError(`${location}: reset step is invalid`);
    return { action: "reset" };
  }
  if (value.action === "switch_conversation") {
    if (!exactKeys(value, ["action", "conversationId"]) || !nonEmptyString(value.conversationId)) throw new EvaluationDatasetError(`${location}: switch_conversation step is invalid`);
    return { action: "switch_conversation", conversationId: value.conversationId };
  }
  throw new EvaluationDatasetError(`${location}: action is unsupported`);
}

export function parseEvaluationDataset(value: unknown): EvaluationDataset {
  if (!record(value) || !exactKeys(value, ["version", "cases"]) || value.version !== 1 || !Array.isArray(value.cases)) throw new EvaluationDatasetError("Dataset must contain version 1 and a cases array");
  if (value.cases.length !== 12) throw new EvaluationDatasetError("Dataset must contain exactly 12 cases");
  const ids = new Set<string>();
  const categories: EvaluationCategory[] = ["prompt_injection", "hallucination", "memory"];
  const counts = new Map<EvaluationCategory, number>(categories.map((category) => [category, 0]));
  const cases = value.cases.map((item, index): EvaluationCase => {
    const location = `Case ${index + 1}`;
    if (!record(item) || !exactKeys(item, ["id", "category", "critical", "description", "steps"])) throw new EvaluationDatasetError(`${location}: case fields are invalid`);
    if (!nonEmptyString(item.id) || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(item.id)) throw new EvaluationDatasetError(`${location}: id must be a safe stable identifier`);
    if (ids.has(item.id)) throw new EvaluationDatasetError(`${location}: id is duplicated`);
    if (!categories.includes(item.category as EvaluationCategory)) throw new EvaluationDatasetError(`${location}: category is invalid`);
    if (typeof item.critical !== "boolean" || !nonEmptyString(item.description) || !Array.isArray(item.steps) || item.steps.length === 0) throw new EvaluationDatasetError(`${location}: case metadata is invalid`);
    const category = item.category as EvaluationCategory;
    if (category === "prompt_injection" && item.critical !== true) throw new EvaluationDatasetError(`${location}: prompt-injection cases must be critical`);
    const steps = item.steps.map((step, stepIndex) => parseStep(step, `${location} step ${stepIndex + 1}`));
    if (!steps.some((step) => step.action === "message")) throw new EvaluationDatasetError(`${location}: case must contain a message step`);
    ids.add(item.id);
    counts.set(category, counts.get(category)! + 1);
    return { id: item.id, category, critical: item.critical, description: item.description, steps };
  });
  if (categories.some((category) => counts.get(category) !== 4)) throw new EvaluationDatasetError("Dataset must contain four cases in each category");
  return { version: 1, cases };
}

export function loadEvaluationDataset(path: string): EvaluationDataset {
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new EvaluationDatasetError("Evaluation dataset is not valid JSON"); }
  return parseEvaluationDataset(value);
}
