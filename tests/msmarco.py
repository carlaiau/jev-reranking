#!/usr/bin/env python3
import gzip
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'reranking'))
from msmarco import (QUESTION, SCORE_QUESTION, SCORE_WEIGHTS, evaluation, execute,
                     freeze, read_inputs, score_answer_details, score_relevance,
                     validate_scores, verified_inputs)
from jev_compare import Service
from audit_msmarco import audit_mono, holm, statistics


class FakeBackend:
    limit, special_tokens, device, parameters = 512, 3, 'cpu', 0
    unexpected_keys, versions = [], {'synthetic': 'test'}
    def __init__(self, args): pass
    def tokenize(self, text): return list(range(len(text.split())))
    def encode(self, text, **kwargs): return self.tokenize(text)
    def decode(self, ids, **kwargs): return ' '.join(map(str, ids))
    def num_special_tokens_to_add(self, pair): return 3
    def pair(self, query, passage):
        return {'input_ids': [101]+query+[102]+passage+[102]}
    def predict(self, batch): return [-.5]*len(batch)


class Tests(unittest.TestCase):
    def test_complete_adapter_audit_and_failure_isolation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); data = self.data(root); source = root/'input'
            freeze(data, source)
            args = SimpleNamespace(data=data, input=source, method='monobert', results_dir=root/'mono',
                                   top_k=1000, passage_tokens=384, overlap_tokens=64, batch_size=8)
            with patch('msmarco.BertBackend', FakeBackend):
                execute(args)
            runs, queries, docs, _, _ = read_inputs(data)
            result = audit_mono(args.results_dir, source, runs, queries, docs, FakeBackend(None))
            self.assertEqual(result['status'], 'passed')
            self.assertEqual(result['candidate_pairs'], 2)
            with self.assertRaises(FileExistsError), patch('msmarco.BertBackend', FakeBackend):
                execute(args)
            args.results_dir = root/'failed'
            class Broken(FakeBackend):
                def predict(self, batch): raise RuntimeError('synthetic failure')
            with self.assertRaises(RuntimeError), patch('msmarco.BertBackend', Broken):
                execute(args)
            failure = json.loads((args.results_dir/'failure.json').read_text())
            self.assertEqual(failure['status'], 'failed')
            self.assertEqual(failure['counters']['model_forward_calls_attempted'], 1)
            self.assertFalse((args.results_dir/'manifest.json').exists())

    def test_paired_statistics_and_multiple_comparisons(self):
        null = statistics([0, 0, 0], bootstrap=100, permutations=100)
        self.assertEqual(null['bootstrap_95_ci'], [0, 0])
        self.assertEqual(null['two_sided_randomization_p'], 1)
        gain = statistics([.1]*20, bootstrap=100, permutations=1000)
        self.assertGreater(gain['bootstrap_95_ci'][0], 0)
        self.assertLess(gain['two_sided_randomization_p'], .01)
        self.assertEqual(holm({'a': .02, 'b': .03}), {'a': .04, 'b': .04})

    def data(self, root):
        data = root / 'data'
        data.mkdir()
        (data / 'qrels.txt').write_text('1 Q0 10 3\n1 Q0 20 1\n1 Q0 99 2\n')
        with gzip.open(data / 'queries.tsv.gz', 'wt') as f:
            f.write('1\tquery\n2\tunjudged query\n')
        with gzip.open(data / 'candidates.tsv.gz', 'wt') as f:
            f.write('1\t20\tquery\tfirst passage\n1\t10\tquery\tsecond passage\n2\t30\tunjudged query\tthird passage\n')
        return data

    def test_identity_selection_not_labels_or_input_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = self.data(Path(tmp))
            runs, queries, docs, _, _ = read_inputs(data)
            self.assertEqual(list(queries), ['1'])
            self.assertEqual([r[0] for r in runs['1']], ['10', '20'])
            self.assertNotIn('99', docs)  # judged relevant passage must not be injected
            (data / 'qrels.txt').write_text('1 Q0 10 0\n1 Q0 20 3\n')
            self.assertEqual(read_inputs(data)[:3], (runs, queries, docs))

    def test_duplicate_and_text_mismatch_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = self.data(Path(tmp))
            with gzip.open(data / 'candidates.tsv.gz', 'at') as f:
                f.write('1\t10\tquery\tduplicate\n')
            with self.assertRaises(ValueError):
                read_inputs(data)

    def test_freeze_hashes_and_binary_grades(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); data = self.data(root); frozen = root / 'input'
            freeze(data, frozen)
            self.assertIn('1 Q0 20 0', (frozen / 'qrels-binary.txt').read_text())
            verified_inputs(data, frozen)
            (frozen / 'qrels-binary.txt').write_text('tampered')
            with self.assertRaises(ValueError):
                verified_inputs(data, frozen)
            with self.assertRaises(FileExistsError):
                freeze(data, frozen)

    def test_evaluation_graded_and_binary_are_distinct(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); data = self.data(root); source = root / 'input'
            freeze(data, source)
            dest = root / 'output'; dest.mkdir()
            (dest / 'run.trec').write_text('1 Q0 20 1 2 test\n1 Q0 10 2 1 test\n')
            metrics = evaluation(source, dest)
            self.assertEqual(metrics['recip_rank'], .5)  # grade 1 not binary relevant
            self.assertEqual(metrics['map'], .25)  # relevant grade-2 item remains missing
            self.assertEqual(metrics['recall_1000'], .5)
            self.assertGreater(metrics['ndcg_cut_10'], 0)

    def test_missing_or_nonfinite_scores_fail(self):
        runs = {'1': [('10', 1, 0), ('20', 2, 0)]}
        for scores in ({('1', '10'): .5}, {('1', '10'): .5, ('1', '20'): float('nan')}):
            with self.assertRaises(ValueError):
                validate_scores(runs, scores)

    def test_passage_prompt_payload_and_cache_isolation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            class Client:
                def __init__(self): self.payloads = []
                def system_one(self, **kwargs):
                    self.payloads.append(kwargs)
                    return {'model': 'test', 'answers': {'relevant': {'type': 'noul', 'noul': .4}},
                            'usage': {'input_tokens': 10, 'output_tokens': 0}}
                def close(self): pass
            client = Client()
            args = SimpleNamespace(cache=root/'cache', cache_only=False, model='test', mode='passages',
                                   expected_model='test', max_attempts=1, question=QUESTION, state_field='candidate_passage')
            service = Service(args, root, client)
            task = {'qid': '1', 'docid': '10', 'text': 'private example'}
            service.score(task, 'query')
            self.assertEqual(client.payloads[0]['state'], {'query': 'query', 'candidate_passage': task['text']})
            self.assertEqual(client.payloads[0]['questions']['relevant'], QUESTION)
            self.assertTrue(service.score(task, 'query')['cache_hit'])
            args.question = {**QUESTION, 'instructions': 'changed'}
            self.assertFalse(service.score(task, 'query')['cache_hit'])
            self.assertNotIn('private example', (root/'scores.jsonl').read_text())

    def test_score_probabilities_weighting_and_cached_replay(self):
        probs = {str(i): 0.0 for i in range(10)}
        probs['1'], probs['9'] = .25, .75
        response = {'model': 'test', 'answers': {'relevant': {
            'type': 'score', 'probabilities': probs, 'score': 7.0, 'confidence': .4}},
            'usage': {'input_tokens': 20, 'output_tokens': 2}}
        self.assertEqual(score_relevance(response), .25*SCORE_WEIGHTS[1]+.75*SCORE_WEIGHTS[9])
        self.assertEqual(score_answer_details(response)['probabilities'][9], .75)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            class Client:
                def __init__(self): self.calls = 0
                def system_one(self, **kwargs):
                    self.calls += 1
                    self.payload = kwargs
                    return response
                def close(self): pass
            client = Client()
            args = SimpleNamespace(cache=root/'cache', cache_only=False, model='test', mode='documents',
                                   expected_model='test', max_attempts=1, question=SCORE_QUESTION,
                                   state_field='candidate_passage', response_validator=score_relevance,
                                   answer_details=score_answer_details)
            service = Service(args, root, client)
            task = {'qid': '1', 'docid': '10', 'text': 'example passage'}
            row = service.score(task, 'example query')
            self.assertEqual(row['score'], 78.75)
            self.assertEqual(row['answer_details']['probabilities'][9], .75)
            self.assertEqual(client.payload['questions']['relevant'], SCORE_QUESTION)
            self.assertTrue(service.score(task, 'example query')['cache_hit'])
            self.assertEqual(client.calls, 1)
            corrupt = {**response, 'answers': {'relevant': {**response['answers']['relevant'],
                                                            'probabilities': {**probs, '9': -0.1}}}}
            with self.assertRaises(ValueError):
                score_relevance(corrupt)
            rounded = {**response, 'answers': {'relevant': {**response['answers']['relevant'],
                        'probabilities': {0: .04, 1: .57, 2: .14, 3: .03, 4: .12, 5: .09,
                                          6: 0, 7: 0, 8: 0, 9: 0}, 'score': 1.95}}}
            self.assertAlmostEqual(score_answer_details(rounded)['probability_sum'], .99)
            self.assertAlmostEqual(score_relevance(rounded), 23.65)


if __name__ == '__main__':
    unittest.main()
