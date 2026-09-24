# Rerank Lab

A mobile-first Next.js replay of completed JEV reranking experiments. The lead route reorders the fixed WSJ BM25 **with feedback** top-100 candidate set using complete-document JEV scores. `/passages` compares JEV on original MS MARCO v1 / TREC DL 2019 passage text against the local monoBERT reference ranking. Choosing a query replays its saved initial ranking; Replay JEV in the results table starts the reranking step. Both pages use one saved reranking strategy and offer light and dark modes. Playback makes no live model calls.

## Run locally

From `simulator/`:

```sh
npm ci
python3 scripts/build_evidence.py
python3 scripts/build_msmarco_evidence.py
python3 scripts/prepare_content.py --collection /absolute/path/to/wsj.xml
../.venv-monobert/bin/python scripts/prepare_msmarco_content.py
npm run dev
```

Open `http://localhost:3000`. The MS MARCO preparation uses the tokenizer environment and cached `castorini/monobert-large-msmarco` revision described in [the reranking protocol](../reranking/jev-comparison.md), plus the three local downloads described in [the passage protocol](../reranking/msmarco.md). If those files are absent, the rankings and metrics still replay; missing names and input previews show an availability message.

The prepared text is written to `../.cache/reranking-simulator/`, which Git ignores. `SIMULATOR_CONTENT_DIR` can point the server to a different directory holding the same JSON files. Keep any WSJ or MS MARCO text on an appropriately licensed server; neither text nor response cache is packaged with the site. The WSJ document API returns an article name, no article body, and at most a 100-character excerpt plus `[REDACTED_TOKENS N BERT source tokens sent]` for each call. This count comes from the saved document token length or passage window span; recorded API input tokens, which also include the query and question, are shown separately. The complete WSJ text never enters page props, API JSON, or the browser.

## Evidence and scope

- `data/evidence.json` and `data/msmarco-evidence.json` contain IDs, ranks, judgments, recorded scores, usage, timing and metrics, without article or passage text. The scripts rebuild them from completed repository artifacts and validate candidate membership and scoring coverage.
- The local text preparation checks JEV payload hashes. The WSJ call inspector shows a redacted request shape and recorded score/model/usage fields; MS MARCO displays the saved passage input. Both are replays, not fresh model responses.
- WSJ query metrics evaluate the complete saved 1,000-result ranking. The UI shows ten rows while the first 100 are reranked with complete-document JEV. The fixed aggregate stage-1 MAP is 0.2521.
- MS MARCO v1 candidate file order is by passage ID and has no lexical-ranking meaning. The before view is the measured monoBERT ranking; JEV receives the original supplied passage text. Its primary metric is graded nDCG@10; binary metrics count grades 2–3 as relevant. Its retrieval time is unavailable.
- The default queries are illustrative examples selected for this teaching interface. They are not held-out evidence for tuning or claims that every query improves.

The UI controls use Catalyst components from the sibling `read-with-jev` project; the result lanes, metric board and motion are specific to this simulator.

## Checks

```sh
npm run typecheck
npm run build
node scripts/check_wsj_api.mjs # while the local server is running
```
