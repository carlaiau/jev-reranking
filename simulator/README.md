# Rerank Lab

A mobile-first Next.js replay of completed JEV reranking experiments. The lead route reorders the fixed WSJ BM25 **with feedback** top-100 candidate set using complete-document or passage-MaxP JEV scores. `/passages` compares the completed MS MARCO v1 / TREC DL 2019 JEV passage conditions against the local monoBERT reference ranking. No API requests are made during playback.

## Run locally

From `simulator/`:

```sh
npm ci
python3 scripts/build_evidence.py
python3 scripts/build_msmarco_evidence.py
python3 scripts/prepare_content.py --collection /absolute/path/to/wsj.xml
../.venv-monobert/bin/python scripts/prepare_passages.py
../.venv-monobert/bin/python scripts/prepare_msmarco_content.py
npm run dev
```

Open `http://localhost:3000`. The two `prepare_*` commands that use `.venv-monobert` require the tokenizer environment and cached `castorini/monobert-large-msmarco` revision described in [the reranking protocol](../reranking/jev-comparison.md). The MS MARCO preparation also requires the three local input downloads described in [the passage protocol](../reranking/msmarco.md). If those files are absent, the rankings and metrics still replay; passage/article text and full input payloads show an availability message.

The prepared text is written to `../.cache/reranking-simulator/`, which Git ignores. `SIMULATOR_CONTENT_DIR` can point the server to a different directory holding the same JSON files. Keep any WSJ or MS MARCO text on an appropriately licensed server; neither text nor response cache is packaged with the site.

## Evidence and scope

- `data/evidence.json` and `data/msmarco-evidence.json` contain IDs, ranks, judgments, recorded scores, usage, timing and metrics, without article or passage text. The scripts rebuild them from completed repository artifacts and validate candidate membership and scoring coverage.
- The local text preparation checks JEV payload hashes before serving content. The call inspector shows the saved request structure and recorded score/model/usage fields; it is a replay, not a fresh model response.
- WSJ query metrics evaluate the complete saved 1,000-result ranking. The UI shows ten rows while the first 100 are reranked. The fixed aggregate stage-1 MAP is 0.2521.
- MS MARCO v1 candidate file order is by passage ID and has no lexical-ranking meaning. The before view is the measured monoBERT ranking. Its primary metric is graded nDCG@10; binary metrics count grades 2–3 as relevant. Its retrieval time is unavailable.
- The default queries are illustrative examples selected for this teaching interface. They are not held-out evidence for tuning or claims that every query improves.

The UI controls use Catalyst components from the sibling `read-with-jev` project; the result lanes, metric board and motion are specific to this simulator.

## Checks

```sh
npm run typecheck
npm run build
```
