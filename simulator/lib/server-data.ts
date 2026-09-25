import 'server-only'

import type { Evidence, ScoreRecord, TaskId } from './evidence'
import type { PassageEvidence, PassageMetrics, PassageTaskId } from './msmarco-evidence'
import type { WsjMetrics } from './wsj-top100'
import { dbRows } from './db'

type CollectionRow = {
  source: Evidence['source'] | PassageEvidence['source']
  tasks: Evidence['tasks'] | PassageEvidence['tasks']
  aggregate_before: WsjMetrics | null
  aggregate_after: WsjMetrics | null
  reference_metrics: PassageMetrics | null
}

type RunRow = {
  query_text: string
  before_metrics: WsjMetrics | PassageMetrics
  after_metrics: WsjMetrics | PassageMetrics
  seconds: number
  calls: number
  model: string
}

type CandidateRow = {
  doc_id: string
  baseline_rank: number
  final_rank: number
  judgment: number | null
  title: string | null
  has_content: boolean
  score: number | null
}

type CallRow = {
  doc_id: string
  title: string | null
  passage_text: string | null
  matched_payload: string | null
  score: number
  input_tokens: number
  output_tokens: number
  model: string
  seconds: number
  payload_characters: number
  payload_hash: string
  cache_hit: boolean
  passage_index: number | null
  token_start: number | null
  token_end: number | null
  document_tokens: number | null
}

export async function getWsjCollection() {
  const rows = await dbRows<CollectionRow>('SELECT source, tasks, aggregate_before, aggregate_after, reference_metrics FROM simulator.collections WHERE id = $1', ['wsj'])
  if (!rows[0]?.aggregate_before || !rows[0]?.aggregate_after) throw new Error('Seed the WSJ collection in Neon before starting the simulator.')
  return {
    source: rows[0].source as Evidence['source'],
    tasks: rows[0].tasks as Evidence['tasks'],
    aggregate: { before: rows[0].aggregate_before, after: rows[0].aggregate_after },
  }
}

export async function getMsmarcoCollection() {
  const rows = await dbRows<CollectionRow>('SELECT source, tasks, aggregate_before, aggregate_after, reference_metrics FROM simulator.collections WHERE id = $1', ['msmarco'])
  if (!rows[0]?.reference_metrics) throw new Error('Seed the MS MARCO collection in Neon before starting the simulator.')
  return {
    source: rows[0].source as PassageEvidence['source'],
    tasks: rows[0].tasks as PassageEvidence['tasks'],
    referenceMetrics: rows[0].reference_metrics,
  }
}

export async function getQueryOptions(collection: 'wsj' | 'msmarco') {
  const rows = await dbRows<{ id: string; text: string }>(
    'SELECT query_id AS id, query_text AS text FROM simulator.queries WHERE collection_id = $1 ORDER BY query_id::bigint',
    [collection],
  )
  return rows
}

async function loadQuery(collection: 'wsj' | 'msmarco', qid: string, task: string) {
  const [runs, candidates] = await Promise.all([
    dbRows<RunRow>(
      `SELECT q.query_text, r.before_metrics, r.after_metrics, r.seconds, r.calls,
              col.tasks -> $3 ->> 'model' AS model
         FROM simulator.query_runs r
         JOIN simulator.queries q USING (collection_id, query_id)
         JOIN simulator.collections col ON col.id = r.collection_id
        WHERE r.collection_id = $1 AND r.query_id = $2 AND r.task = $3`,
      [collection, qid, task],
    ),
    dbRows<CandidateRow>(
      `SELECT c.doc_id, c.baseline_rank, rr.final_rank, c.judgment,
              d.title, d.doc_id IS NOT NULL AS has_content,
              (SELECT max(s.score) FROM simulator.calls s
                WHERE s.collection_id = c.collection_id AND s.query_id = c.query_id
                  AND s.task = $3 AND s.doc_id = c.doc_id) AS score
         FROM simulator.candidates c
         JOIN simulator.reranked_results rr
           ON rr.collection_id = c.collection_id AND rr.query_id = c.query_id
          AND rr.doc_id = c.doc_id AND rr.task = $3
         LEFT JOIN simulator.documents d
           ON d.collection_id = c.collection_id AND d.doc_id = c.doc_id
        WHERE c.collection_id = $1 AND c.query_id = $2
          AND (c.baseline_rank <= 10 OR rr.final_rank <= 10)`,
      [collection, qid, task],
    ),
  ])
  if (!runs[0]) return null
  const run = runs[0]
  return {
    id: qid,
    text: run.query_text,
    task,
    before: candidates.filter(row => row.baseline_rank <= 10).sort((a, b) => a.baseline_rank - b.baseline_rank).map(row => row.doc_id),
    after: candidates.filter(row => row.final_rank <= 10).sort((a, b) => a.final_rank - b.final_rank).map(row => row.doc_id),
    beforeMetrics: run.before_metrics,
    afterMetrics: run.after_metrics,
    seconds: run.seconds,
    calls: run.calls,
    model: run.model,
    documents: Object.fromEntries(candidates.map(row => [row.doc_id, {
      title: row.title || (collection === 'wsj' ? row.doc_id : `Passage ${row.doc_id}`),
      judgment: row.judgment,
      hasContent: row.has_content,
      originalRank: row.baseline_rank,
      finalRank: row.final_rank,
      score: row.score,
    }])),
    contentAvailable: candidates.every(row => row.has_content),
  }
}

export async function getQueryPayload(qid: string, task: TaskId) {
  const query = await loadQuery('wsj', qid, task)
  if (!query) return null
  return { ...query, task, beforeMetrics: query.beforeMetrics as WsjMetrics, afterMetrics: query.afterMetrics as WsjMetrics, passagePayloadsAvailable: false }
}

export async function getMsmarcoQueryPayload(qid: string, task: PassageTaskId) {
  const query = await loadQuery('msmarco', qid, task)
  if (!query) return null
  return { ...query, task, beforeMetrics: query.beforeMetrics as PassageMetrics, afterMetrics: query.afterMetrics as PassageMetrics }
}

function scoreRecord(row: CallRow): ScoreRecord {
  return {
    score: row.score,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    model: row.model,
    seconds: row.seconds,
    payloadCharacters: row.payload_characters,
    payloadHash: row.payload_hash,
    cacheHit: row.cache_hit,
    ...(row.passage_index === null ? {} : { passage_index: row.passage_index }),
    ...(row.token_start === null ? {} : { token_start: row.token_start }),
    ...(row.token_end === null ? {} : { token_end: row.token_end }),
    ...(row.document_tokens === null ? {} : { document_tokens: row.document_tokens }),
  }
}

async function loadCalls(collection: 'wsj' | 'msmarco', qid: string, task: string, docid: string) {
  return await dbRows<CallRow>(
    `SELECT ca.*, d.title, d.passage_text
       FROM simulator.calls ca
       LEFT JOIN simulator.documents d
         ON d.collection_id = ca.collection_id AND d.doc_id = ca.doc_id
      WHERE ca.collection_id = $1 AND ca.query_id = $2 AND ca.task = $3 AND ca.doc_id = $4
      ORDER BY ca.call_index`,
    [collection, qid, task, docid],
  )
}

export async function getDocumentPayload(qid: string, task: TaskId, docid: string) {
  const rows = await loadCalls('wsj', qid, task, docid)
  if (!rows.length) return null
  return {
    docid,
    title: rows[0].title || docid,
    text: null,
    calls: rows.map(row => ({
      ...scoreRecord(row),
      payload: `[REDACTED_TOKENS ${task === 'documents' ? row.document_tokens : (row.token_end ?? 0) - (row.token_start ?? 0)} source tokens sent]`,
      redacted: true,
    })),
  }
}

export async function getMsmarcoDocumentPayload(qid: string, task: PassageTaskId, docid: string) {
  const rows = await loadCalls('msmarco', qid, task, docid)
  if (!rows.length) return null
  return {
    docid,
    title: rows[0].title || `Passage ${docid}`,
    text: null,
    calls: rows.map(row => ({ ...scoreRecord(row), payload: task === 'matched' ? row.matched_payload : row.passage_text })),
  }
}
