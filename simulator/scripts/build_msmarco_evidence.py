#!/usr/bin/env python3
"""Create a text-free replay of the completed TREC DL 2019 passage runs."""
from collections import defaultdict
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / "reranking/results/msmarco-dl2019"
OUT = Path(__file__).resolve().parents[1] / "data" / "msmarco-evidence.json"
TASKS = {"matched": BASE / "jev-matched", "original": BASE / "jev-full"}


def read_run(path):
    runs = defaultdict(list)
    for line in path.read_text().splitlines():
        qid, _, docid, rank, *_ = line.split()
        runs[qid].append((int(rank), docid))
    return {qid: [docid for _, docid in sorted(rows)] for qid, rows in runs.items()}


def read_scores(path):
    scores = defaultdict(dict)
    for line in path.read_text().splitlines():
        row = json.loads(line)
        response = row["response"]
        record = {
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
                record[key] = row[key]
        scores[row["qid"]][row["docid"]] = [record]
    return scores


def main():
    before = read_run(BASE / "monobert/run.trec")
    before_metrics = json.loads((BASE / "monobert/metrics-per-query.json").read_text())
    qrels = defaultdict(dict)
    for line in (BASE / "input/qrels-graded.txt").read_text().splitlines():
        qid, _, docid, grade = line.split()
        qrels[qid][docid] = int(grade)
    task_data = {}
    for key, directory in TASKS.items():
        task_data[key] = {
            "run": read_run(directory / "run.trec"),
            "metrics": json.loads((directory / "metrics-per-query.json").read_text()),
            "scores": read_scores(directory / "scores.jsonl"),
            "times": {row["qid"]: row for row in json.loads((directory / "queries.json").read_text())},
            "manifest": json.loads((directory / "manifest.json").read_text()),
        }
    output = {
        "source": {
            "reference": "reranking/results/msmarco-dl2019/monobert",
            "matched": "reranking/results/msmarco-dl2019/jev-matched",
            "original": "reranking/results/msmarco-dl2019/jev-full",
            "queries": len(before),
            "defaultQuery": "1129237",
            "rerankDepth": 1000,
        },
        "referenceMetrics": json.loads((BASE / "monobert/manifest.json").read_text())["metrics"],
        "tasks": {},
        "queries": {},
    }
    for key, task in task_data.items():
        manifest = task["manifest"]
        output["tasks"][key] = {
            "label": "Matched text" if key == "matched" else "Original text",
            "description": "Decoded BERT passage text" if key == "matched" else "Complete supplied passage",
            "metrics": manifest["metrics"],
            "calls": manifest["scoring_calls"],
            "rerankSeconds": manifest["rerank_seconds"],
            "estimatedCostUsd": manifest["estimated_uncached_api_cost_usd"],
            "queryP50Seconds": manifest["query_p50_seconds"],
            "model": manifest["models_returned"][0],
            "question": manifest["question"],
            "contentPolicy": manifest["content_policy"],
        }
    for qid, original in before.items():
        if not original:
            raise ValueError(f"Empty monoBERT ranking for {qid}")
        query = {"id": qid, "before": original, "judgments": {}, "tasks": {}}
        for key, task in task_data.items():
            final = task["run"][qid]
            if set(final) != set(original) or set(task["scores"][qid]) != set(original):
                raise ValueError(f"Candidate or score coverage differs for {qid}/{key}")
            selected = set(original[:12]) | set(final[:12])
            query["tasks"][key] = {
                "after": final[:12],
                "beforeMetrics": before_metrics[qid],
                "afterMetrics": task["metrics"][qid],
                "seconds": task["times"][qid]["seconds"],
                "calls": task["times"][qid]["scoring_calls"],
                "scores": {docid: task["scores"][qid][docid] for docid in selected},
            }
            query["judgments"].update({docid: qrels[qid].get(docid) for docid in selected})
        output["queries"][qid] = query
    OUT.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"Wrote {OUT} for {len(output['queries'])} queries; no passage or query text included")


if __name__ == "__main__":
    main()
