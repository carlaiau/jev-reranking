import 'server-only'

import fs from 'node:fs'
import path from 'node:path'
import { evidence, type TaskId } from './evidence'
import { passageEvidence, type PassageTaskId } from './msmarco-evidence'
import { wsjTop100 } from './wsj-top100'

type LocalDocument = { title: string; text: string }
type LocalDocuments = Record<string, LocalDocument>
type LocalPassages = Record<string, Record<string, Record<string, string>>>
type MsmarcoContent = { queries: Record<string, string>; passages: Record<string, string>; matched: Record<string, Record<string, string>> }

let documentCache: LocalDocuments | null | undefined
let passageCache: LocalPassages | null | undefined
let msmarcoCache: MsmarcoContent | null | undefined

function cachePath(name: string): string {
  return path.join(
    process.env.SIMULATOR_CONTENT_DIR || path.resolve(process.cwd(), '..', '.cache', 'reranking-simulator'),
    name,
  )
}

function readJson<T>(name: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(cachePath(name), 'utf8')) as T
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}

function localDocuments(): LocalDocuments | null {
  if (documentCache === undefined) documentCache = readJson<LocalDocuments>('wsj-documents.json')
  return documentCache
}

function localPassages(): LocalPassages | null {
  if (passageCache === undefined) passageCache = readJson<LocalPassages>('wsj-passages.json')
  return passageCache
}

function localMsmarco(): MsmarcoContent | null {
  if (msmarcoCache === undefined) msmarcoCache = readJson<MsmarcoContent>('msmarco-content.json')
  return msmarcoCache
}

function passageTitle(text: string | undefined, docid: string): string {
  if (!text) return `Passage ${docid}`
  const cleaned = text.trim().replace(/^Confidence votes\s+[\d.,]+[KMB]?\.\s*/i, '')
  const first = cleaned.split(/(?<=[.!?])\s+/)[0]
  return first.length > 112 ? `${first.slice(0, 109).trimEnd()}…` : first
}

function redactedWsjExcerpt(text: string | undefined, sentTokens: number): string {
  const marker = `[REDACTED_TOKENS ${sentTokens} BERT source tokens sent]`
  if (!text) return marker
  const words = text.trim().split(/\s+/)
  if (words.length <= 24) return marker
  const excerpt = words.slice(0, 12).join(' ').slice(0, 100).trimEnd()
  return `${excerpt} ${marker}`
}

function wsjTitle(document: LocalDocument | undefined, docid: string): string {
  const title = document?.title.replace(/\s+/g, ' ').trim()
  if (!title) return docid
  return title.length > 140 ? `${title.slice(0, 139).trimEnd()}…` : title
}

export function getQueryPayload(qid: string, task: TaskId) {
  const query = evidence.queries[qid]
  if (!query) return null
  const taskEvidence = query.tasks[task]
  const ids = [...new Set([...query.before.slice(0, 10), ...taskEvidence.after.slice(0, 10)])]
  const documents = localDocuments()
  return {
    id: qid,
    text: query.text,
    task,
    before: query.before.slice(0, 10),
    after: taskEvidence.after.slice(0, 10),
    beforeMetrics: task === 'documents' ? wsjTop100.before.queries[qid] : taskEvidence.beforeMetrics,
    afterMetrics: task === 'documents' ? wsjTop100.after.queries[qid] : taskEvidence.afterMetrics,
    seconds: taskEvidence.seconds,
    calls: taskEvidence.calls,
    model: evidence.tasks[task].model,
    documents: Object.fromEntries(ids.map(docid => [docid, {
      title: wsjTitle(documents?.[docid], docid),
      judgment: query.judgments[docid] ?? null,
      hasContent: Boolean(documents?.[docid]),
      originalRank: query.before.indexOf(docid) + 1,
      finalRank: taskEvidence.after.indexOf(docid) + 1,
      score: taskEvidence.scores[docid] ? Math.max(...taskEvidence.scores[docid].map(r => r.score)) : null,
    }])),
    contentAvailable: Boolean(documents),
    passagePayloadsAvailable: Boolean(localPassages()),
  }
}

export function getDocumentPayload(qid: string, task: TaskId, docid: string) {
  const query = evidence.queries[qid]
  if (!query || !query.before.slice(0, 100).includes(docid)) return null
  const records = query.tasks[task].scores[docid]
  if (!records) return null
  const document = localDocuments()?.[docid]
  const passages = localPassages()?.[qid]?.[docid]
  const calls = records.map(record => ({
    ...record,
    payload: redactedWsjExcerpt(
      task === 'documents' ? document?.text : passages?.[String(record.passage_index)],
      task === 'documents' ? record.document_tokens! : record.token_end! - record.token_start!,
    ),
    redacted: true,
  }))
  return { docid, title: wsjTitle(document, docid), text: null, calls }
}

export function getMsmarcoOptions() {
  const content = localMsmarco()
  return Object.keys(passageEvidence.queries)
    .sort((a, b) => Number(a) - Number(b))
    .map(id => ({ id, text: content?.queries[id] || `Query ${id}` }))
}

export function getMsmarcoQueryPayload(qid: string, task: PassageTaskId) {
  const query = passageEvidence.queries[qid]
  if (!query) return null
  const taskEvidence = query.tasks[task]
  const ids = [...new Set([...query.before.slice(0, 10), ...taskEvidence.after.slice(0, 10)])]
  const content = localMsmarco()
  return {
    id: qid,
    text: content?.queries[qid] || `Query ${qid}`,
    task,
    before: query.before.slice(0, 10),
    after: taskEvidence.after.slice(0, 10),
    beforeMetrics: taskEvidence.beforeMetrics,
    afterMetrics: taskEvidence.afterMetrics,
    seconds: taskEvidence.seconds,
    calls: taskEvidence.calls,
    model: passageEvidence.tasks[task].model,
    documents: Object.fromEntries(ids.map(docid => [docid, {
      title: passageTitle(content?.passages[docid], docid),
      judgment: query.judgments[docid] ?? null,
      hasContent: Boolean(content?.passages[docid]),
      originalRank: query.before.indexOf(docid) + 1,
      finalRank: taskEvidence.after.indexOf(docid) + 1,
      score: taskEvidence.scores[docid]?.[0]?.score ?? null,
    }])),
    contentAvailable: Boolean(content),
  }
}

export function getMsmarcoDocumentPayload(qid: string, task: PassageTaskId, docid: string) {
  const query = passageEvidence.queries[qid]
  if (!query || !query.tasks[task].scores[docid]) return null
  const content = localMsmarco()
  const original = content?.passages[docid] || null
  const record = query.tasks[task].scores[docid][0]
  const payload = task === 'matched' ? content?.matched[qid]?.[docid] || null : original
  return {
    docid,
    title: passageTitle(original || undefined, docid),
    text: original,
    calls: [{ ...record, payload }],
  }
}
