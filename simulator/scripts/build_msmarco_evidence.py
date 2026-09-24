#!/usr/bin/env python3
"""Create a text-free replay of the completed TREC DL 2019 passage runs."""
from collections import defaultdict
import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory

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


def evaluate_projection(qrels_path, runs):
    """Evaluate a saved-score projection over monoBERT's first 100 candidates."""
    with TemporaryDirectory() as directory:
        run_path = Path(directory) / "projection.trec"
        with run_path.open("w") as stream:
            for qid, order in runs.items():
                for rank, docid in enumerate(order, 1):
                    stream.write(f"{qid} Q0 {docid} {rank} {len(order) - rank + 1} projection\n")
        measures = (
            (["-M100", "-m", "ndcg_cut.10"], {"ndcg_cut_10": "ndcg_cut_10"}),
            (["-M100", "-l", "2", "-m", "map", "-m", "recall.100"], {"map": "map", "recall_100": "recall_100"}),
            (["-M10", "-l", "2", "-m", "recip_rank"], {"recip_rank": "rr_10"}),
        )
        values = defaultdict(dict)
        for flags, names in measures:
            result = subprocess.run(["trec_eval", "-c", "-q", *flags, str(qrels_path), str(run_path)], check=True, capture_output=True, text=True)
            for line in result.stdout.splitlines():
                name, qid, value = line.split()
                if name in names:
                    values[qid][names[name]] = float(value)
        judged = defaultdict(set)
        for line in qrels_path.read_text().splitlines():
            qid, _, docid, grade = line.split()
            if int(grade) >= 0:
                judged[qid].add(docid)
        for qid, order in runs.items():
            values[qid]["judged_10"] = sum(docid in judged[qid] for docid in order[:10]) / 10
        values["all"]["judged_10"] = round(sum(values[qid]["judged_10"] for qid in runs) / len(runs), 4)
        expected = {"ndcg_cut_10", "map", "recall_100", "rr_10", "judged_10"}
        if set(values) != set(runs) | {"all"} or any(set(row) != expected for row in values.values()):
            raise ValueError("Incomplete top-100 projection evaluation")
        return {"all": values["all"], "queries": {qid: values[qid] for qid in runs}}


def main():
    before = read_run(BASE / "monobert/run.trec")
    shortlist = {qid: order[:100] for qid, order in before.items()}
    before_metrics = evaluate_projection(BASE / "input/qrels-graded.txt", shortlist)
    qrels = defaultdict(dict)
    for line in (BASE / "input/qrels-graded.txt").read_text().splitlines():
        qid, _, docid, grade = line.split()
        qrels[qid][docid] = int(grade)
    task_data = {}
    for key, directory in TASKS.items():
        task_data[key] = {
            "run": read_run(directory / "run.trec"),
            "scores": read_scores(directory / "scores.jsonl"),
            "manifest": json.loads((directory / "manifest.json").read_text()),
        }
        projected = {qid: [docid for docid in task_data[key]["run"][qid] if docid in set(shortlist[qid])] for qid in before}
        if any(set(projected[qid]) != set(shortlist[qid]) for qid in before):
            raise ValueError(f"Projected candidate set changed for {key}")
        task_data[key]["projected"] = projected
        task_data[key]["projected_metrics"] = evaluate_projection(BASE / "input/qrels-graded.txt", projected)
        if any(task_data[key]["projected_metrics"]["queries"][qid]["recall_100"] != before_metrics["queries"][qid]["recall_100"] for qid in before):
            raise ValueError(f"Top-100 recall changed during reranking for {key}")
    output = {
        "source": {
            "reference": "reranking/results/msmarco-dl2019/monobert",
            "matched": "reranking/results/msmarco-dl2019/jev-matched",
            "original": "reranking/results/msmarco-dl2019/jev-full",
            "queries": len(before),
            "defaultQuery": "1129237",
            "rerankDepth": 100,
            "suppliedPairCount": sum(len(order) for order in before.values()),
            "projection": "Saved JEV scores filtered to monoBERT's first 100 candidates per query",
        },
        "referenceMetrics": before_metrics["all"],
        "tasks": {},
        "queries": {},
    }
    for key, task in task_data.items():
        manifest = task["manifest"]
        projected_calls = sum(len(order) for order in shortlist.values())
        projected_input_tokens = sum(task["scores"][qid][docid][0]["inputTokens"] for qid, order in shortlist.items() for docid in order)
        price_per_input_token = manifest["estimated_uncached_api_cost_usd"] / manifest["all_response_tokens"]["input_tokens"]
        output["tasks"][key] = {
            "label": "Matched text" if key == "matched" else "Original text",
            "description": "Decoded BERT passage text" if key == "matched" else "Complete supplied passage",
            "metrics": task["projected_metrics"]["all"],
            "calls": projected_calls,
            "rerankSeconds": None,
            "estimatedCostUsd": projected_input_tokens * price_per_input_token,
            "queryP50Seconds": None,
            "fullRun": {
                "calls": manifest["scoring_calls"],
                "rerankSeconds": manifest["rerank_seconds"],
                "estimatedCostUsd": manifest["estimated_uncached_api_cost_usd"],
                "metrics": manifest["metrics"],
            },
            "model": manifest["models_returned"][0],
            "question": manifest["question"],
            "contentPolicy": manifest["content_policy"],
        }
    for qid, original in before.items():
        if not original:
            raise ValueError(f"Empty monoBERT ranking for {qid}")
        query = {"id": qid, "before": shortlist[qid], "judgments": {}, "tasks": {}}
        for key, task in task_data.items():
            final = task["run"][qid]
            if set(final) != set(original) or set(task["scores"][qid]) != set(original):
                raise ValueError(f"Candidate or score coverage differs for {qid}/{key}")
            projected = task["projected"][qid]
            selected = set(shortlist[qid][:12]) | set(projected[:12])
            query["tasks"][key] = {
                "after": projected,
                "beforeMetrics": before_metrics["queries"][qid],
                "afterMetrics": task["projected_metrics"]["queries"][qid],
                "seconds": None,
                "calls": len(shortlist[qid]),
                "scores": {docid: task["scores"][qid][docid] for docid in selected},
            }
            query["judgments"].update({docid: qrels[qid].get(docid) for docid in selected})
        output["queries"][qid] = query
    OUT.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"Wrote {OUT} for {len(output['queries'])} queries; no passage or query text included")


if __name__ == "__main__":
    main()
