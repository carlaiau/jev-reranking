# Ten-level JEV Score on MS MARCO v1 / TREC DL 2019

Status: complete. Issue [#88](https://github.com/carlaiau/jev-reranking/issues/88).
Protocol and fixed rubric: [msmarco-score.md](../../msmarco-score.md).

All three local runs use the same 43 judged queries and 41,042 supplied passage candidates.
Score and Noul use original passage text. monoBERT uses its saved local checkpoint.

## Effectiveness

| Metric | JEV Score | JEV Noul | monoBERT |
| --- | ---: | ---: | ---: |
| ndcg_cut_10 | 0.6518 | 0.6835 | 0.7177 |
| map | 0.4648 | 0.4729 | 0.4488 |
| Rprec | 0.4811 | 0.4845 | 0.4650 |
| P_10 | 0.5930 | 0.6163 | 0.6233 |
| bpref | 0.5218 | 0.5238 | 0.4807 |
| recip_rank | 0.7904 | 0.8447 | 0.8717 |
| recall_100 | 0.6003 | 0.5980 | 0.5854 |
| recall_1000 | 0.6943 | 0.6943 | 0.6943 |

Headline nDCG@10 uses all original relevance grades; binary metrics use grades 2–3.
The supplied candidate set is fixed. Mean candidate recall at each query’s complete supplied depth is 0.6943;
this equals recall@1000 because no query has more than 1,000 candidates. The per-query
counts and recall values are in paired-analysis.json. Recall@100 is ranking-dependent.

## Paired nDCG@10 differences

| Comparison | Mean delta | Bootstrap 95% CI | Two-sided p | Holm p | Better / worse / tied queries |
| --- | ---: | --- | ---: | ---: | --- |
| Score − Noul | -0.0317 | [-0.0594, -0.0032] | 0.02956 | 0.02956 | 11 / 26 / 6 |
| Score − monoBERT | -0.0659 | [-0.1119, -0.0212] | 0.00730 | 0.01460 | 15 / 27 / 1 |

Paired tests use 43 per-query trec_eval values rounded to four decimals:
10,000 bootstrap resamples, 100,000 sign randomizations, seed 88, and Holm adjustment
over the two headline comparisons. Secondary metrics are descriptive.

## Time and cost

| Method | Rerank seconds | Query p50 / p95 seconds | API attempts / failed | Estimated API USD |
| --- | ---: | ---: | ---: | ---: |
| JEV Score | 1295.57 | 31.20 / 32.35 | 41,045 / 3 | 1.028211 |
| JEV Noul | 1575.11 | 38.08 / 39.90 | 41,045 / 3 | 0.761027 |
| monoBERT | 969.83 | 22.46 / 28.02 | 0 / 0 | 0.000000 |

Score / Noul rerank-time ratio: 0.82×; estimated API-cost ratio: 1.35×.
The two JEV timings are separate single uncached runs, not repeated hardware-controlled medians.
They include network and retries. Pricing is the published $0.042/million input-token rate,
with free output, checked 2026-09-25. Failed-attempt billing and local compute cost are unknown.
Supplied-candidate retrieval time is unknown, so no end-to-end search time is claimed.
The earlier validation attempt is accounted for separately: 19 accepted responses cost an
estimated $0.000470862; one synthetic preflight plus two diagnostic calls add an estimated
$0.000071190. Billing for two locally rejected responses is unknown. These amounts are
outside the complete Score run cost above.

## Decision

Rejected: the preregistered nDCG@10 improvement criterion versus Noul is not met.
Score is significantly worse on the primary metric, despite a shorter observed rerank time, and its estimated API cost is higher.
This single fixed-rubric evaluation is not a prompt search or held-out proof of a broader conclusion.

## Evidence

- [Frozen input manifest](../input/manifest.json).
- [Score manifest](manifest.json), [response-derived scores](scores.jsonl), [API attempts](attempts.jsonl).
- [Score run](run.trec), [graded trec_eval](trec_eval-graded.txt), [binary trec_eval](trec_eval-binary.txt).
- [Per-query metrics](metrics-per-query.json), [paired analysis](paired-analysis.json), [audit](audit.json).
- [Noul results](../jev-full/results.md), [monoBERT results](../monobert/results.md).

- [Failed validation attempt](../jev-score-failed-validation-20260925/results.md),
  [contract tests](msmarco-contracts.log), [repository smoke](smoke.log), [audit log](audit.log).

Response caches, source passage text, credentials and model downloads are outside Git.
