#!/usr/bin/env python3
"""Prepare ignored local WSJ text for the simulator; never check output into Git."""
import argparse
import html
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "reranking"))
from jev import digest, documents  # noqa: E402

EVIDENCE = Path(__file__).resolve().parents[1] / "data" / "evidence.json"
OUTPUT = ROOT / ".cache" / "reranking-simulator" / "wsj-documents.json"


def headlines(collection, wanted):
    """Read only HL fields, preserving DOCNO association with the collection."""
    found = {}
    buffer = ""
    with collection.open(encoding="utf-8") as stream:
        while chunk := stream.read(1024 * 1024):
            buffer += chunk
            while "</DOC>" in buffer:
                record, buffer = buffer.split("</DOC>", 1)
                id_match = re.search(r"<DOCNO>\s*(.*?)\s*</DOCNO>", record, re.S)
                if not id_match:
                    continue
                docid = id_match.group(1).strip()
                if docid not in wanted:
                    continue
                heading = re.search(r"<HL>(.*?)</HL>", record, re.S)
                if heading:
                    clean = " ".join(html.unescape(re.sub(r"<[^>]*>", " ", heading.group(1))).split())
                    clean = re.split(r"\s+---+\s+By\s+", clean, maxsplit=1, flags=re.I)[0]
                    if clean:
                        found[docid] = clean
    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--collection", type=Path, required=True, help="absolute path to the local WSJ collection")
    args = parser.parse_args()
    if not args.collection.is_absolute() or not args.collection.is_file():
        parser.error("--collection must be an absolute path to a readable WSJ collection file")
    evidence = json.loads(EVIDENCE.read_text())
    wanted = {docid for query in evidence["queries"].values() for docid in query["before"]}
    extracted = documents(args.collection, wanted)
    headings = headlines(args.collection, wanted)
    for query in evidence["queries"].values():
        for docid, records in query["tasks"]["documents"]["scores"].items():
            if digest(extracted[docid]) != records[0]["payloadHash"]:
                raise ValueError(f"Collection text differs from completed JEV payload for {docid}")
    output = {docid: {"title": headings.get(docid) or docid, "text": text} for docid, text in extracted.items()}
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"Prepared {len(output)} local articles at {OUTPUT}; this path is ignored by Git")


if __name__ == "__main__":
    main()
