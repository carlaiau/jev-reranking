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
  DocumentTextIcon,
  PlayIcon,
} from '@heroicons/react/20/solid'
import { Button } from '@/components/catalyst/button'
import { MetricTooltip } from '@/components/metric-tooltip'
import { Select } from '@/components/catalyst/select'
import { ThemeToggle } from '@/components/theme-toggle'
import type { Evidence, ScoreRecord, TaskId } from '@/lib/evidence'
import type { getQueryPayload } from '@/lib/server-data'
import type { WsjMetricKey, WsjMetrics } from '@/lib/wsj-top100'

type QueryPayload = NonNullable<Awaited<ReturnType<typeof getQueryPayload>>>
type Option = { id: string; text: string }
type Phase = 'before' | 'scoring' | 'after'
const AUTO_REPLAY_DELAY_MS = 800
const SEARCH_REPLAY_MS = 350
const SCORE_REPLAY_MS = 1300
const REORDER_SETTLE_MS = 700
export type DocumentPayload = {
  docid: string
  title: string
  text: string | null
  calls: (ScoreRecord & { payload: string | null; redacted?: boolean })[]
}

const metricLabels: { key: WsjMetricKey; label: string; meaning: string; purpose: string }[] = [
  { key: 'ndcg_cut_10', label: 'nDCG@10', meaning: 'Ranking quality in the first ten positions, with more credit when relevant articles appear earlier. WSJ judgments are binary.', purpose: 'The headline measure of how reranking changes the most visible results.' },
  { key: 'map', label: 'AP@100', meaning: 'Average precision through rank 100 for this query. All known relevant articles remain in the denominator; the mean across 50 queries is MAP@100.', purpose: 'The traditional WSJ measure, shown at the depth JEV reranks.' },
  { key: 'P_10', label: 'P@10', meaning: 'The share of the first ten articles judged relevant.', purpose: 'An intuitive check you can compare with the visible results.' },
  { key: 'bpref', label: 'bpref', meaning: 'Compares judged relevant articles with judged nonrelevant articles, reducing the effect of unjudged results.', purpose: 'A robustness check for judgments collected from pooled search systems.' },
  { key: 'recall_100', label: 'Recall@100', meaning: 'The share of all known relevant articles already present in BM25’s first 100 results.', purpose: 'Those candidates are fixed, so JEV cannot recover relevant articles outside this set.' },
  { key: 'judged_10', label: 'Judged@10', meaning: 'The share of the visible first ten articles that received any human judgment, relevant or not.', purpose: 'Shows how much of the top ten the judgment pool actually covers.' },
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

export function RelativeChange({ before, after }: { before: number; after: number }) {
  if (before === 0) return <span className="metric-delta">{after === 0 ? 'No change' : 'From 0'}</span>
  const percent = (after - before) / before * 100
  return <span className="metric-delta">{percent > 0 ? '+' : ''}<AnimatedNumber value={percent} places={1} />%</span>
}

export function RouteMark({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect width="48" height="48" rx="11" fill="currentColor" />
      <path d="M10 15h9c8 0 8 18 16 18h3M10 33h9c8 0 8-18 16-18h3" stroke="var(--ground)" strokeWidth="3.5" strokeLinecap="round" />
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
  aggregate: { before: WsjMetrics; after: WsjMetrics }
}) {
  const [qid, setQid] = useState(initial.id)
  const task: TaskId = 'documents'
  const [payload, setPayload] = useState<QueryPayload>(initial)
  const [phase, setPhase] = useState<Phase>('before')
  const [replayReady, setReplayReady] = useState(false)
  const [showJudgments, setShowJudgments] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [documentData, setDocumentData] = useState<Record<string, DocumentPayload>>({})
  const [documentError, setDocumentError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadingHeight, setLoadingHeight] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const replayFrame = useRef<number | null>(null)
  const resultList = useRef<HTMLOListElement | null>(null)
  const searchController = useRef<AbortController | null>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    autoTimer.current = setTimeout(startReplay, reduced ? 300 : AUTO_REPLAY_DELAY_MS)
    return () => {
      clearPlayback()
      searchController.current?.abort()
    }
  }, [])

  function clearPlayback() {
    if (timer.current) clearTimeout(timer.current)
    if (autoTimer.current) clearTimeout(autoTimer.current)
    if (settleTimer.current) clearTimeout(settleTimer.current)
    if (replayFrame.current !== null) cancelAnimationFrame(replayFrame.current)
  }

  const current = !isLoading && payload.id === qid && payload.task === task
  const visible = phase === 'after' ? payload.after : payload.before
  const afterShown = phase === 'after'
  const activeTask = taskInfo[task]

  function changeQuery(value: string) {
    clearPlayback()
    if (resultList.current) setLoadingHeight(resultList.current.offsetHeight)
    searchController.current?.abort()
    const controller = new AbortController()
    searchController.current = controller
    setQid(value)
    setPhase('before')
    setReplayReady(false)
    setOpenId(null)
    setIsLoading(true)
    setLoadError(null)
    const search = fetch(`/api/query?qid=${encodeURIComponent(value)}&task=${task}`, { signal: controller.signal })
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Could not load the saved query.')
        return data as QueryPayload
      })
    Promise.all([search, new Promise<void>(resolve => setTimeout(resolve, reduced ? 0 : SEARCH_REPLAY_MS))])
      .then(([data]) => {
        if (controller.signal.aborted) return
        setPayload(data)
        autoTimer.current = setTimeout(() => { if (!controller.signal.aborted) startReplay() }, reduced ? 300 : AUTO_REPLAY_DELAY_MS)
      })
      .catch(error => { if (!controller.signal.aborted) setLoadError(error.message) })
      .finally(() => { if (!controller.signal.aborted) setIsLoading(false) })
  }

  function startReplay() {
    clearPlayback()
    setReplayReady(false)
    setOpenId(null)
    setPhase('before')
    replayFrame.current = requestAnimationFrame(() => {
      replayFrame.current = null
      setPhase('scoring')
      timer.current = setTimeout(() => {
        timer.current = null
        setPhase('after')
        settleTimer.current = setTimeout(() => {
          settleTimer.current = null
          setReplayReady(true)
        }, reduced ? 0 : REORDER_SETTLE_MS)
      }, reduced ? 100 : SCORE_REPLAY_MS)
    })
  }

  function replay() {
    if (!current) return
    startReplay()
  }

  function reset() {
    clearPlayback()
    setOpenId(null)
    setPhase('before')
    setReplayReady(false)
  }

  function toggleResult(docid: string) {
    if (openId === docid) { setOpenId(null); return }
    setOpenId(docid)
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
        <div className="brand"><RouteMark className="brand-mark" /><span>JEV reranking</span></div>
        <nav className="dataset-nav" aria-label="Experiment dataset"><a href="/" aria-current="page">WSJ</a><a href="/passages">MS MARCO</a></nav>
        <ThemeToggle />
      </header>

      <div className="page-wrap">
        <section className="hero" aria-labelledby="page-title">
          <div className="hero-copy">
            <h1 id="page-title">BM25 retrieves. JEV reranks.</h1>
            <p>Explore the TREC-1 Wall Street Journal subset: 173,252 indexed articles across its 1987–1992 volumes, about 0.5 GB of source text. Each saved BM25 search returns 1,000 articles; JEV scores the first 100 as complete documents.</p>
            <a className="collection-source" href="https://trec.nist.gov/pubs/trec8/papers/overview_8.pdf" target="_blank" rel="noreferrer">NIST collection statistics <ArrowTopRightOnSquareIcon className="size-4" /></a>
          </div>
        </section>

        <section className="control-room" aria-label="Choose a WSJ search query">
          <div className="control-group query-control"><label className="control-label" htmlFor="query-select">Search query</label><Select id="query-select" value={qid} onChange={event => changeQuery(event.target.value)}>
            {options.map(option => <option key={option.id} value={option.id}>{option.text}</option>)}
          </Select></div>
          <p className="control-context" aria-live="polite">{isLoading ? 'Searching BM25…' : loadError ? 'Search unavailable' : phase === 'scoring' ? 'JEV reranking…' : phase === 'after' ? 'JEV order' : 'BM25 order'}</p>
        </section>

        <section className="metrics-section" aria-labelledby="metric-title">
          <div className="section-heading"><h2 id="metric-title">Ranking quality · top 100</h2></div>
          <div className="metric-board">
            <div className="metric-header"><span>Metric</span><span>BM25</span><span>JEV</span></div>
            {metricLabels.map(({ key, label, meaning, purpose }) => {
              const before = current ? (payload.beforeMetrics as WsjMetrics)[key] : 0
              const after = current ? (payload.afterMetrics as WsjMetrics)[key] : 0
              const delta = after - before
              const fixed = key === 'recall_100'
              return <div className={`metric-row ${key === 'ndcg_cut_10' ? 'metric-primary' : ''}`} key={key}>
                <div className="metric-name"><MetricTooltip label={label} meaning={meaning} purpose={purpose} /></div>
                <div className="metric-before">{current ? <AnimatedNumber value={before} animateIn /> : '—'}</div>
                <div className={`metric-after ${afterShown && !fixed && delta >= 0 ? 'improved' : ''} ${afterShown && !fixed && delta < 0 ? 'declined' : ''}`}>
                  {current ? <AnimatedNumber value={after} active={afterShown} /> : '—'}
                  {afterShown && (fixed ? <span className="metric-delta">Fixed set</span> : <RelativeChange before={before} after={after} />)}
                </div>
              </div>
            })}
          </div>
          <p className="metric-footnote">Percentage change is relative to BM25. Recall@100 stays fixed because JEV reorders the same 100 candidates.</p>
        </section>

        <section className="ranking-section" aria-labelledby="rank-title">
          <div className="section-heading ranking-heading"><div><h2 id="rank-title">Results</h2><p>Top 10 shown · first 100 reranked</p></div><label className="judgment-toggle"><input type="checkbox" checked={showJudgments} onChange={event => setShowJudgments(event.target.checked)} /><span className="toggle-track"><span /></span> Human judgments</label></div>
          <div className="ranking-toolbar">
            <div className="ranking-status"><span className={`status-lamp ${isLoading ? 'searching' : phase}`} /><strong>{isLoading ? 'Searching BM25…' : loadError ? 'Search unavailable' : phase === 'after' ? 'JEV order' : phase === 'scoring' ? 'Scoring' : 'BM25 order'}</strong></div>
            <div className="toolbar-actions">{afterShown && replayReady && <><button type="button" className="quiet-action" onClick={reset}><ArrowPathIcon className="size-4" /> Reset</button><Button type="button" color="emerald" onClick={replay}><PlayIcon data-slot="icon" />Replay JEV</Button></>}</div>
          </div>
          {isLoading && <div className="replay-progress" role="status" aria-label="Replaying the saved BM25 search"><span className="search-progress-fill" /></div>}
          {phase === 'scoring' && <div className="replay-progress" role="status"><span className="replay-progress-fill" /><span className="sr-only">Playing back recorded JEV scores before reordering.</span></div>}
          {loadError && <div className="inline-error">{loadError} <button type="button" onClick={() => changeQuery(source.defaultQuery)}>Return to the default query</button></div>}
          {!payload.contentAvailable && <div className="content-alert"><DocumentTextIcon className="size-5" /><span>Some article names are missing from the imported collection.</span></div>}
          {!current ? <div className="ranking-loading" style={loadingHeight ? { minHeight: loadingHeight } : undefined}>{loadError ? 'Search unavailable.' : 'Replaying saved BM25 search…'}</div> : <ol className="result-list" ref={resultList}>
            <AnimatePresence initial={false} mode="popLayout">
              {visible.map((docid, index) => {
                const doc = payload.documents[docid]
                if (!doc) return null
                const isOpen = openId === docid
                const key = `${qid}:${task}:${docid}`
                const details = documentData[key]
                const movement = doc.originalRank - doc.finalRank
                return <motion.li key={docid} layout="position" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} transition={{ layout: { type: 'spring', stiffness: 340, damping: 34 }, opacity: { duration: 0.2 } }} className={`result-row ${isOpen ? 'result-open' : ''}`}>
                  <div className="result-main" role="button" tabIndex={0} aria-expanded={isOpen} aria-label={`${doc.title}. ${isOpen ? 'Hide' : 'Show'} JEV call`} onClick={() => toggleResult(docid)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleResult(docid) } }}>
                    <div className="rank-cell"><span className="rank-number">{String(index + 1).padStart(2, '0')}</span></div>
                    <div className="result-copy"><div className="result-eyeline"><span className="doc-id">{docid}</span>{showJudgments && <Judgment value={doc.judgment} />}</div><div className="result-title">{doc.title}<span className="result-open-icon">{isOpen ? <ChevronUpIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}</span></div>{phase === 'after' && <div className="result-subline"><span className={movement > 0 ? 'moved-up' : movement < 0 ? 'moved-down' : ''}>{movement > 0 ? `↑ ${movement} from BM25` : movement < 0 ? `↓ ${Math.abs(movement)} from BM25` : 'Same rank'}</span></div>}</div>
                    <div className="result-score">{phase !== 'before' && doc.score !== null ? <motion.div initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: phase === 'scoring' && !reduced ? Math.min(index * 0.05, 0.45) : 0 }}><small>JEV</small><strong><AnimatedNumber value={doc.score} places={2} animateIn /></strong></motion.div> : <span className="score-pending">—</span>}</div>
                  </div>
                  <AnimatePresence initial={false}>{isOpen && <motion.div className="result-details" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: reduced ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] }}><div className="details-inner">{documentError ? <div className="inline-error">{documentError}</div> : !details ? <div className="details-loading">Loading the saved result…</div> : <CallPane details={details} task={task} query={payload.text} question={activeTask.question} />}</div></motion.div>}</AnimatePresence>
                </motion.li>
              })}
            </AnimatePresence>
          </ol>}
          <div className="ranking-tail"><span>Ranks 101–1,000 receive no JEV scores.</span><span>{phase === 'after' ? `${payload.seconds.toFixed(2)} s · ${payload.calls} recorded calls` : 'Saved experiment replay'}</span></div>
        </section>

        <section className="evidence-section" aria-labelledby="evidence-title"><div className="evidence-intro"><h2 id="evidence-title">Across 50 TREC-1 topics</h2><p>Top-ten ranking quality on fixed BM25 candidates.</p></div><div className="evidence-facts"><div><span>nDCG@10</span><strong>{aggregate.before.ndcg_cut_10.toFixed(4)} <ArrowRightIcon className="size-4" /> {aggregate.after.ndcg_cut_10.toFixed(4)}</strong><small>BM25 → JEV</small></div><div><span>Reranking time</span><strong>{activeTask.rerankSeconds.toFixed(1)} s</strong><small>Uncached run</small></div><div><span>Estimated API cost</span><strong>${activeTask.estimatedCostUsd.toFixed(3)}</strong><small>Successful responses</small></div></div><div className="evidence-bottom"><span>{activeTask.calls.toLocaleString()} scored articles · {activeTask.model} · recorded replay</span><a href="https://github.com/carlaiau/jev-reranking/blob/main/reranking/results/jev-comparison-20260918.md" target="_blank" rel="noreferrer">Full-run report <ArrowTopRightOnSquareIcon className="size-4" /></a></div></section>
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
    state: { query, [stateField]: record.payload ?? '[recorded passage text unavailable]' },
    questions: { relevant: question },
  }
  return <div className="call-pane"><div className="call-summary"><div><span>Recorded JEV answer</span><strong>{record.score.toFixed(2)}</strong><small>Relevance score · 0 to 1</small></div><div><span>Model</span><strong>{record.model}</strong><small>{record.inputTokens.toLocaleString()} total API input · {record.outputTokens} output tokens</small></div><div><span>Call time</span><strong>{record.seconds.toFixed(2)} s</strong><small>{record.cacheHit ? 'Cache replay' : 'Uncached response'}</small></div></div>{task === 'passages' && <div className="passage-chooser"><label htmlFor={`passage-${details.docid}`}>Scored passage</label><select id={`passage-${details.docid}`} value={selected} onChange={event => setSelected(Number(event.target.value))}>{sorted.map((item, index) => <option key={item.passage_index} value={index}>Window {item.passage_index! + 1} · score {item.score.toFixed(2)}{index === 0 ? ' · MaxP winner' : ''}</option>)}</select><p>Each saved window received its own call. The highest passage score is the article score used for ranking.</p></div>}<div className="code-head"><span>{record.redacted ? 'REQUEST SHAPE · REDACTED INPUT' : 'REQUEST SHAPE · RECORDED INPUT'}</span><span>{record.redacted ? 'Recorded length; body redacted' : record.payload ? 'Payload hash verified' : 'Payload text unavailable'}</span></div><pre className="call-code"><code>{JSON.stringify(call, null, 2)}</code></pre>{record.redacted && <p className="call-redaction-note">The marker counts BERT source tokens sent as the article or passage. Total API input tokens above also include the query and question.</p>}<div className="code-head response-head"><span>RECORDED RESULT</span><span>Source: scores.jsonl</span></div><pre className="call-code response-code"><code>{JSON.stringify({ score: record.score, model: record.model, usage: { input_tokens: record.inputTokens, output_tokens: record.outputTokens } }, null, 2)}</code></pre></div>
}
