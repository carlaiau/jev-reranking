# Ten-level JEV Score experiment on MS MARCO v1 passages

Issue [#88](https://github.com/carlaiau/jev-reranking/issues/88). This is a new
pointwise scoring hypothesis on the **same frozen** TREC DL 2019 input defined in
[the MS MARCO protocol](msmarco.md). It does not change the earlier Noul or
monoBERT runs or the WSJ stage-1 baseline.

## Method fixed before inference

Score all 41,042 query–passage pairs across 43 judged queries. Send the original
passage text and query in the same state fields used by `jev-full`; supply no
qrels, prior rank or prior score. Use one Score question per pair, no truncation,
and score ties by ascending numeric passage ID. Compare with the saved
`jev-full` Noul and monoBERT runs on these exact candidates.

The Score question asks how directly and completely the passage answers the
query. Its ten ordered criteria and fixed relevance weights are:

| Level | Weight | Description |
| ---: | ---: | --- |
| 0 | 5 | Unrelated; no useful information about the subject |
| 1 | 15 | Shares words but uses another meaning or subject |
| 2 | 25 | Incidental mention, no answer |
| 3 | 35 | General background, no answer |
| 4 | 45 | One related fact, answer unresolved |
| 5 | 55 | Limited part of answer, most detail omitted |
| 6 | 65 | Substantial answer, major detail or qualification missing |
| 7 | 75 | Main answer with supporting fact, smaller gap |
| 8 | 85 | Direct answer, nearly all requested details |
| 9 | 100 | Perfect match, complete answer with all requested details |

The exact instructions and criterion strings are frozen in `SCORE_QUESTION` in
`msmarco.py`. The ranking value is `sum(p[i] * weight[i])` from the ten returned
probabilities. The API's own `score` is the expected level index (0–9), which
we check against the distribution. We also retain the probabilities, API score,
and confidence for each pair. The weights are fixed before evaluation; neither
their spacing nor the rubric is tuned on these 43 queries. [TypeSafe's Score
documentation](https://docs.typesafe.ai/primitives/score) defines the response.
The user's cited [article/post](https://x.com/ErikKaum/status/2103169247102812334)
provided the ten-level weighted-probability idea and endpoint labels 5 and 100;
the intermediate descriptions and weights above are our preregistered choices.

Use `jev-latest`, require served `jev-1.13.0`, eight workers per query, sequential
queries, at most three explicit attempts, SDK retries off. Use a new empty cache
outside Git. A served model mismatch, changed frozen input, missing pair or
malformed distribution fails the run. The existing monoBERT passage manifest is
validated before any API calls. Run the repository smoke and MS MARCO contract
tests before inference.

The headline is graded nDCG@10 from `trec_eval -c -M1000`. Secondary metrics are
binary MAP, Rprec, P@10, bpref, recip_rank and recall with grades 2–3 relevant;
report candidate recall at 100 and 1,000 and per-query deltas. For the two
headline paired comparisons (Score versus Noul and Score versus monoBERT), use
10,000 bootstrap resamples for 95% mean-difference intervals and 100,000
two-sided sign randomizations (seed 88), with Holm adjustment. Report all
secondary metrics descriptively. A quality-improvement acceptance requires a
positive nDCG@10 difference versus Noul, positive paired 95% interval, adjusted
`p < 0.05`, and a justified measured time/cost tradeoff.

## Reproduce

With the downloaded files in ignored `.cache/msmarco-dl2019/`, the saved
monoBERT reference and credentials available, run:

```sh
.venv-monobert/bin/python reranking/msmarco.py jev-score \
  --results-dir reranking/results/msmarco-dl2019/jev-score \
  --cache .cache/msmarco-dl2019/jev-score \
  --input-usd-per-million 0.042 --output-usd-per-million 0 \
  --pricing-source 'https://typesafe.ai/blog/introducing-system-one-models-and-jev; verified 2026-09-25'
.venv-monobert/bin/python reranking/audit_msmarco.py --score-only
```

The rate above is a published estimate per million input tokens, with free
output; failed-request billing remains unknown. Retrieval time and local compute
cost are unknown. The result directory must be new. Caches and passage text
remain outside Git.
