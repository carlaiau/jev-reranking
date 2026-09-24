#!/usr/bin/env python3
"""Create text-free simulator evidence from the immutable WSJ runs."""
from collections import defaultdict
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parents[1] / "data" / "evidence.json"
BASE = ROOT / "stage1/results/integrated-main-20260918"
RESULTS = ROOT / "reranking/results"
TASKS = {
    "documents": RESULTS / "jev-full-documents-top100-20260918",
    "passages": RESULTS / "jev-passages-maxp-top100-20260918-retry",
}
METRICS = ("map", "P_10", "Rprec", "bpref", "recip_rank")


def load_run(path):
    runs = defaultdict(list)
    for line in path.read_text().splitlines():
        qid, _, docid, rank, *_ = line.split()
        runs[qid].append((int(rank), docid))
    return {qid: [docid for _, docid in sorted(rows)] for qid, rows in runs.items()}


def load_metrics(path):
    output = defaultdict(dict)
    for line in path.read_text().splitlines():
        name, qid, value = line.split()
        if name in METRICS and qid != "all":
            output[qid][name] = float(value)
    return output


def load_scores(path):
    scores = defaultdict(lambda: defaultdict(list))
    for line in path.read_text().splitlines():
        row = json.loads(line)
        response = row["response"]
        item = {
            "score": row["score"],
            "inputTokens": response["usage"]["input_tokens"],
            "outputTokens": response["usage"]["output_tokens"],
            "model": response["model"],
            "seconds": row["seconds"],
            "payloadCharacters": row["payload_characters"],
            "payloadHash": row["payload_text_sha256"],
            "cacheHit": row["cache_hit"],
        }
        for key in ("passage_index", "token_start", "token_end", "document_tokens"):
            if key in row:
                item[key] = row[key]
        scores[row["qid"]][row["docid"]].append(item)
    return scores


def main():
    topics = dict(line.strip().split(" ", 1) for line in (BASE / "topics.txt").read_text().splitlines())
    baseline = load_run(BASE / "run.trec")
    qrels = defaultdict(dict)
    for line in (BASE / "qrels.txt").read_text().splitlines():
        qid, _, docid, grade = line.split()
        qrels[qid][docid] = int(grade)

    task_data = {}
    for key, path in TASKS.items():
        task_data[key] = {
            "run": load_run(path / "run.trec"),
            "before": load_metrics(path / "stage1-per-topic.txt"),
            "after": load_metrics(path / "reranked-per-topic.txt"),
            "scores": load_scores(path / "scores.jsonl"),
            "times": {row["qid"]: row for row in json.loads((path / "queries.json").read_text())},
            "manifest": json.loads((path / "manifest.json").read_text()),
        }

    output = {
        "source": {
            "baseline": str(BASE.relative_to(ROOT)),
            "documents": str(TASKS["documents"].relative_to(ROOT)),
            "passages": str(TASKS["passages"].relative_to(ROOT)),
            "candidateCount": 1000,
            "rerankDepth": 100,
            "queries": len(topics),
            "defaultQuery": "65",
        },
        "tasks": {},
        "queries": {},
    }
    for key, task in task_data.items():
        manifest = task["manifest"]
        output["tasks"][key] = {
            "label": "Complete document" if key == "documents" else "Passage MaxP",
            "description": "One JEV call per article" if key == "documents" else "JEV scores saved passages; the highest score ranks the article",
            "metrics": manifest["metrics"],
            "calls": manifest["scoring_calls"],
            "rerankSeconds": manifest["rerank_seconds"],
            "estimatedCostUsd": manifest["estimated_uncached_api_cost_usd"],
            "queryP50Seconds": manifest["query_p50_seconds"],
            "model": manifest["models_returned"][0],
            "question": manifest["question"],
            "contentPolicy": manifest["content_policy"],
        }

    for qid, title in topics.items():
        original = baseline[qid]
        if len(original) != 1000:
            raise ValueError(f"Unexpected baseline depth for {qid}")
        candidate_set = set(original[:100])
        query = {
            "id": qid,
            "text": title,
            "before": original[:100],
            "judgments": {d: qrels[qid].get(d) for d in original[:100]},
            "tasks": {},
        }
        for key, task in task_data.items():
            final = task["run"][qid]
            # The reranker canonicalizes rounded lexical-score ties by document ID.
            # Tail membership is unchanged, although tied tail ranks can swap.
            if set(final[:100]) != candidate_set or set(final[100:]) != set(original[100:]):
                raise ValueError(f"Candidate set or tail membership mismatch for {key}/{qid}")
            if set(task["scores"][qid]) != candidate_set:
                raise ValueError(f"Score coverage mismatch for {key}/{qid}")
            query["tasks"][key] = {
                "after": final[:100],
                "beforeMetrics": task["before"][qid],
                "afterMetrics": task["after"][qid],
                "seconds": task["times"][qid]["seconds"],
                "calls": task["times"][qid]["scoring_calls"],
                "scores": {d: task["scores"][qid][d] for d in set(original[:12]) | set(final[:12])},
            }
        output["queries"][qid] = query

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(output, separators=(",", ":"), ensure_ascii=False) + "\n")
    print(f"Wrote {OUT} for {len(output['queries'])} queries; no article text included")


if __name__ == "__main__":
    main()
