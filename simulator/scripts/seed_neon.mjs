#!/usr/bin/env node
// Import the frozen simulator evidence. WSJ article bodies never enter SQL rows.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { neon } from '@neondatabase/serverless'

const simulator = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.resolve(simulator, '..')
if (!process.env.DATABASE_URL && !process.env.DATABASE_URL_POOLED) process.loadEnvFile(path.join(root, '.env'))
const connection = process.env.DATABASE_URL || process.env.DATABASE_URL_POOLED
if (!connection) throw new Error('Set DATABASE_URL or DATABASE_URL_POOLED before seeding.')
const sql = neon(connection)

function readJson(filename) {
  return JSON.parse(readFileSync(path.join(simulator, filename), 'utf8'))
}

function sha256(filename) {
  return createHash('sha256').update(readFileSync(path.join(simulator, filename))).digest('hex')
}

function wsjTitle(document, docid) {
  const title = document?.title?.replace(/\s+/g, ' ').trim()
  return (title || docid).slice(0, 140)
}

function passageTitle(text, docid) {
  if (!text) return `Passage ${docid}`
  const cleaned = text.trim().replace(/^Confidence votes\s+[\d.,]+[KMB]?\.\s*/i, '')
  const first = cleaned.split(/(?<=[.!?])\s+/)[0]
  return first.length > 112 ? `${first.slice(0, 109).trimEnd()}…` : first
}

const tableColumns = {
  collections: 'id text, evidence_sha256 text, source jsonb, tasks jsonb, aggregate_before jsonb, aggregate_after jsonb, reference_metrics jsonb',
  queries: 'collection_id text, query_id text, query_text text',
  documents: 'collection_id text, doc_id text, title text, passage_text text',
  candidates: 'collection_id text, query_id text, doc_id text, baseline_rank integer, judgment smallint',
  query_runs: 'collection_id text, query_id text, task text, before_metrics jsonb, after_metrics jsonb, seconds double precision, calls integer',
  reranked_results: 'collection_id text, query_id text, task text, doc_id text, final_rank integer',
  calls: 'collection_id text, query_id text, task text, doc_id text, call_index integer, score double precision, input_tokens integer, output_tokens integer, model text, seconds double precision, payload_characters integer, payload_hash text, cache_hit boolean, passage_index integer, token_start integer, token_end integer, document_tokens integer, matched_payload text',
}

async function insertRows(table, rows) {
  const spec = tableColumns[table]
  const columns = spec.split(', ').map(column => column.split(' ')[0]).join(', ')
  const statement = `INSERT INTO simulator.${table} (${columns}) SELECT ${columns} FROM jsonb_to_recordset($1::jsonb) AS x(${spec}) ON CONFLICT DO NOTHING`
  for (let offset = 0; offset < rows.length; offset += 1000) {
    await sql.query(statement, [JSON.stringify(rows.slice(offset, offset + 1000))])
  }
}

function datasetRows(collectionId, evidence, content, top100) {
  const rows = { collections: [], queries: [], documents: [], candidates: [], query_runs: [], reranked_results: [], calls: [] }
  rows.collections.push({
    id: collectionId,
    evidence_sha256: sha256(collectionId === 'wsj' ? 'data/evidence.json' : 'data/msmarco-evidence.json'),
    source: evidence.source,
    tasks: evidence.tasks,
    aggregate_before: top100?.before.all ?? null,
    aggregate_after: top100?.after.all ?? null,
    reference_metrics: evidence.referenceMetrics ?? null,
  })

  for (const [qid, query] of Object.entries(evidence.queries)) {
    const queryText = collectionId === 'wsj' ? query.text : content.queries[qid]
    if (!queryText) throw new Error(`Missing ${collectionId} query text for ${qid}`)
    rows.queries.push({ collection_id: collectionId, query_id: qid, query_text: queryText })
    query.before.forEach((docid, index) => {
      rows.candidates.push({ collection_id: collectionId, query_id: qid, doc_id: docid, baseline_rank: index + 1, judgment: query.judgments[docid] ?? null })
    })
    for (const [task, run] of Object.entries(query.tasks)) {
      rows.query_runs.push({
        collection_id: collectionId, query_id: qid, task,
        before_metrics: collectionId === 'wsj' && task === 'documents' ? top100.before.queries[qid] : run.beforeMetrics,
        after_metrics: collectionId === 'wsj' && task === 'documents' ? top100.after.queries[qid] : run.afterMetrics,
        seconds: run.seconds, calls: run.calls,
      })
      run.after.forEach((docid, index) => {
        rows.reranked_results.push({ collection_id: collectionId, query_id: qid, task, doc_id: docid, final_rank: index + 1 })
      })
      for (const [docid, records] of Object.entries(run.scores)) {
        records.forEach((record, index) => {
          const matchedPayload = collectionId === 'msmarco' && task === 'matched' ? content.matched[qid]?.[docid] : null
          if (collectionId === 'msmarco' && task === 'matched' && !matchedPayload) throw new Error(`Missing matched passage ${qid}/${docid}`)
          rows.calls.push({
            collection_id: collectionId, query_id: qid, task, doc_id: docid, call_index: index,
            score: record.score, input_tokens: record.inputTokens, output_tokens: record.outputTokens,
            model: record.model, seconds: record.seconds, payload_characters: record.payloadCharacters,
            payload_hash: record.payloadHash, cache_hit: record.cacheHit,
            passage_index: record.passage_index ?? null, token_start: record.token_start ?? null,
            token_end: record.token_end ?? null, document_tokens: record.document_tokens ?? null,
            matched_payload: matchedPayload,
          })
        })
      }
    }
  }

  if (collectionId === 'wsj') {
    const wanted = new Set(rows.candidates.map(row => row.doc_id))
    for (const docid of wanted) {
      if (!content[docid]?.title) throw new Error(`Missing WSJ title for ${docid}`)
      rows.documents.push({ collection_id: collectionId, doc_id: docid, title: wsjTitle(content[docid], docid), passage_text: null })
    }
  } else {
    const wanted = new Set(rows.calls.map(row => row.doc_id))
    for (const docid of wanted) {
      const passage = content.passages[docid]
      if (!passage) throw new Error(`Missing MS MARCO passage for ${docid}`)
      rows.documents.push({ collection_id: collectionId, doc_id: docid, title: passageTitle(passage, docid), passage_text: passage })
    }
  }
  return rows
}

async function main() {
  const wsj = readJson('data/evidence.json')
  const msmarco = readJson('data/msmarco-evidence.json')
  const top100 = readJson('data/wsj-top100-metrics.json')
  const contentDir = process.env.SIMULATOR_CONTENT_DIR || path.join(root, '.cache', 'reranking-simulator')
  const wsjContent = JSON.parse(readFileSync(path.join(contentDir, 'wsj-documents.json'), 'utf8'))
  const msmarcoContent = JSON.parse(readFileSync(path.join(contentDir, 'msmarco-content.json'), 'utf8'))
  const datasets = [
    datasetRows('wsj', wsj, wsjContent, top100),
    datasetRows('msmarco', msmarco, msmarcoContent, null),
  ]

  const schema = readFileSync(path.join(simulator, 'db', 'schema.sql'), 'utf8')
  for (const statement of schema.split(/;\s*(?:\n|$)/).map(s => s.trim()).filter(Boolean)) await sql.query(statement)

  for (const rows of datasets) {
    const collection = rows.collections[0]
    const existing = await sql`SELECT evidence_sha256 FROM simulator.collections WHERE id = ${collection.id}`
    if (existing.length && existing[0].evidence_sha256 !== collection.evidence_sha256) {
      throw new Error(`Existing ${collection.id} evidence differs; refusing to overwrite the seeded collection.`)
    }
    for (const table of Object.keys(tableColumns)) {
      await insertRows(table, rows[table])
    }
    for (const table of Object.keys(tableColumns)) {
      const result = await sql.query(`SELECT count(*)::integer AS count FROM simulator.${table} WHERE ${table === 'collections' ? 'id' : 'collection_id'} = $1`, [collection.id])
      if (result[0].count !== rows[table].length) throw new Error(`${collection.id}/${table}: expected ${rows[table].length} rows, found ${result[0].count}`)
    }
    console.log(`Seeded ${collection.id}: ${rows.queries.length} queries, ${rows.candidates.length} candidates, ${rows.calls.length} saved calls; WSJ article bodies stored: 0`)
  }
}

main().catch(error => {
  // Avoid printing driver errors that could include the connection string.
  console.error(`Neon seed failed: ${error.name || 'Error'}${error.code ? ` (${error.code})` : ''}`)
  process.exitCode = 1
})
