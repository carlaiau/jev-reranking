#!/usr/bin/env python3
"""Compare the audited MS MARCO Score run with frozen Noul and monoBERT runs."""
import argparse
import json
from pathlib import Path

from audit_msmarco import holm, statistics
from msmarco import METRICS, save
from stage_artifacts import ROOT, sha


def analyze(root):
    methods = ('jev-score', 'jev-full', 'monobert')
    meta = {m: json.loads((root/m/'manifest.json').read_text()) for m in methods}
    per = {m: json.loads((root/m/'metrics-per-query.json').read_text()) for m in methods}
    frozen = json.loads((root/'input/manifest.json').read_text())
    score = meta['jev-score']
    audit = json.loads((root/'jev-score/audit.json').read_text())
    qids = frozen['evaluated_query_ids']
    if (score['status'] != 'complete' or audit['status'] != 'passed' or
        score['input_manifest_sha256'] != sha(root/'input/manifest.json') or
        score['input_identity_sha256'] != frozen['input_identity_sha256'] or
        score['candidate_pairs'] != frozen['candidate_pairs'] or
        audit['candidate_pairs'] != frozen['candidate_pairs']):
        raise ValueError('Score run is not complete and audited on frozen inputs')
    for m in methods:
        if (meta[m]['status'] != 'complete' or
            meta[m]['input_manifest_sha256'] != score['input_manifest_sha256'] or
            meta[m]['input_identity_sha256'] != score['input_identity_sha256'] or
            set(per[m]) != set(qids)):
            raise ValueError('reference run or per-query metrics mismatch')
    if any(per[m][q]['recall_1000'] != per['jev-score'][q]['recall_1000']
           for m in methods[1:] for q in qids):
        raise ValueError('complete-candidate recall changed')
    supplied = {row['qid']: set(row['passage_ids'])
                for row in json.loads((root/'input/candidates.json').read_text())}
    relevant = {q: set() for q in qids}
    for line in (root/'input/qrels-binary.txt').read_text().splitlines():
        q, _, d, grade = line.split()
        if q in relevant and int(grade) == 1:
            relevant[q].add(d)
    if set(supplied) != set(qids) or any(not relevant[q] for q in qids):
        raise ValueError('candidate or relevant query coverage mismatch')
    candidate_recall = {q: len(supplied[q] & relevant[q])/len(relevant[q]) for q in qids}
    mean_candidate_recall = sum(candidate_recall.values())/len(qids)
    if abs(mean_candidate_recall-score['metrics']['recall_1000']) > .0001:
        raise ValueError('candidate recall does not match trec_eval')
    comparisons = {}
    for m in methods[1:]:
        comparisons[m] = {
            'metrics': {metric: statistics([per['jev-score'][q][metric]-per[m][q][metric]
                                            for q in qids], seed=88)
                        for metric in METRICS},
            'per_query': [{'qid': q,
                           'delta': {metric: round(per['jev-score'][q][metric]-per[m][q][metric], 6)
                                     for metric in METRICS},
                           'candidate_count': len(supplied[q]),
                           'candidate_recall_at_supplied_depth': candidate_recall[q]}
                          for q in qids],
        }
    adjusted = holm({m: x['metrics']['ndcg_cut_10']['two_sided_randomization_p']
                     for m, x in comparisons.items()})
    for m, value in adjusted.items():
        comparisons[m]['metrics']['ndcg_cut_10']['holm_adjusted_p'] = value
    paired = {'status': 'complete', 'reference_input_manifest_sha256': score['input_manifest_sha256'],
              'primary_metric': 'ndcg_cut_10', 'queries': len(qids),
              'mean_candidate_recall_at_supplied_depth': mean_candidate_recall,
              'precision': 'trec_eval four-decimal per-query values',
              'multiple_testing': 'Holm over Score versus Noul and Score versus monoBERT; secondary metrics descriptive',
              'comparisons': comparisons}
    save(root/'jev-score/paired-analysis.json', paired)

    noul = comparisons['jev-full']['metrics']['ndcg_cut_10']
    quality_ok = (noul['mean_delta'] > 0 and noul['bootstrap_95_ci'][0] > 0 and
                  noul['holm_adjusted_p'] < .05)
    baseline = meta['jev-full']
    time_ratio = score['rerank_seconds']/baseline['rerank_seconds']
    cost_ratio = score['estimated_new_api_cost_usd']/baseline['estimated_new_api_cost_usd']
    lines = ['# Ten-level JEV Score on MS MARCO v1 / TREC DL 2019', '',
             'Status: complete. Issue [#88](https://github.com/carlaiau/jev-reranking/issues/88).',
             'Protocol and fixed rubric: [msmarco-score.md](../../msmarco-score.md).', '',
             'All three local runs use the same 43 judged queries and 41,042 supplied passage candidates.',
             'Score and Noul use original passage text. monoBERT uses its saved local checkpoint.', '',
             '## Effectiveness', '',
             '| Metric | JEV Score | JEV Noul | monoBERT |', '| --- | ---: | ---: | ---: |']
    for metric in METRICS:
        lines.append(f'| {metric} | {score["metrics"][metric]:.4f} | {baseline["metrics"][metric]:.4f} | {meta["monobert"]["metrics"][metric]:.4f} |')
    lines += ['', 'Headline nDCG@10 uses all original relevance grades; binary metrics use grades 2–3.',
              f'The supplied candidate set is fixed. Mean candidate recall at each query’s complete supplied depth is {mean_candidate_recall:.4f};',
              'this equals recall@1000 because no query has more than 1,000 candidates. The per-query',
              'counts and recall values are in paired-analysis.json. Recall@100 is ranking-dependent.', '',
              '## Paired nDCG@10 differences', '',
              '| Comparison | Mean delta | Bootstrap 95% CI | Two-sided p | Holm p | Better / worse / tied queries |',
              '| --- | ---: | --- | ---: | ---: | --- |']
    for m, label in [('jev-full','Score − Noul'), ('monobert','Score − monoBERT')]:
        s = comparisons[m]['metrics']['ndcg_cut_10']
        lo, hi = s['bootstrap_95_ci']
        lines.append(f'| {label} | {s["mean_delta"]:+.4f} | [{lo:+.4f}, {hi:+.4f}] | {s["two_sided_randomization_p"]:.5f} | {s["holm_adjusted_p"]:.5f} | {s["improved"]} / {s["worse"]} / {s["tied"]} |')
    lines += ['', 'Paired tests use 43 per-query trec_eval values rounded to four decimals:',
              '10,000 bootstrap resamples, 100,000 sign randomizations, seed 88, and Holm adjustment',
              'over the two headline comparisons. Secondary metrics are descriptive.', '',
              '## Time and cost', '',
              '| Method | Rerank seconds | Query p50 / p95 seconds | API attempts / failed | Estimated API USD |',
              '| --- | ---: | ---: | ---: | ---: |']
    for m, label in [('jev-score','JEV Score'), ('jev-full','JEV Noul'), ('monobert','monoBERT')]:
        x=meta[m]
        lines.append(f'| {label} | {x["rerank_seconds"]:.2f} | {x["query_p50_seconds"]:.2f} / {x["query_p95_seconds"]:.2f} | {x["api_attempts"]:,} / {x["failed_api_attempts"]} | {x["estimated_new_api_cost_usd"]:.6f} |')
    lines += ['', f'Score / Noul rerank-time ratio: {time_ratio:.2f}×; estimated API-cost ratio: {cost_ratio:.2f}×.',
              'The two JEV timings are separate single uncached runs, not repeated hardware-controlled medians.',
              'They include network and retries. Pricing is the published $0.042/million input-token rate,',
              'with free output, checked 2026-09-25. Failed-attempt billing and local compute cost are unknown.',
              'Supplied-candidate retrieval time is unknown, so no end-to-end search time is claimed.',
              'The earlier validation attempt is accounted for separately: 19 accepted responses cost an',
              'estimated $0.000470862; one synthetic preflight plus two diagnostic calls add an estimated',
              '$0.000071190. Billing for two locally rejected responses is unknown. These amounts are',
              'outside the complete Score run cost above.', '',
              '## Decision', '',
              ('The preregistered nDCG@10 quality criterion versus Noul is met; assess the measured time/cost tradeoff on the issue.' if quality_ok else
               'Rejected: the preregistered nDCG@10 improvement criterion versus Noul is not met.'),
              ('' if quality_ok else 'Score is significantly worse on the primary metric, despite a shorter observed rerank time, and its estimated API cost is higher.'),
              'This single fixed-rubric evaluation is not a prompt search or held-out proof of a broader conclusion.', '',
              '## Evidence', '',
              '- [Frozen input manifest](../input/manifest.json).',
              '- [Score manifest](manifest.json), [response-derived scores](scores.jsonl), [API attempts](attempts.jsonl).',
              '- [Score run](run.trec), [graded trec_eval](trec_eval-graded.txt), [binary trec_eval](trec_eval-binary.txt).',
              '- [Per-query metrics](metrics-per-query.json), [paired analysis](paired-analysis.json), [audit](audit.json).',
              '- [Noul results](../jev-full/results.md), [monoBERT results](../monobert/results.md).', '',
              '- [Failed validation attempt](../jev-score-failed-validation-20260925/results.md),',
              '  [contract tests](msmarco-contracts.log), [repository smoke](smoke.log), [audit log](audit.log).', '',
              'Response caches, source passage text, credentials and model downloads are outside Git.', '']
    (root/'jev-score/results.md').write_text('\n'.join(lines))
    return quality_ok


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', type=Path, default=ROOT/'reranking/results/msmarco-dl2019')
    args=p.parse_args()
    print({'quality_criterion_met': analyze(args.root)})
