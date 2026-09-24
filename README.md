# JEV Reranking Comparisons

Can JEV's zero-shot general “intelligence” match established specialist rerankers? We compare ranking quality, time and cost on fixed candidates, using
MS MARCO passage and document benchmarks, with TREC-1 WSJ as a transfer test.

The [interactive reranking simulator](simulator/README.md) replays the fixed WSJ lexical ranking and completed JEV scores, with a separate MS MARCO passage comparison. Collection text stays outside Git.

## Benchmark 1: MS MARCO v1 passage reranking (TREC DL 2019)

Rerank 41,042 supplied query–passage pairs across 43 judged queries, with no new
indexing or retrieval. The [TREC DL 2019 paper](https://trec.nist.gov/pubs/trec28/papers/OVERVIEW.DL.pdf)
defines NIST passage labels as 3: exact answer, 2: answer with limitations,
1: related but no answer, and 0: irrelevant. Our primary metric, nDCG@10, uses
all grades; MAP, P@10 and recip_rank treat only grades 2–3 as relevant.

### Results

| Method | Source | nDCG@10 | MAP | P@10 | recip_rank | Query median (reranking) | Estimated API cost (USD) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| BM25, no reranking (`bm25base_p`) | Paper, Table 4 | 0.5058 | 0.3013 | — | 0.7036 | — | — |
| monoBERT | Our local implementation | 0.7177 | 0.4488 | **0.6233** | 0.8717 | 22.46 s | $0 hosted API |
| JEV matched passage text | Our run | 0.6825 | **0.4748** | 0.6116 | 0.8594 | 37.46 s | $0.762991 |
| JEV original passage text | Our run | 0.6835 | 0.4729 | 0.6163 | 0.8447 | 38.08 s | $0.761027 |
| IDST BERT (`idst_bert_pr2`) | Paper, Table 4 | **0.7379** | 0.4565 | — | **0.8818** | — | — |
| TU Vienna neural (`TUW19-p3-re`) | Paper, Table 4 | 0.6746 | 0.4113 | — | 0.8568 | — | — |

Published rows come from [Table 4 of the TREC DL 2019 overview](https://trec.nist.gov/pubs/trec28/papers/OVERVIEW.DL.pdf#page=9)
and are historical references, not local reproductions or part of our paired
tests. BM25 is a separate full-retrieval baseline before reranking, not the
verified original ranking of our candidates. The two published neural runs are
classified as reranking; their exact candidate identity has not been audited
against our manifest. `recip_rank` uses the paper's NIST MRR,
not its separate MS MARCO MRR. P@10 is not reported there. Bold marks the highest
reported effectiveness value in each column among the displayed methods.

P@10 measures precision in the first ten results; recip_rank averages the
reciprocal rank of the first relevant result. Higher effectiveness is better;
lower time and cost are better. API costs are per complete run, not per query;
— means unavailable or not applicable. Local compute is not included in API cost.
Against our local monoBERT, JEV improves MAP but has lower observed nDCG@10.

See the [full results and audits](reranking/results/msmarco-dl2019/results.md).

### Methods and reproduction

- monoBERT was implemented and run locally in this repository using the pretrained
  `castorini/monobert-large-msmarco` checkpoint; we did not retrain the model.
- JEV matched passage text uses the decoded token windows supplied to monoBERT.
- JEV original passage text uses the dataset passage with its original casing
  and spacing, not its source article.

All passages fit one BERT window, so this run compares text normalization rather
than context coverage. MS MARCO is monoBERT's training domain; JEV's training
exposure is unknown.

Matching windows controls JEV's advantage of seeing a long article at once.
The WSJ experiment below separately compares matched windows with full articles.
Pairwise JEV is deferred for this passage benchmark; no original duoBERT
checkpoint result is claimed here. Benchmark 2 tests larger document windows.

See the [protocol and commands](reranking/msmarco.md) and
[frozen input manifest](reranking/results/msmarco-dl2019/input/manifest.json).
Reports retain raw evaluations, model versions, timing and usage. Dataset text,
model downloads, credentials and response caches stay outside Git.

## Benchmark 2: MS MARCO v2 document reranking (TREC DL 2021)

Rerank the official top 100 documents for each of 57 judged queries: 5,700
query–document pairs, covering 5,679 unique documents. JEV scores overlapping
windows that cover the complete title, headings and body, then uses each
document's highest window score (MaxP). No new retrieval or indexing is needed.
Document grades 1–3 count as relevant for MAP, P@10 and recip_rank; nDCG@10 uses
all grades. These labels and queries differ from Benchmark 1.

**JEV achieves MAP 0.2790 and P@10 0.8930**, up from 0.2126 and 0.6684 for the
supplied ranking. Its observed scores also exceed the three selected published
references below; those comparisons are descriptive, without paired significance
tests against the published systems.

| Method | Evidence | nDCG@10 | MAP | P@10 | recip_rank | Query median (reranking) | Estimated API cost (USD) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **JEV large-window MaxP** | Measured | **0.7535** | **0.2790** | **0.8930** | **1.0000** | 4.81 s | $1.762336 |
| PASH `pash_doc_r3` | Published | 0.7164 | 0.2672 | 0.8526 | 0.9772 | — | — |
| BERT `CIP_run2` | Published | 0.6783 | 0.2478 | 0.8140 | 0.9373 | — | — |
| BERT MaxP `CIP_run3` | Published | 0.6668 | 0.2457 | 0.8175 | 0.9567 | — | — |
| Supplied ranking | Locally evaluated | 0.5116 | 0.2126 | 0.6684 | 0.8367 | — | — |

Published references come from the [TREC 2021 overview, Table 2](https://www.microsoft.com/en-us/research/uploads/prod/2022/05/trec2021-deeplearning-overview-final.pdf)
and official NIST summaries for [PASH](https://pages.nist.gov/trec-browser/trec30/deep/results/#pash_doc_r3),
[BERT](https://pages.nist.gov/trec-browser/trec30/deep/results/#cip_run2), and
[BERT MaxP](https://pages.nist.gov/trec-browser/trec30/deep/results/#cip_run3).
PASH is a multistage ensemble; the BERT runs use different training and passage
aggregation. These are published systems, not locally reproduced checkpoints.

The primary paired comparison against the supplied ranking improves nDCG@10 by
0.2419. A recip_rank of 1.0000 means the first result is relevant for every query, not
that every result has the highest relevance grade. JEV training exposure is unknown.
See the [full results and audit](reranking/results/msmarco-v2-dl2021-documents/results.md)
and [protocol and reproduction](reranking/msmarco-v2-documents.md).

## Transfer benchmark: WSJ document reranking

This uses the TREC-1 WSJ collection and 50 topics, with our own JASSjr-derived
BM25 and query-expansion retrieval step. Its saved candidates and stage-1
MAP 0.2521 baseline are fixed. Scores are separate from the passage benchmark.

| Method | MAP | P@10 | recip_rank | Query median (reranking) | Estimated API cost (USD) |
| --- | ---: | ---: | ---: | ---: | ---: |
| [JEV complete document](reranking/results/jev-full-documents-top100-20260918/results.md) | **0.3055** | **0.6340** | 0.8063 | 4.02 s | $0.328312 |
| [JEV passage MaxP](reranking/results/jev-passages-maxp-top100-20260918-retry/results.md) | 0.3053 | 0.6000 | **0.8457** | 14.98 s | $0.605227 |
| [monoBERT passage MaxP](reranking/results/monobert-maxp-top100-20260918/results.md) | 0.2693 | 0.4960 | 0.6715 | 30.27 s | $0 hosted API |
| [Stage 1: BM25 + query expansion](stage1/results/integrated-main-20260918/results.md) | 0.2521 | 0.4460 | 0.6271 | — | — |

Pointwise methods rerank the top 100 documents. Passage MaxP gives JEV and
monoBERT identical windows and uses each document's highest passage score.
Both cover the article across windows; only complete-document JEV sees it all
in one call.

See the
[paired report](reranking/results/jev-comparison-20260918.md) and
[implementation](reranking/jev-comparison.md) for usage and timing details.

The [stage-1 baseline](stage1/README.md) is lexical, with no dense retrieval or
reranking. Five-run medians are 11.03 s indexing and 0.41 s search for all 50
topics. Stage 2 reuses its saved candidates and index; see the
[reranking methodology](reranking/README.md) and [research program](program.md).
Changes to `main` do not replace the fixed baseline; original archives remain
read-only history.

## Inspiration and provenance

The experiment workflow draws on 
- [karpathy/autoresearch](https://github.com/karpathy/autoresearch)
(MIT); 
- the WSJ retrieval engine derives from [andrewtrotman/JASSjr](https://github.com/andrewtrotman/JASSjr)
(BSD-2-Clause).

This project is MIT-licensed except for upstream-derived code
under its respective licenses. See [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
