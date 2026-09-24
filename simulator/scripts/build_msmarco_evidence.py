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


def evaluate_run(qrels_path, runs):
    """Evaluate the supplied candidate rankings at their full 1,000-passage depth."""
    with TemporaryDirectory() as directory:
        run_path = Path(directory) / "supplied-candidates.trec"
        with run_path.open("w") as stream:
            for qid, order in runs.items():
                for rank, docid in enumerate(order, 1):
                    stream.write(f"{qid} Q0 {docid} {rank} {len(order) - rank + 1} supplied\n")
        measures = (
            (["-M1000", "-m", "ndcg_cut.10"], {"ndcg_cut_10": "ndcg_cut_10"}),
            (["-M1000", "-l", "2", "-m", "map", "-m", "recall.1000"], {"map": "map", "recall_1000": "recall_1000"}),
            (["-M1000", "-l", "2", "-m", "recall.100"], {"recall_100": "recall_100"}),
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
        expected = {"ndcg_cut_10", "map", "recall_100", "recall_1000", "rr_10", "judged_10"}
        if set(values) != set(runs) | {"all"} or any(set(row) != expected for row in values.values()):
            raise ValueError("Incomplete supplied-candidate evaluation")
        return {"all": values["all"], "queries": {qid: values[qid] for qid in runs}}


def main():
    before = read_run(BASE / "monobert/run.trec")
    supplied = {row["qid"]: set(row["passage_ids"]) for row in json.loads((BASE / "input/candidates.json").read_text())}
    if set(supplied) != set(before) or any(set(order) != supplied[qid] or len(order) > 1000 for qid, order in before.items()):
        raise ValueError("monoBERT run does not cover the supplied candidate lists")
    before_metrics = evaluate_run(BASE / "input/qrels-graded.txt", before)
    qrels = defaultdict(dict)
    for line in (BASE / "input/qrels-graded.txt").read_text().splitlines():
        qid, _, docid, grade = line.split()
        qrels[qid][docid] = int(grade)
    task_data = {}
    for key, directory in TASKS.items():
        task_data[key] = {
            "run": read_run(directory / "run.trec"),
            "scores": read_scores(directory / "scores.jsonl"),
            "times": {row["qid"]: row for row in json.loads((directory / "queries.json").read_text())},
            "manifest": json.loads((directory / "manifest.json").read_text()),
        }
        if set(task_data[key]["run"]) != set(before) or any(
            set(task_data[key]["run"][qid]) != supplied[qid] or set(task_data[key]["scores"][qid]) != supplied[qid]
            for qid in before
        ):
            raise ValueError(f"Saved {key} run does not score all supplied candidates")
        task_data[key]["metrics"] = evaluate_run(BASE / "input/qrels-graded.txt", task_data[key]["run"])
        if any(task_data[key]["metrics"]["queries"][qid]["recall_1000"] != before_metrics["queries"][qid]["recall_1000"] for qid in before):
            raise ValueError(f"Supplied-candidate recall changed during reranking for {key}")
    output = {
        "source": {
            "reference": "reranking/results/msmarco-dl2019/monobert",
            "matched": "reranking/results/msmarco-dl2019/jev-matched",
            "original": "reranking/results/msmarco-dl2019/jev-full",
            "queries": len(before),
            "defaultQuery": "1129237",
            "rerankDepth": 1000,
            "suppliedPairCount": sum(len(order) for order in before.values()),
        },
        "referenceMetrics": before_metrics["all"],
        "tasks": {},
        "queries": {},
    }
    for key, task in task_data.items():
        manifest = task["manifest"]
        output["tasks"][key] = {
            "label": "Matched text" if key == "matched" else "Original text",
            "description": "Decoded BERT passage text" if key == "matched" else "Complete supplied passage",
            "metrics": task["metrics"]["all"],
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
                "after": final,
                "beforeMetrics": before_metrics["queries"][qid],
                "afterMetrics": task["metrics"]["queries"][qid],
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
