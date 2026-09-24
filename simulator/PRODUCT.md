# Reranking simulator

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js and Tailwind CSS, requested by the user. Reuse suitable Catalyst/Tailwind UI controls from the sibling JEV projects.

## Users

Technical people who understand search systems but are new to information retrieval evaluation. They want to see how reranking changes an already selected candidate set.

## Product Purpose

Let visitors inspect a fixed candidate set, human relevance judgments, the recorded JEV pointwise calls and scores, the reordered results, and the resulting retrieval metrics. The interface should make the cost and effect of spending compute after retrieval concrete.

## Positioning

An interactive replay of this repository's measured JEV experiments, with provenance and honest distinctions between candidate selection, monoBERT reference ranking, and JEV reranking.

## Operating Context

The primary demonstration is the fixed WSJ stage-1 BM25 ranking across 50 TREC topics, followed by recorded JEV complete-document reranking of its top-100 candidates. MS MARCO v1 / TREC DL 2019 is a secondary original-passage reranking comparison against the local monoBERT reference.

## Capabilities and Constraints

- Visitors choose a dataset and query to replay the saved initial ranking, inspect ranked results and human judgments, inspect the request shape and recorded JEV answer, then use Replay JEV to animate the rerank. WSJ shows names and redacted input excerpts; MS MARCO can show supplied passage text.
- Show measured metrics before and after. WSJ uses MAP as the headline metric, with P@10, Rprec, bpref and reciprocal rank. MS MARCO uses nDCG@10 as its headline metric.
- The WSJ stage-1 ranking is the fixed BM25 run. The MS MARCO supplied candidate file is ID sorted, not a lexical ranking; any before view for that task uses monoBERT and must say so.
- Never invent scores, judgments, content, timing or cost. Playback is local and makes no model calls.
- Collection text and response caches stay outside Git. Full WSJ article text never reaches browser responses.
- The WSJ interface uses complete-document JEV only. The MS MARCO interface uses the original supplied passage text only.
- Light mode is the default; dark mode is available from the header.
- Mobile web use is a primary requirement. Animations need a reduced-motion path.

## Evidence on Hand

- `stage1/results/integrated-main-20260918/` contains the immutable WSJ BM25 run, topics, qrels and metrics.
- `reranking/results/jev-full-documents-top100-20260918/` and `jev-passages-maxp-top100-20260918-retry/` contain JEV scores, runs, per-topic metrics, manifests and timing/cost evidence.
- The WSJ collection is locally available outside the repository and cannot be committed.
- `reranking/results/msmarco-dl2019/` contains the secondary candidate identities, monoBERT and JEV runs, per-query metrics, qrels, score records, manifests and audits. Its local ignored downloads contain query and passage text.

## Product Principles

- Let the ranking movement explain the system.
- Keep model output and human judgment visibly distinct.
- Label each comparison by its actual input, metric and measurement scope.
- Make every displayed number traceable to the completed run.
