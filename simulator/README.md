# Rerank Lab

A mobile-first Next.js replay of completed JEV reranking experiments. The lead route reorders the fixed WSJ BM25 **with feedback** top-100 candidate set using complete-document JEV scores. `/passages` replays the completed MS MARCO v1 / TREC DL 2019 experiment on every supplied candidate, comparing the saved monoBERT and original-text JEV rankings. Each page automatically plays the saved JEV rerank a few seconds after loading its initial results; choosing a query first replays its saved BM25 search or monoBERT reference load. The query selector stays at the top while scrolling, and Replay JEV starts the rerank again on demand. Both pages offer light and dark modes. Playback makes no live model calls.

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

Rebuilding WSJ and MS MARCO metric evidence requires `trec_eval` on `PATH`; the scripts write text-free metric artifacts from the saved runs and qrels. WSJ is evaluated at rank 100, while MS MARCO uses the full supplied lists of up to 1,000.

The prepared text is written to `../.cache/reranking-simulator/`, which Git ignores. `SIMULATOR_CONTENT_DIR` can point the server to a different directory holding the same JSON files. Keep any WSJ or MS MARCO text on an appropriately licensed server; neither text nor response cache is packaged with the site. The WSJ document API returns an article name, no article body, and at most a 100-character excerpt plus `[REDACTED_TOKENS N BERT source tokens sent]` for each call. This count comes from the saved document token length or passage window span; recorded API input tokens, which also include the query and question, are shown separately. The complete WSJ text never enters page props, API JSON, or the browser.

## Evidence and scope

- `data/evidence.json` and `data/msmarco-evidence.json` contain IDs, ranks, judgments, recorded scores, usage, timing and metrics, without article or passage text. The scripts rebuild them from completed repository artifacts and validate candidate membership and scoring coverage.
- Each dropdown shows 20 query examples spaced across the dataset's query IDs, including its default query. The WSJ and MS MARCO aggregate metrics still use all 50 and 43 queries respectively.
- The local text preparation checks JEV payload hashes. The WSJ call inspector shows a redacted request shape and recorded score/model/usage fields; MS MARCO displays the saved passage input. Both are replays, not fresh model responses.
- Each saved WSJ BM25 search has 1,000 results. JEV reranks positions 1–100 only; positions 101–1,000 keep their BM25 order, and the UI shows the top ten rows. WSJ query and aggregate metrics use `trec_eval -c -M100` on the saved run and qrels. nDCG@10 is 0.4640 → 0.6634 and MAP@100 is 0.1729 → 0.2263. Recall@100 is fixed at 0.3121 because the candidate set does not change. Judged@10, calculated from qrels for the displayed first ten results, is 0.8780 → 0.9000. The original full 1,000-result MAP values remain 0.2521 and 0.3055 in the experiment reports; these are different evaluation scopes.
- The WSJ corpus is the TREC-1 subset of TREC disks 1 and 2: 173,252 indexed articles across the 1987–1992 volumes, about 0.5 GB of source text. The simulator links to NIST collection statistics; no article body is bundled.
- The MS MARCO v1 corpus contains 8,841,823 passages drawn from millions of web pages. TREC DL 2019 supplied 1,000 candidates for 41 judged queries, and 37 and 5 for the other two, independently of monoBERT. The page replays the completed experiment on all 41,042 supplied query–passage pairs, comparing the saved monoBERT ranking with JEV on original passage text. The supplied candidate file is ID sorted, so it is not labeled BM25. The full JEV run took 1,575.1 seconds to rerank and its estimated successful-response API cost was $0.761; supplied-candidate retrieval time is unknown.
- MS MARCO nDCG@10 uses the original 0–3 grades with `trec_eval -m ndcg_cut.10` and no relevance threshold. MAP@1000 uses `-M1000 -l 2 -m map`; RR@10 uses `-M10 -l 2 -m recip_rank`. Recall@100 uses `-M1000 -l 2 -m recall.100` for both rankings; Recall@1000 uses `-M1000 -l 2 -m recall.1000` and appears once as the fixed candidate ceiling. Judged@10 counts any judged passage among the first ten, including grade 0 and grade 1. Across 43 queries, nDCG@10 is 0.7177 → 0.6835, MAP@1000 is 0.4488 → 0.4729, RR@10 is 0.8717 → 0.8446, Recall@100 is 0.5854 → 0.5980, Recall@1000 stays 0.6943, and Judged@10 is 0.9721 → 0.8628. Expanded rows show the JEV call directly, with the passage in the request shape.
- The default queries are illustrative examples selected for this teaching interface. They are not held-out evidence for tuning or claims that every query improves.

The UI controls use Catalyst components from the sibling `read-with-jev` project; the result lanes, metric board and motion are specific to this simulator.

## Checks

```sh
npm run typecheck
npm run build
node scripts/check_wsj_api.mjs # while the local server is running
```
