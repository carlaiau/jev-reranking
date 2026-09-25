#!/usr/bin/env python3
"""Paired JEV experiments: saved monoBERT windows with MaxP, or complete articles."""
import argparse
from datetime import datetime, timezone
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
import importlib.metadata
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import threading
import time

from jev import QUESTION, atomic_write, digest, documents, load_env, read_run, render_run, validate_response
from monobert import CANONICAL, MODEL, REVISION, coverage, percentile, windows
from run import accounting
from stage_artifacts import ROOT, evaluate, provenance, report, sha

MONO = ROOT / 'reranking/results/monobert-maxp-top100-20260918'
PRICE_SOURCE = 'https://typesafe.ai/blog/introducing-system-one-models-and-jev (published 2026-09-15; verified 2026-09-18)'


def prepare(mode, runs, queries, docs, mono, tokenizer):
    """Validate every saved interval before any API request; never rechunk silently."""
    manifest = json.loads((mono / 'manifest.json').read_text())
    if manifest['model_revision'] != REVISION or manifest['tokenizer_revision'] != REVISION:
        raise ValueError('unexpected reference tokenizer')
    top_k = manifest['top_k']
    expected = {(q, row[0]) for q, rows in runs.items() for row in rows[:top_k]}
    saved = defaultdict(list)
    for line in (mono / 'passages.jsonl').read_text().splitlines():
        r = json.loads(line)
        saved[r['qid'], r['docid']].append(r)
    if set(saved) != expected:
        raise ValueError('reference passages do not match candidate pairs')
    tokens = {d: tokenizer.encode(t, add_special_tokens=False, truncation=False, verbose=False) for d, t in docs.items()}
    qtokens = {q: tokenizer.encode(t, add_special_tokens=False, truncation=False, verbose=False) for q, t in queries.items()}
    tasks = defaultdict(list)
    for q, rows in runs.items():
        for d, _, _ in rows[:top_k]:
            ids = tokens[d]
            records = saved[q, d]
            cap = min(manifest['passage_tokens'], manifest['model_input_limit'] - len(qtokens[q]) - tokenizer.num_special_tokens_to_add(pair=True))
            spans = list(windows(len(ids), cap, min(manifest['overlap_tokens'], cap - 1)))
            if [(r['token_start'], r['token_end']) for r in records] != spans:
                raise ValueError('reference passage boundary mismatch')
            coverage(spans, len(ids))
            if any(r['document_tokens'] != len(ids) or r['passage_index'] != i for i, r in enumerate(records)):
                raise ValueError('reference document length/index mismatch')
            if mode == 'documents':
                tasks[q].append({'qid': q, 'docid': d, 'text': docs[d], 'document_tokens': len(ids), 'document_characters': len(docs[d])})
            else:
                for r in records:
                    part = ids[r['token_start']:r['token_end']]
                    text = tokenizer.decode(part, skip_special_tokens=False, clean_up_tokenization_spaces=False)
                    if not text:
                        raise ValueError('empty decoded passage')
                    tasks[q].append({k: r[k] for k in ('qid', 'docid', 'passage_index', 'token_start', 'token_end', 'document_tokens', 'newly_covered_tokens')} | {'text': text, 'bert_token_ids_sha256': digest(part)})
    return tasks


class Service:
    """SDK retries disabled; each explicit attempt is counted and journaled."""
    def __init__(self, args, destination, client=None):
        self.args, self.destination = args, destination
        self.lock = threading.Lock()
        self.rows, self.attempts = [], []
        self.endpoint = os.environ.get('TYPESAFE_ENDPOINT')
        self.client = client
        if self.client is None and not args.cache_only:
            import msgspec
            from typesafe_sdk import TypeSafeClient, RetryPolicy
            self.client = TypeSafeClient(api_key=os.environ['TYPESAFE_API_KEY'], base_url=self.endpoint,
                                       timeout=120.0, retry=RetryPolicy(max_retries=0))
        self.args.cache.mkdir(parents=True, exist_ok=True)
        (self.destination / 'attempts.jsonl').touch(exist_ok=True)

    def journal(self, name, row, target):
        with self.lock:
            target.append(row)
            with (self.destination / name).open('a') as out:
                out.write(json.dumps(row, sort_keys=True) + '\n')
                out.flush()

    def score(self, task, query):
        start = time.perf_counter()
        validator = getattr(self.args, 'response_validator', validate_response)
        identity = {k: v for k, v in task.items() if k != 'text'}
        payload = {'model': self.args.model,
                   'state': {'query': query, getattr(self.args, 'state_field', 'candidate_article'): task['text']},
                   'questions': {'relevant': getattr(self.args, 'question', QUESTION)}}
        key = digest({'endpoint': self.endpoint, 'mode': self.args.mode, 'identity': identity, 'payload': payload})
        path = self.args.cache / (key + '.json')
        hit = path.exists()
        if hit:
            response = json.loads(path.read_text())
        else:
            if self.args.cache_only:
                raise RuntimeError('missing cached response')
            for attempt in range(1, self.args.max_attempts + 1):
                call_start = time.perf_counter()
                event = {'qid': task['qid'], 'docid': task['docid'], 'passage_index': task.get('passage_index'), 'cache_key': key, 'attempt': attempt, 'started_at_utc': datetime.now(timezone.utc).isoformat()}
                try:
                    import msgspec
                    response = msgspec.to_builtins(self.client.system_one(**payload))
                    validator(response)
                except Exception as error:
                    status = getattr(error, 'status', getattr(error, 'status_code', None))
                    event.update(status='failed', error_type=type(error).__name__, http_status=status, seconds=time.perf_counter()-call_start)
                    self.journal('attempts.jsonl', event, self.attempts)
                    retryable = status == 429 or (isinstance(status, int) and status >= 500) or isinstance(error, (ConnectionError, TimeoutError))
                    if attempt == self.args.max_attempts or not retryable:
                        raise
                    retry_after = getattr(error, 'retry_after_ms', None)
                    time.sleep(max(min(2 ** attempt, 8), (retry_after / 1000) if retry_after is not None else 0))
                else:
                    event.update(status='success', seconds=time.perf_counter()-call_start)
                    self.journal('attempts.jsonl', event, self.attempts)
                    atomic_write(path, json.dumps(response, sort_keys=True) + '\n')
                    break
        score = validator(response)
        if self.args.expected_model and response['model'] != self.args.expected_model:
            raise ValueError('served model changed')
        row = {**identity, 'payload_text_sha256': digest(task['text']), 'payload_characters': len(task['text']), 'cache_key': key,
               'score': score, 'cache_hit': hit, 'seconds': time.perf_counter()-start,
               'response': {'model': response['model'], 'usage': response.get('usage', {})}}
        details = getattr(self.args, 'answer_details', None)
        if details is not None:
            row['answer_details'] = details(response)
        self.journal('scores.jsonl', row, self.rows)
        return row

    def close(self):
        if self.client is not None:
            self.client.close()


def score_query(service, tasks, query, workers):
    # At most workers calls in flight; stop replenishing immediately on failure.
    results = []
    it = iter(tasks)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        pending = {pool.submit(service.score, task, query) for task in [next(it, None) for _ in range(workers)] if task is not None}
        try:
            while pending:
                done, pending = wait(pending, return_when=FIRST_COMPLETED)
                values = [f.result() for f in done]
                results.extend(values)
                for _ in done:
                    task = next(it, None)
                    if task is not None:
                        pending.add(pool.submit(service.score, task, query))
        except BaseException:
            for future in pending:
                future.cancel()
            raise
    return results


def paired(source, destination, runs, top_k):
    for label, run in [('stage1', source/'run.trec'), ('reranked', destination/'run.trec')]:
        with (destination/f'{label}-per-topic.txt').open('w') as out:
            subprocess.run(['trec_eval', '-q', '-c', '-M1000', str(source/'qrels.txt'), str(run)], stdout=out, check=True)
    def ap(path):
        return {q: float(v) for m,q,v in map(str.split,path.read_text().splitlines()) if m == 'map' and q != 'all'}
    a, b = ap(destination/'stage1-per-topic.txt'), ap(destination/'reranked-per-topic.txt')
    rel = defaultdict(set)
    for line in (source/'qrels.txt').read_text().splitlines():
        q,_,d,r = line.split()
        if int(r)>0:
            rel[q].add(d)
    rows = [{'qid': q, 'stage1_ap': a[q], 'reranked_ap': b[q], 'ap_delta': round(b[q]-a[q],4),
             'candidate_recall_at_k': len({r[0] for r in runs[q][:top_k]} & rel[q])/len(rel[q]) if rel[q] else 0.0} for q in a]
    result = {'ap_improved': sum(r['ap_delta']>0 for r in rows), 'ap_worse': sum(r['ap_delta']<0 for r in rows),
              'ap_tied': sum(r['ap_delta']==0 for r in rows), 'mean_candidate_recall_at_k': sum(r['candidate_recall_at_k'] for r in rows)/len(rows), 'per_query': rows}
    atomic_write(destination/'paired-analysis.json', json.dumps(result, indent=2)+'\n')
    return {k:v for k,v in result.items() if k != 'per_query'}


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--mode', choices=['passages','documents'], required=True)
    p.add_argument('--stage1', type=Path, default=CANONICAL)
    p.add_argument('--monobert', type=Path, default=MONO)
    p.add_argument('--collection', type=Path)
    p.add_argument('--results-dir', type=Path, required=True)
    p.add_argument('--cache', type=Path, required=True)
    p.add_argument('--cache-only', action='store_true')
    p.add_argument('--workers', type=int, default=8)
    p.add_argument('--max-attempts', type=int, default=3)
    p.add_argument('--model', default='jev-latest')
    p.add_argument('--expected-model')
    p.add_argument('--input-usd-per-million', type=float)
    p.add_argument('--output-usd-per-million', type=float)
    p.add_argument('--pricing-source')
    args = p.parse_args(argv)
    rates = args.input_usd_per_million, args.output_usd_per_million
    if any(x is not None for x in rates) and (not all(x is not None and math.isfinite(x) and x >= 0 for x in rates) or not args.pricing_source):
        p.error('both finite non-negative rates and pricing source required')
    if min(args.workers, args.max_attempts) <= 0:
        p.error('positive workers/attempts required')
    start = time.perf_counter()
    started_at_utc = datetime.now(timezone.utc).isoformat()
    load_env(ROOT)
    if not args.cache_only and not os.environ.get('TYPESAFE_API_KEY'):
        p.error('TYPESAFE_API_KEY missing')
    source, mono = args.stage1.resolve(), args.monobert.resolve()
    baseline = json.loads((source/'manifest.json').read_text())
    reference = json.loads((mono/'manifest.json').read_text())
    if baseline.get('status') != 'complete' or baseline.get('stage') != 'stage1' or reference.get('status') != 'complete':
        p.error('completed reference manifests required')
    for filename, key in [('run.trec','run_sha256'),('topics.txt','topics_sha256'),('qrels.txt','qrels_sha256')]:
        if sha(source/filename) != baseline[key]:
            p.error('stage-1 hash mismatch')
    if reference['stage1_run_sha256'] != baseline['run_sha256'] or reference['stage1_manifest_sha256'] != sha(source/'manifest.json'):
        p.error('monoBERT used a different baseline')
    collection = args.collection or Path(baseline['collection'])
    if sha(collection) != baseline['collection_sha256']:
        p.error('collection hash mismatch')
    context = provenance()
    if context['branch'] == 'original':
        p.error('original is read-only')
    dest = args.results_dir.resolve()
    dest.mkdir(parents=True, exist_ok=False)
    service = None
    try:
        rerank_start = time.perf_counter()
        runs = read_run(source/'run.trec')
        queries = dict(line.split(maxsplit=1) for line in (source/'topics.txt').read_text().splitlines() if line.strip())
        if runs.keys() != queries.keys():
            raise ValueError('query IDs differ')
        top_k = reference['top_k']
        docs = documents(collection, {r[0] for rows in runs.values() for r in rows[:top_k]})
        from transformers import BertTokenizerFast
        tokenizer = BertTokenizerFast.from_pretrained(MODEL, revision=REVISION, cache_dir=ROOT/'.cache/monobert-model', local_files_only=True)
        tasks = prepare(args.mode, runs, queries, docs, mono, tokenizer)
        preparation_seconds = time.perf_counter()-rerank_start
        print(f'Prepared {sum(map(len, tasks.values()))} {args.mode} scoring units; maximum payload characters: {max(len(t["text"]) for jobs in tasks.values() for t in jobs)}; no truncation', flush=True)
        service = Service(args, dest)
        scores, timings = {}, []
        for q, jobs in tasks.items():
            query_start = time.perf_counter()
            rows = score_query(service, jobs, queries[q], args.workers)
            for r in rows:
                key = (q,r['docid'])
                scores[key] = max(scores.get(key,-math.inf),r['score'])
            timings.append({'qid':q,'seconds':time.perf_counter()-query_start,'scoring_calls':len(rows)})
            atomic_write(dest/'queries.json',json.dumps(timings,indent=2)+'\n')
            atomic_write(dest/'progress.json',json.dumps({'status':'running','queries_complete':len(timings),'successful_scores':len(service.rows),'api_attempts':len(service.attempts)})+'\n')
            print(f'{args.mode}: {len(timings)}/{len(tasks)} queries; {len(service.rows)} scores; {len(service.attempts)} API attempts',flush=True)
        atomic_write(dest/'run.trec',render_run(runs,scores,top_k))
        atomic_write(dest/'queries.json',json.dumps(timings,indent=2)+'\n')
        rerank_seconds = time.perf_counter()-rerank_start
        metrics = evaluate(source/'qrels.txt', dest/'run.trec', dest/'trec_eval.txt')
        diagnostics = paired(source,dest,runs,top_k)
        counts = accounting(service.rows,*rates)
        metadata = {'stage':'reranking','status':'complete','method':'jev-'+args.mode,**context,
            'started_at_utc':started_at_utc,'finished_at_utc':datetime.now(timezone.utc).isoformat(),
            'metrics':metrics,'stage1_run_sha256':baseline['run_sha256'],'stage1_manifest_sha256':sha(source/'manifest.json'),
            'collection_sha256':baseline['collection_sha256'],'topics_sha256':baseline['topics_sha256'],'qrels_sha256':baseline['qrels_sha256'],
            'monobert_manifest_sha256':sha(mono/'manifest.json'),'monobert_passages_sha256':sha(mono/'passages.jsonl'),
            'run_sha256':sha(dest/'run.trec'),'source_sha256':{name:sha(ROOT/name) for name in ('reranking/jev_compare.py','reranking/jev.py','reranking/monobert.py','reranking/run.py','tools/stage_artifacts.py')},
            'model_requested':args.model,'models_returned':sorted({r['response']['model'] for r in service.rows}),
            'library_versions':{name:importlib.metadata.version(name) for name in ('typesafe-sdk','transformers','tokenizers')},
            'question':QUESTION,'queries':len(runs),'top_k':top_k,'query_document_pairs':len(scores),'scoring_calls':len(service.rows),
            'api_attempts':len(service.attempts),'failed_api_attempts':sum(r['status']=='failed' for r in service.attempts),
            'workers':args.workers,'sdk_retries':0,'max_attempts_per_score':args.max_attempts,
            'cache_mode':'all-cached' if counts['cache_hits']==len(service.rows) else ('mixed' if counts['cache_hits'] else 'uncached'),
            'document_score':'maximum passage noul' if args.mode=='passages' else 'whole-document noul',
            'content_policy':'decoded original BERT token slices; no filtering or rechunking' if args.mode=='passages' else 'complete parsed original document; no character cap',
            'coverage_fraction':1.0,'truncated_documents':0,'tokenizer_model':MODEL,'tokenizer_revision':REVISION,
            'preparation_seconds':preparation_seconds,'rerank_seconds':rerank_seconds,'stage1_search_seconds':baseline['search_seconds'],
            'end_to_end_search_seconds':baseline['search_seconds']+rerank_seconds,'total_wall_seconds':time.perf_counter()-start,
            'query_p50_seconds':percentile([r['seconds'] for r in timings],.5),'query_p95_seconds':percentile([r['seconds'] for r in timings],.95),
            'timing_scope':'sequential queries, up to eight concurrent HTTP calls per query as configured; rerank includes extraction/tokenizer setup, SDK setup, requests/retries/backoff, evidence and output; query latency excludes shared setup; total includes validation/evaluation',
            'input_usd_per_million':rates[0],'output_usd_per_million':rates[1],'pricing_source':args.pricing_source,
            'cost_scope':'estimate from reported successful response usage; failed-request billing unknown; local compute unknown; not an invoice',
            **counts,**diagnostics}
        report(dest,metadata,baseline['metrics'])
        with (dest/'results.md').open('a') as out:
            out.write('\n## Calls, time and cost\n\n| Measurement | Value |\n| --- | ---: |\n')
            for k in ('scoring_calls','api_attempts','failed_api_attempts','cache_hits','rerank_seconds','end_to_end_search_seconds','query_p50_seconds','query_p95_seconds','estimated_new_api_cost_usd','compute_cost_usd'):
                v=metadata[k]
                out.write(f'| {k} | {"Unknown" if v is None else v} |\n')
            out.write('\nEvidence: [scores](scores.jsonl), [HTTP attempts](attempts.jsonl), [query times](queries.json), [paired analysis](paired-analysis.json).\n')
        atomic_write(dest/'progress.json',json.dumps({'status':'complete','successful_scores':len(service.rows),'api_attempts':len(service.attempts)})+'\n')
        print(dest,flush=True)
    except BaseException as error:
        failure = {'status':'failed','error_type':type(error).__name__,'http_status':getattr(error,'status',getattr(error,'status_code',None)),
                   'total_wall_seconds':time.perf_counter()-start,'api_attempts':len(service.attempts) if service else 0,
                   'successful_scores':len(service.rows) if service else 0,'note':'No complete evaluation. Successful responses cached; failed-request charges unknown.'}
        if service:
            failure.update(accounting(service.rows,*rates))
        atomic_write(dest/'failure.json',json.dumps(failure,indent=2)+'\n')
        atomic_write(dest/'progress.json',json.dumps(failure)+'\n')
        raise
    finally:
        if service:
            service.close()

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'JEV comparison failed ({type(error).__name__}); see failure.json. Request bodies omitted.',file=sys.stderr)
        sys.exit(1)
