#!/usr/bin/env python3
"""Cache source passage and exact scored JEV payload text outside Git."""
import gzip
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "reranking"))
from jev import digest  # noqa: E402
from monobert import MODEL, REVISION  # noqa: E402
from transformers import BertTokenizerFast  # noqa: E402

EVIDENCE = Path(__file__).resolve().parents[1] / "data" / "msmarco-evidence.json"
INPUT = ROOT / ".cache" / "msmarco-dl2019"
OUTPUT = ROOT / ".cache" / "reranking-simulator" / "msmarco-content.json"


def main():
    evidence = json.loads(EVIDENCE.read_text())
    wanted = {docid for query in evidence["queries"].values() for task in query["tasks"].values() for docid in task["scores"]}
    queries = {}
    with gzip.open(INPUT / "queries.tsv.gz", "rt", encoding="utf-8") as stream:
        for line in stream:
            qid, text = line.rstrip("\r\n").split("\t", 1)
            if qid in evidence["queries"]:
                queries[qid] = text
    if set(queries) != set(evidence["queries"]):
        raise ValueError("Missing query text")
    passages = {}
    with gzip.open(INPUT / "candidates.tsv.gz", "rt", encoding="utf-8") as stream:
        for line in stream:
            qid, docid, query_text, passage = line.rstrip("\r\n").split("\t", 3)
            if docid not in wanted:
                continue
            if qid in queries and queries[qid] != query_text:
                raise ValueError(f"Query mismatch for {qid}/{docid}")
            if docid in passages and passages[docid] != passage:
                raise ValueError(f"Conflicting passage text for {docid}")
            passages[docid] = passage
    if set(passages) != wanted:
        raise ValueError(f"Missing {len(wanted - set(passages))} wanted passages")
    tokenizer = BertTokenizerFast.from_pretrained(
        MODEL, revision=REVISION, cache_dir=ROOT / ".cache" / "monobert-model", local_files_only=True
    )
    matched = {}
    for qid, query in evidence["queries"].items():
        matched[qid] = {}
        for task_id, task in query["tasks"].items():
            for docid, records in task["scores"].items():
                record = records[0]
                original = passages[docid]
                if task_id == "original":
                    if digest(original) != record["payloadHash"]:
                        raise ValueError(f"Original JEV payload mismatch for {qid}/{docid}")
                    continue
                tokens = tokenizer.encode(original, add_special_tokens=False, truncation=False, verbose=False)
                if len(tokens) != record["document_tokens"]:
                    raise ValueError(f"Token count mismatch for {qid}/{docid}")
                segment = tokens[record["token_start"]:record["token_end"]]
                decoded = tokenizer.decode(segment, skip_special_tokens=False, clean_up_tokenization_spaces=False)
                if digest(decoded) != record["payloadHash"]:
                    raise ValueError(f"Matched JEV payload mismatch for {qid}/{docid}")
                matched[qid][docid] = decoded
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps({"queries": queries, "passages": passages, "matched": matched}, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"Prepared {len(passages)} source passages and verified JEV payloads at {OUTPUT}; ignored by Git")


if __name__ == "__main__":
    main()
