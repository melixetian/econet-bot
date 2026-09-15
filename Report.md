# Econet Bot Token Audit v2

Generated: 2026-09-14T18:52:33.855Z

## Acceptance

```text
Compatibility: compatible
before-v4: valid | success 10/13 | usage complete true
after-v4: valid | success 10/13 | usage complete true
Gross exact tokens: 27837 -> 24663 | reduction 11.40%
Success-rate drop pp: 0.00
Hypothetical cost: $0.000000 -> $0.000000 | reduction N/A
Acceptance: FAIL
- token_target_not_met
```

Invalid or incompatible labels suppress exact totals and all reduction/guardrail calculations. Earlier invalid audits remain evidence of neither success nor regression.

## Environment and workload

| Field | Baseline | Optimized |
| --- | --- | --- |
| label | before-v4 | after-v4 |
| profile | baseline | optimized |
| git_revision | 13d40f8f51c04a2b37ae43e1e418738b1af1ed2e | 13d40f8f51c04a2b37ae43e1e418738b1af1ed2e |
| model | qwen3:1.7b | qwen3:1.7b |
| dataset_hash | da9849be5de9ac7b1487f81e50a675502d0cc4cda4250191cb5763876c38f838 | da9849be5de9ac7b1487f81e50a675502d0cc4cda4250191cb5763876c38f838 |
| settings | {"agentMaxSteps":5,"caseTimeoutMs":915000,"contextSafetyFactor":3,"execCaptureBytes":32768,"execMaxChars":3000,"execTimeoutMs":30000,"fixtureVersion":2,"historyBudget":1600,"historyMessages":20,"llmTimeoutMs":180000,"options":{"num_ctx":16384,"num_predict":256,"seed":731,"temperature":0},"prices":[0,0,0,0],"ragMaxContextChars":8000,"ragMaxDistance":1.2,"ragModelMaxChars":4500,"ragTopK":5,"stream":false,"think":false,"version":2} | {"agentMaxSteps":5,"caseTimeoutMs":915000,"contextSafetyFactor":3,"execCaptureBytes":32768,"execMaxChars":3000,"execTimeoutMs":30000,"fixtureVersion":2,"historyBudget":1600,"historyMessages":20,"llmTimeoutMs":180000,"options":{"num_ctx":16384,"num_predict":256,"seed":731,"temperature":0},"prices":[0,0,0,0],"ragMaxContextChars":8000,"ragMaxDistance":1.2,"ragModelMaxChars":4500,"ragTopK":5,"stream":false,"think":false,"version":2} |
| environment | {"arch":"x64","cohort":"20ab0728-4f9c-47c6-9e13-118fbeb90338","contextWindow":16384,"cpu":"Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz","implementation":"audit-v2","largestRequestEstimated":5122,"memoryBytes":17179869184,"modelDigest":"8f68893c685c3ddff2aa3fffce2aa60a30bb2da65ca488b61fff134a4d1730e7","node":"24.10.0","ollamaVersion":"0.33.3","os":"25.6.0","platform":"darwin","skills":"bundled-v2"} | {"arch":"x64","cohort":"20ab0728-4f9c-47c6-9e13-118fbeb90338","contextWindow":16384,"cpu":"Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz","implementation":"audit-v2","largestRequestEstimated":5122,"memoryBytes":17179869184,"modelDigest":"8f68893c685c3ddff2aa3fffce2aa60a30bb2da65ca488b61fff134a4d1730e7","node":"24.10.0","ollamaVersion":"0.33.3","os":"25.6.0","platform":"darwin","skills":"bundled-v2"} |
| started_at | 2026-09-14T18:48:14.373Z | 2026-09-14T18:50:57.020Z |
| completed_at | 2026-09-14T18:50:56.590Z | 2026-09-14T18:52:30.983Z |

## Metrics

| Metric | Baseline | Optimized |
| --- | ---: | ---: |
| Label validity | valid | valid |
| Success (descriptive, not a guardrail claim) | 10/13 | 10/13 |
| Authoritative usage complete | true | true |
| Input tokens | 27211 | 24034 |
| Output tokens | 626 | 629 |
| Cached subset | 19726 | 20562 |
| Reasoning (separate counter) | N/A | N/A |
| Gross exact tokens | 27837 | 24663 |
| Hypothetical cost USD | 0.000000 | 0.000000 |
| LLM calls | 24 | 24 |
| Tool calls | 10 | 10 |
| LLM latency ms | 162025 | 93803 |
| Agent runs (prescribed conversation turns) | 14 | 14 |
| Average exact gross tokens/run | 1988.36 | 1761.64 |
| Average LLM calls/run | 1.71 | 1.71 |
| Average tool calls/run | 0.71 | 0.71 |
| Average LLM latency ms/call | 6751.04 | 3908.46 |
| Provider cache hit rate | 72.49% | 85.55% |
| Estimated repeated input share | 30.70% | 35.88% |
| Initial model-visible tool bytes | 21265 | 7979 |
| Repeated input estimated | 9839 | 9839 |
| New input estimated | 22209 | 17583 |
| Context system estimated | 18096 | 18096 |
| Context tools estimated | 4368 | 4368 |
| Context history estimated | 2757 | 1457 |
| Context user estimated | 941 | 941 |
| Context toolOutput estimated | 5886 | 2560 |

Gross tokens are authoritative prompt_eval_count + eval_count with think=false; cached input is a subset, never added twice. No separate reasoning counter is exposed. Context categories, repetition and tool tokens use ceil(UTF-8 bytes/4), not the model tokenizer. Repetition is run-local and is not an Ollama cache-hit measurement. Incomplete estimates describe recorded events only.

Cost uses the recorded USD/1M rates: uncached input × input rate + cached input × cached rate + output × output rate (+ separate reasoning if supported). Unavailable cache counters use full input at the input rate. Default local Ollama API cost is zero; non-zero prices are hypothetical, not a bill. Zero-to-zero cost reduction is N/A.

## Per-case diagnostics

| Profile | Case | Completion | Score | Reason codes | Expected tools | Observed tools | LLM | Tools | Usage complete | Tool counts exact | Values | Query terms | Source metadata | Citations | History compacted | Tool compacted | Initial full delivery | Later receipt | Usage issues |
| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | direct-arithmetic | success | PASS | none |  |  | 1 | 0 | true | true | true | true | true | true | false | false | false | false | none |
| baseline | direct-concept | success | PASS | none |  |  | 1 | 0 | true | true | true | true | true | true | false | false | false | false | none |
| baseline | exec-failure | success | PASS | none | exec | exec | 2 | 1 | true | true | true | true | true | true | false | false | true | false | none |
| baseline | exec-large | success | PASS | none | exec | exec | 2 | 1 | true | true | true | true | true | true | false | false | true | false | none |
| baseline | history-growth | success | PASS | none |  |  | 1 | 0 | true | true | true | true | true | true | false | false | false | false | none |
| baseline | rag-docx | success | PASS | none | search_documents | search_documents | 2 | 1 | true | true | true | true | true | true | false | false | true | false | none |
| baseline | rag-follow-up | success | FAIL | missing_source, missing_citation | search_documents | search_documents | 3 | 1 | true | true | true | true | true | false | false | false | true | false | none |
| baseline | rag-markdown | success | PASS | none | search_documents | search_documents | 2 | 1 | true | true | true | true | true | true | false | false | true | false | none |
| baseline | rag-no-match | success | PASS | none | search_documents | search_documents | 2 | 1 | true | true | true | true | true | true | false | false | true | false | none |
| baseline | rag-overlap | success | PASS | none | search_documents | search_documents | 2 | 1 | true | true | true | true | true | true | false | false | true | false | none |
| baseline | rag-pdf-page | success | PASS | none | search_documents | search_documents | 2 | 1 | true | true | true | true | true | true | false | false | true | false | none |
| baseline | rag-txt | success | FAIL | missing_source, missing_citation | search_documents | search_documents | 2 | 1 | true | true | true | true | true | false | false | false | true | false | none |
| baseline | sequential-tools | success | FAIL | missing_required_tool, unexpected_tool_count, missing_required_value, missing_source, missing_source_metadata, missing_citation, missing_tool_round | exec, search_documents | exec | 2 | 1 | true | false | false | true | false | false | false | false | true | false | none |
| optimized | direct-arithmetic | success | PASS | none |  |  | 1 | 0 | true | true | true | true | true | true | false | false | false | false | none |
| optimized | direct-concept | success | PASS | none |  |  | 1 | 0 | true | true | true | true | true | true | false | false | false | false | none |
| optimized | exec-failure | success | PASS | none | exec | exec | 2 | 1 | true | true | true | true | true | true | false | false | true | false | none |
| optimized | exec-large | success | PASS | none | exec | exec | 2 | 1 | true | true | true | true | true | true | false | true | true | false | none |
| optimized | history-growth | success | PASS | none |  |  | 1 | 0 | true | true | true | true | true | true | true | false | false | false | none |
| optimized | rag-docx | success | PASS | none | search_documents | search_documents | 2 | 1 | true | true | true | true | true | true | false | false | true | false | none |
| optimized | rag-follow-up | success | FAIL | missing_source, missing_citation | search_documents | search_documents | 3 | 1 | true | true | true | true | true | false | false | false | true | false | none |
| optimized | rag-markdown | success | PASS | none | search_documents | search_documents | 2 | 1 | true | true | true | true | true | true | false | false | true | false | none |
| optimized | rag-no-match | success | PASS | none | search_documents | search_documents | 2 | 1 | true | true | true | true | true | true | false | false | true | false | none |
| optimized | rag-overlap | success | PASS | none | search_documents | search_documents | 2 | 1 | true | true | true | true | true | true | false | true | true | false | none |
| optimized | rag-pdf-page | success | PASS | none | search_documents | search_documents | 2 | 1 | true | true | true | true | true | true | false | false | true | false | none |
| optimized | rag-txt | success | FAIL | missing_source, missing_citation | search_documents | search_documents | 2 | 1 | true | true | true | true | true | false | false | false | true | false | none |
| optimized | sequential-tools | success | FAIL | missing_required_tool, unexpected_tool_count, missing_required_value, missing_source, missing_source_metadata, missing_citation, missing_tool_round, missing_compaction | exec, search_documents | exec | 2 | 1 | true | false | false | true | false | false | false | false | true | false | none |

## Hotspots

| Profile | Opaque run | Turn | Exact tokens | Latency ms |
| --- | --- | ---: | ---: | ---: |
| baseline | ea579e0e-9e5e-410e-a678-3a5810016695 | 2 | 2988 | 32751 |
| baseline | 32161a65-c4db-4acd-8770-8e5d9446af46 | 1 | 2875 | 32210 |
| baseline | 3da4f3d0-19ec-4794-89e9-0e2ca49966ed | 2 | 2288 | 25258 |
| baseline | 84b37351-ba47-40c0-87cb-0e8a2d46188c | 2 | 1132 | 6553 |
| baseline | f9a74274-cbe4-4732-9926-915e569d59e7 | 2 | 1028 | 3644 |
| optimized | 725e101f-f599-4ecf-b950-f82b017c8133 | 1 | 1895 | 14747 |
| optimized | 9aab5443-f18c-428d-8122-e72bd962a68a | 2 | 1592 | 13879 |
| optimized | 01502f97-884b-402c-91c2-ef2573df2ab9 | 2 | 1490 | 9266 |
| optimized | b577f93d-c0e0-4964-a77b-2d3ee2ffa225 | 2 | 1132 | 5777 |
| optimized | 41a950a2-ddbe-48f5-970a-59c83dec066c | 2 | 1028 | 3309 |

| Profile | Tool | Initial output tokens estimated | Initial output bytes | Duration ms |
| --- | --- | ---: | ---: | ---: |
| baseline | exec | 3265 | 12996 | 0 |
| baseline | search_documents | 2115 | 8269 | 0 |
| optimized | search_documents | 1074 | 4129 | 1 |
| optimized | exec | 980 | 3850 | 1 |

## Optimizations and tradeoffs

1. History: newest complete exchanges fitting 1,600 estimated tokens; oversized exchanges are skipped, never exempted. Older relevant facts may be lost.
2. Exec: approximately 3,000 model-visible JSON characters, retaining prefix/suffix, status, original sizes and compaction marker. The real executor's 32 KiB capture bound is unchanged.
3. Old transient results: receipt only after an intervening LLM call saw the full initial result, and only when text evidence remains verbatim in newer results. Unique old evidence is preserved. Newest results are never receipts.
4. RAG: exact overlap removal only between consecutive chunks of the same document/page when the marker is shorter; metadata and retrieval order remain unchanged.
5. RAG: retain complete highest-ranked results under a 4,500-character text budget. An oversized first result is kept whole under the existing 8,000-character retrieval hard bound to avoid silently severing evidence; v2 fixtures never need this exception.
6. Repeated tools: an exact later-round call is suppressed only after the model received its successful result. Corrected calls, failed-call retries and calls requested together still execute. Every request remains instrumented and unexpected counts fail case scoring.

Baseline retains original history and tool contexts. Shared compact correctness instructions, duplicate-loop protection, native tool transport, model, deterministic options, Skills, fixtures, scoring and limits are identical. No dynamic Skill selection is used.

## Reproducibility and privacy

Use the paired command: both profiles share one in-memory code/dataset/bundled-Skills snapshot and an opaque random cohort. Separate single-profile runs are diagnostic only and deliberately not comparable. Fixture history and owner-scoped RAG are recreated per case/profile; full expected fixture results are single-use, with bounded feedback for later duplicates or unexpected arguments. These attempts remain instrumented quality failures. No real documents, history, shell execution, embeddings or Telegram calls are involved. Real Ollama chat calls are required for measured evidence. Preflight/warmup calls are unmeasured.
No prompts, responses, commands, queries, document text, tool contents, source filenames, Telegram IDs, secrets or reusable runtime-content hashes are persisted. Source/citation/value assertions run in memory; only fixed case IDs, predefined tool names, counters, booleans and reason codes remain. The static synthetic dataset SHA-256 and provider model digest identify benchmark artifacts, not user content.

## Limitations

Temperature 0 and seed 731 reduce sampling variance but do not guarantee bitwise repeatability across hardware/backend versions. Context preflight conservatively reserves all permitted tool/LLM rounds and applies a per-request guard, but remains an estimate rather than a tokenizer proof. A saturated authoritative prompt invalidates the case. RAG fixtures test agent context handling, not embedding/retrieval quality; run the existing RAG evaluation separately. With 13 cases, one lost success is 7.69 percentage points. The 30% token target and 2-point guardrail require new valid compatible local Ollama output.
