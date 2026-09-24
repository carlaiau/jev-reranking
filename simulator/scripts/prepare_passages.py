#!/usr/bin/env python3
"""Reconstruct exact scored WSJ windows into an ignored local cache."""
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "reranking"))
from jev import digest  # noqa: E402
from monobert import MODEL, REVISION  # noqa: E402

from transformers import BertTokenizerFast

EVIDENCE = Path(__file__).resolve().parents[1] / "data" / "evidence.json"
CONTENT = ROOT / ".cache" / "reranking-simulator" / "wsj-documents.json"
OUTPUT = ROOT / ".cache" / "reranking-simulator" / "wsj-passages.json"


def main():
    evidence = json.loads(EVIDENCE.read_text())
    docs = json.loads(CONTENT.read_text())
    tokenizer = BertTokenizerFast.from_pretrained(
        MODEL,
        revision=REVISION,
        cache_dir=ROOT / ".cache" / "monobert-model",
        local_files_only=True,
    )
    result = {}
    token_cache = {}
    count = 0
    for qid, query in evidence["queries"].items():
        result[qid] = {}
        for docid, records in query["tasks"]["passages"]["scores"].items():
            if docid not in token_cache:
                token_cache[docid] = tokenizer.encode(
                    docs[docid]["text"], add_special_tokens=False, truncation=False, verbose=False
                )
            tokens = token_cache[docid]
            passages = {}
            for record in records:
                if len(tokens) != record["document_tokens"]:
                    raise ValueError(f"Token count mismatch for {qid}/{docid}")
                segment = tokens[record["token_start"]:record["token_end"]]
                payload = tokenizer.decode(
                    segment, skip_special_tokens=False, clean_up_tokenization_spaces=False
                )
                if digest(payload) != record["payloadHash"]:
                    raise ValueError(f"Passage payload hash mismatch for {qid}/{docid}")
                passages[str(record["passage_index"])] = payload
                count += 1
            result[qid][docid] = passages
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"Reconstructed {count} verified JEV passage payloads at {OUTPUT}; this path is ignored by Git")


if __name__ == "__main__":
    main()
