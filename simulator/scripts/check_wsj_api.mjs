#!/usr/bin/env node
// Run against a local simulator server to guard the WSJ browser boundary.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const simulator = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const evidence = JSON.parse(readFileSync(path.join(simulator, 'data/evidence.json'), 'utf8'))
const base = process.env.SIMULATOR_BASE_URL || 'http://localhost:3000'
const documentCache = path.resolve(simulator, '..', '.cache/reranking-simulator/wsj-documents.json')
let localDocuments = null
try { localDocuments = JSON.parse(readFileSync(documentCache, 'utf8')) } catch (error) {
  if (error.code !== 'ENOENT') throw error
}

async function get(url) {
  const response = await fetch(`${base}${url}`)
  assert.equal(response.status, 200, `Unexpected status for ${url}`)
  const raw = await response.text()
  return { raw, data: JSON.parse(raw) }
}

const home = await fetch(base)
assert.equal(home.status, 200, 'WSJ page did not load')
const html = await home.text()
if (localDocuments) {
  const article = Object.values(localDocuments).find(item => item.text.length > 200)
  assert(article, 'No long local article was found for the boundary check')
  assert(!html.includes(article.text.slice(0, 200)), 'Full WSJ article text reached the page HTML')
}

const requests = []
for (const [qid, query] of Object.entries(evidence.queries)) {
  for (const task of ['documents', 'passages']) {
    requests.push(async () => {
      const { raw, data } = await get(`/api/query?qid=${qid}&task=${task}`)
      for (const result of Object.values(data.documents)) {
        assert(!('text' in result), `Article body in query JSON for ${qid}/${task}`)
        assert(result.title.length <= 140, `Oversized WSJ name for ${qid}/${task}`)
      }
      if (localDocuments) {
        const docid = query.before[0]
        assert(!raw.includes(localDocuments[docid].text.slice(0, 200)), `Article text in query JSON for ${qid}/${task}`)
      }
    })
    const ids = new Set([...query.before.slice(0, 10), ...query.tasks[task].after.slice(0, 10)])
    for (const docid of ids) requests.push(async () => {
      const { raw, data } = await get(`/api/document?qid=${qid}&task=${task}&docid=${docid}`)
      assert.equal(data.text, null, `Article body in document JSON for ${qid}/${task}/${docid}`)
      assert(data.title.length <= 140, `Oversized WSJ name for ${qid}/${task}/${docid}`)
      const saved = query.tasks[task].scores[docid]
      assert.equal(data.calls.length, saved.length)
      for (const [index, call] of data.calls.entries()) {
        const record = saved[index]
        const count = task === 'documents' ? record.document_tokens : record.token_end - record.token_start
        const marker = `[REDACTED_TOKENS · ${count} BERT source tokens sent]`
        assert.equal(call.redacted, true)
        assert(call.payload.endsWith(marker), `Missing recorded token count for ${qid}/${task}/${docid}`)
        assert(call.payload.slice(0, -marker.length).trim().length <= 100, `Excerpt too long for ${qid}/${task}/${docid}`)
      }
      if (localDocuments) assert(!raw.includes(localDocuments[docid].text.slice(0, 200)), `Full article in document JSON for ${qid}/${task}/${docid}`)
    })
  }
}

let cursor = 0
await Promise.all(Array.from({ length: 12 }, async () => {
  while (cursor < requests.length) {
    const request = requests[cursor++]
    await request()
  }
}))
console.log(`Checked ${requests.length} WSJ API responses and the page HTML; no full article text exposed.`)
