'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, animate, motion, useReducedMotion } from 'motion/react'
import {
  ArrowPathIcon,
  ArrowRightIcon,
  ArrowTopRightOnSquareIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CommandLineIcon,
  DocumentTextIcon,
  InformationCircleIcon,
  PlayIcon,
} from '@heroicons/react/20/solid'
import { Button } from '@/components/catalyst/button'
import { Select } from '@/components/catalyst/select'
import { ThemeToggle } from '@/components/theme-toggle'
import type { Evidence, MetricKey, Metrics, ScoreRecord, TaskId } from '@/lib/evidence'
import type { getQueryPayload } from '@/lib/server-data'

type QueryPayload = NonNullable<ReturnType<typeof getQueryPayload>>
type Option = { id: string; text: string }
type Phase = 'before' | 'scoring' | 'after'
export type DocumentPayload = {
  docid: string
  title: string
  text: string | null
  calls: (ScoreRecord & { payload: string | null; redacted?: boolean })[]
}

const metricLabels: { key: MetricKey; label: string; help: string }[] = [
  { key: 'map', label: 'AP@100', help: 'Average precision through rank 100. All known relevant articles remain in the denominator; the mean across 50 queries is MAP@100.' },
  { key: 'P_10', label: 'P@10', help: 'Fraction of the first ten results judged relevant.' },
  { key: 'Rprec', label: 'R-prec', help: 'Precision at rank R, where R is the number of known relevant articles, evaluated with a 100-result cutoff.' },
  { key: 'bpref', label: 'bpref', help: 'A preference measure for incomplete judgments, evaluated with a 100-result cutoff.' },
  { key: 'recip_rank', label: 'RR@100', help: 'Reciprocal rank of the first judged relevant article within the first 100 results.' },
]

export function AnimatedNumber({ value, active = true, places = 4, animateIn = false }: { value: number; active?: boolean; places?: number; animateIn?: boolean }) {
  const [display, setDisplay] = useState(active ? animateIn ? 0 : value : 0)
  const current = useRef(display)
  const reduced = useReducedMotion()

  useEffect(() => {
    if (!active) {
      current.current = 0
      setDisplay(0)
      return
    }
    if (reduced) {
      current.current = value
      setDisplay(value)
      return
    }
    const control = animate(current.current, value, {
      duration: 0.85,
      ease: [0.16, 1, 0.3, 1],
      onUpdate(latest) {
        current.current = latest
        setDisplay(latest)
      },
    })
    return () => control.stop()
  }, [active, reduced, value])

  return <span className="tabular-nums">{active ? display.toFixed(places) : '—'}</span>
}

export function RouteMark({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 46 46" fill="none" aria-hidden="true">
      <path d="M5 10h16c8 0 8 10 16 10h4M5 23h36M5 36h16c8 0 8-10 16-10h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="6" cy="10" r="3" fill="currentColor" /><circle cx="40" cy="23" r="3" fill="currentColor" /><circle cx="6" cy="36" r="3" fill="currentColor" />
    </svg>
  )
}

function Judgment({ value }: { value: number | null }) {
  if (value === null) return <span className="judgment judgment-unjudged">Unjudged</span>
  return value > 0
    ? <span className="judgment judgment-relevant"><CheckIcon className="size-3.5" /> Relevant</span>
    : <span className="judgment judgment-irrelevant">Not relevant</span>
}

export function Simulator({ initial, options, taskInfo, source, aggregate }: {
  initial: QueryPayload
  options: Option[]
  taskInfo: Evidence['tasks']
  source: Evidence['source']
  aggregate: { before: Metrics; after: Metrics }
}) {
  const [qid, setQid] = useState(initial.id)
  const task: TaskId = 'documents'
  const [payload, setPayload] = useState<QueryPayload>(initial)
  const [phase, setPhase] = useState<Phase>('before')
  const [showJudgments, setShowJudgments] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'article' | 'call'>('article')
  const [documentData, setDocumentData] = useState<Record<string, DocumentPayload>>({})
  const [documentError, setDocumentError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchController = useRef<AbortController | null>(null)
  const reduced = useReducedMotion()

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    searchController.current?.abort()
  }, [])

  const current = !isLoading && payload.id === qid && payload.task === task
  const visible = phase === 'after' ? payload.after : payload.before
  const afterShown = phase === 'after'
  const activeTask = taskInfo[task]

  function changeQuery(value: string) {
    if (timer.current) clearTimeout(timer.current)
    searchController.current?.abort()
    const controller = new AbortController()
    searchController.current = controller
    setQid(value)
    setPhase('before')
    setOpenId(null)
    setIsLoading(true)
    setLoadError(null)
    const search = fetch(`/api/query?qid=${encodeURIComponent(value)}&task=${task}`, { signal: controller.signal })
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Could not load the saved query.')
        return data as QueryPayload
      })
    Promise.all([search, new Promise<void>(resolve => setTimeout(resolve, reduced ? 0 : 650))])
      .then(([data]) => { if (!controller.signal.aborted) setPayload(data) })
      .catch(error => { if (!controller.signal.aborted) setLoadError(error.message) })
      .finally(() => { if (!controller.signal.aborted) setIsLoading(false) })
  }

  function replay() {
    if (!current || isLoading) return
    if (timer.current) clearTimeout(timer.current)
    setOpenId(null)
    setPhase('before')
    requestAnimationFrame(() => {
      setPhase('scoring')
      timer.current = setTimeout(() => setPhase('after'), reduced ? 100 : 2250)
    })
  }

  function reset() {
    if (timer.current) clearTimeout(timer.current)
    setOpenId(null)
    setPhase('before')
  }

  function toggleResult(docid: string) {
    if (openId === docid) { setOpenId(null); return }
    setOpenId(docid)
    setActiveTab('article')
    setDocumentError(null)
    const key = `${qid}:${task}:${docid}`
    if (documentData[key]) return
    fetch(`/api/document?qid=${encodeURIComponent(qid)}&task=${task}&docid=${encodeURIComponent(docid)}`)
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Could not load this result.')
        setDocumentData(existing => ({ ...existing, [key]: data as DocumentPayload }))
      })
      .catch(error => setDocumentError(error.message))
  }

  return (
    <main className="site-shell">
      <header className="site-header page-wrap">
        <div className="brand"><RouteMark className="brand-mark" /><span>Rerank Lab</span></div>
        <nav className="dataset-nav" aria-label="Experiment dataset"><a href="/" aria-current="page">WSJ</a><a href="/passages">MS MARCO</a></nav>
        <ThemeToggle />
      </header>

      <div className="page-wrap">
        <section className="hero" aria-labelledby="page-title">
          <div className="hero-copy">
            <h1 id="page-title">BM25 retrieves. JEV reranks.</h1>
            <p>Explore the TREC-1 Wall Street Journal subset: 173,252 indexed articles across its 1987–1992 volumes, about 0.5 GB of source text. Each saved BM25 search returns 1,000 articles; JEV reranks the first 100.</p>
            <a className="collection-source" href="https://trec.nist.gov/pubs/trec8/papers/overview_8.pdf" target="_blank" rel="noreferrer">NIST collection statistics <ArrowTopRightOnSquareIcon className="size-4" /></a>
          </div>
        </section>

        <section className="control-room" aria-label="Choose a WSJ search query">
          <div className="control-group query-control"><label className="control-label" htmlFor="query-select">Search query</label><Select id="query-select" value={qid} onChange={event => changeQuery(event.target.value)}>
            {options.map(option => <option key={option.id} value={option.id}>{option.id} · {option.text}</option>)}
          </Select></div>
          <p className="control-context">WSJ / TREC-1 · Complete-document JEV · Fixed candidates</p>
        </section>

        <section className="metrics-section" aria-labelledby="metric-title">
          <div className="section-heading"><div><h2 id="metric-title">Ranking quality · top 100</h2><p>Query {qid}: <strong>{current ? payload.text : 'Loading…'}</strong></p></div></div>
          <div className="metric-board">
            <div className="metric-header"><span>Metric</span><span>BM25</span><span>JEV</span></div>
            {metricLabels.map(({ key, label, help }) => {
              const before = current ? payload.beforeMetrics[key] : 0
              const after = current ? payload.afterMetrics[key] : 0
              const delta = after - before
              return <div className={`metric-row ${key === 'map' ? 'metric-primary' : ''}`} key={key}>
                <div className="metric-name"><span>{label}</span><span className="metric-help" title={help} aria-label={help}><InformationCircleIcon className="size-3.5" /></span></div>
                <div className="metric-before">{current ? <AnimatedNumber value={before} animateIn /> : '—'}</div>
                <div className={`metric-after ${afterShown && delta >= 0 ? 'improved' : ''} ${afterShown && delta < 0 ? 'declined' : ''}`}>
                  {current ? <AnimatedNumber value={after} active={afterShown} /> : '—'}
                  {afterShown && <span className="metric-delta">{delta >= 0 ? '+' : ''}{delta.toFixed(4)}</span>}
                </div>
              </div>
            })}
          </div>
          <p className="metric-footnote">Only ranks 1–100 are evaluated here. AP@100 still counts all known relevant articles in its denominator.</p>
        </section>

        <section className="ranking-section" aria-labelledby="rank-title">
          <div className="section-heading ranking-heading"><div><h2 id="rank-title">Results</h2><p>Top 10 shown · first 100 reranked</p></div><label className="judgment-toggle"><input type="checkbox" checked={showJudgments} onChange={event => setShowJudgments(event.target.checked)} /><span className="toggle-track"><span /></span> Human judgments</label></div>
          <div className="ranking-toolbar">
            <div className="ranking-status"><span className={`status-lamp ${isLoading ? 'searching' : phase}`} /><strong>{isLoading ? 'Searching BM25…' : loadError ? 'Search unavailable' : phase === 'after' ? 'JEV order' : phase === 'scoring' ? 'Scoring' : 'BM25 order'}</strong></div>
            <div className="toolbar-actions">{phase === 'after' && <button type="button" className="quiet-action" onClick={reset}><ArrowPathIcon className="size-4" /> Reset</button>}<Button type="button" color="emerald" onClick={replay} disabled={!current || phase === 'scoring'}><PlayIcon data-slot="icon" />Replay JEV</Button></div>
          </div>
          {isLoading && <div className="replay-progress" role="status" aria-label="Replaying the saved BM25 search"><span className="search-progress-fill" /></div>}
          {phase === 'scoring' && <div className="replay-progress" role="status"><span className="replay-progress-fill" /><span className="sr-only">Playing back recorded JEV scores before reordering.</span></div>}
          {loadError && <div className="inline-error">{loadError} <button type="button" onClick={() => changeQuery(source.defaultQuery)}>Return to the default query</button></div>}
          {!payload.contentAvailable && <div className="content-alert"><DocumentTextIcon className="size-5" /><span>Article names and redacted input excerpts are not installed on this server. Rankings and measured scores still replay.</span></div>}
          {!current ? <div className="ranking-loading">{loadError ? 'Search unavailable.' : 'Replaying saved BM25 search…'}</div> : <ol className="result-list">
            <AnimatePresence initial={false} mode="popLayout">
              {visible.map((docid, index) => {
                const doc = payload.documents[docid]
                if (!doc) return null
                const isOpen = openId === docid
                const key = `${qid}:${task}:${docid}`
                const details = documentData[key]
                const movement = doc.originalRank - doc.finalRank
                return <motion.li key={docid} layout="position" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} transition={{ layout: { type: 'spring', stiffness: 340, damping: 34 }, opacity: { duration: 0.2 } }} className={`result-row ${isOpen ? 'result-open' : ''}`}>
                  <div className="result-main">
                    <div className="rank-cell"><span className="rank-number">{String(index + 1).padStart(2, '0')}</span></div>
                    <div className="result-copy"><div className="result-eyeline"><span className="doc-id">{docid}</span>{showJudgments && <Judgment value={doc.judgment} />}</div><button type="button" className="result-title" aria-expanded={isOpen} onClick={() => toggleResult(docid)}>{doc.title}<span className="result-open-icon">{isOpen ? <ChevronUpIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}</span></button>{phase === 'after' && <div className="result-subline"><span className={movement > 0 ? 'moved-up' : movement < 0 ? 'moved-down' : ''}>{movement > 0 ? `↑ ${movement} from BM25` : movement < 0 ? `↓ ${Math.abs(movement)} from BM25` : 'Same rank'}</span></div>}</div>
                    <div className="result-score">{phase !== 'before' && doc.score !== null ? <motion.div initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: phase === 'scoring' && !reduced ? Math.min(index * 0.13, 1.2) : 0 }}><small>JEV</small><strong><AnimatedNumber value={doc.score} places={2} animateIn /></strong></motion.div> : <span className="score-pending">—</span>}</div>
                  </div>
                  <AnimatePresence initial={false}>{isOpen && <motion.div className="result-details" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: reduced ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] }}><div className="details-inner"><div className="details-tabs" role="tablist" aria-label={`Inspect ${docid}`}><button type="button" role="tab" aria-selected={activeTab === 'article'} onClick={() => setActiveTab('article')}><DocumentTextIcon className="size-4" /> Article</button><button type="button" role="tab" aria-selected={activeTab === 'call'} onClick={() => setActiveTab('call')}><CommandLineIcon className="size-4" /> JEV call</button></div>{documentError ? <div className="inline-error">{documentError}</div> : !details ? <div className="details-loading">Loading the saved result…</div> : activeTab === 'article' ? <div className="article-pane"><div className="pane-head"><strong>{details.title}</strong><span>Full text withheld</span></div><p>WSJ text is withheld. The JEV call shows a short, redacted excerpt.</p></div> : <CallPane details={details} task={task} query={payload.text} question={activeTask.question} />}</div></motion.div>}</AnimatePresence>
                </motion.li>
              })}
            </AnimatePresence>
          </ol>}
          <div className="ranking-tail"><span>Ranks 101–1,000 receive no JEV scores.</span><span>{phase === 'after' ? `${payload.seconds.toFixed(2)} s · ${payload.calls} recorded calls` : 'Saved experiment replay'}</span></div>
        </section>

        <section className="evidence-section" aria-labelledby="evidence-title"><div className="evidence-intro"><h2 id="evidence-title">Across 50 TREC-1 topics</h2><p>Top-100 metrics on fixed BM25 candidates.</p></div><div className="evidence-facts"><div><span>MAP@100</span><strong>{aggregate.before.map.toFixed(4)} <ArrowRightIcon className="size-4" /> {aggregate.after.map.toFixed(4)}</strong><small>BM25 → JEV</small></div><div><span>Reranking time</span><strong>{activeTask.rerankSeconds.toFixed(1)} s</strong><small>Uncached run</small></div><div><span>Estimated API cost</span><strong>${activeTask.estimatedCostUsd.toFixed(3)}</strong><small>Successful responses</small></div></div><div className="evidence-bottom"><span>{activeTask.calls.toLocaleString()} scored articles · {activeTask.model} · recorded replay</span><a href="https://github.com/carlaiau/jev-reranking/blob/main/reranking/results/jev-comparison-20260918.md" target="_blank" rel="noreferrer">Full-run report <ArrowTopRightOnSquareIcon className="size-4" /></a></div></section>
      </div>
    </main>
  )
}

export function CallPane({ details, task, query, question, stateField = 'candidate_article' }: {
  details: DocumentPayload
  task: TaskId | 'matched' | 'original'
  query: string
  question: Evidence['tasks'][TaskId]['question']
  stateField?: 'candidate_article' | 'candidate_passage'
}) {
  const [selected, setSelected] = useState(0)
  useEffect(() => setSelected(0), [details.docid, task])
  const sorted = [...details.calls].sort((a, b) => b.score - a.score || (a.passage_index ?? 0) - (b.passage_index ?? 0))
  const record = sorted[Math.min(selected, sorted.length - 1)]
  const call = {
    model: 'jev-latest',
    state: { query, [stateField]: record.payload ?? '[locally provisioned passage text required]' },
    questions: { relevant: question },
  }
  return <div className="call-pane"><div className="call-summary"><div><span>Recorded JEV answer</span><strong>{record.score.toFixed(2)}</strong><small>Relevance score · 0 to 1</small></div><div><span>Model</span><strong>{record.model}</strong><small>{record.inputTokens.toLocaleString()} total API input · {record.outputTokens} output tokens</small></div><div><span>Call time</span><strong>{record.seconds.toFixed(2)} s</strong><small>{record.cacheHit ? 'Cache replay' : 'Uncached response'}</small></div></div>{task === 'passages' && <div className="passage-chooser"><label htmlFor={`passage-${details.docid}`}>Scored passage</label><select id={`passage-${details.docid}`} value={selected} onChange={event => setSelected(Number(event.target.value))}>{sorted.map((item, index) => <option key={item.passage_index} value={index}>Window {item.passage_index! + 1} · score {item.score.toFixed(2)}{index === 0 ? ' · MaxP winner' : ''}</option>)}</select><p>Each saved window received its own call. The highest passage score is the article score used for ranking.</p></div>}<div className="code-head"><span>{record.redacted ? 'REQUEST SHAPE · REDACTED INPUT' : 'REQUEST SHAPE · RECORDED INPUT'}</span><span>{record.redacted ? 'Recorded length; body redacted' : record.payload ? 'Payload hash verified' : 'Payload text unavailable'}</span></div><pre className="call-code"><code>{JSON.stringify(call, null, 2)}</code></pre>{record.redacted && <p className="call-redaction-note">The marker counts BERT source tokens sent as the article or passage. Total API input tokens above also include the query and question.</p>}<div className="code-head response-head"><span>RECORDED RESULT</span><span>Source: scores.jsonl</span></div><pre className="call-code response-code"><code>{JSON.stringify({ score: record.score, model: record.model, usage: { input_tokens: record.inputTokens, output_tokens: record.outputTokens } }, null, 2)}</code></pre></div>
}
