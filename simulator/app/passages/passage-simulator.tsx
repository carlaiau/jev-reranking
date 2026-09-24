'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowPathIcon, ArrowRightIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, CommandLineIcon, DocumentTextIcon, PlayIcon } from '@heroicons/react/20/solid'
import { Button } from '@/components/catalyst/button'
import { MetricTooltip } from '@/components/metric-tooltip'
import { Select } from '@/components/catalyst/select'
import { ThemeToggle } from '@/components/theme-toggle'
import { AnimatedNumber, CallPane, RelativeChange, RouteMark, type DocumentPayload } from '../simulator'
import type { PassageEvidence, PassageMetricKey, PassageMetrics, PassageTaskId } from '@/lib/msmarco-evidence'
import type { getMsmarcoQueryPayload } from '@/lib/server-data'

type QueryPayload = NonNullable<ReturnType<typeof getMsmarcoQueryPayload>>
type Phase = 'before' | 'scoring' | 'after'
type Option = { id: string; text: string }
const AUTO_REPLAY_DELAY_MS = 2200
const REORDER_SETTLE_MS = 700

const metricLabels: { key: Exclude<PassageMetricKey, 'recall_100'>; label: string; meaning: string; purpose: string }[] = [
  { key: 'ndcg_cut_10', label: 'nDCG@10', meaning: 'Ranking quality in the first ten positions using the original 0–3 relevance grades, with more credit for earlier answers.', purpose: 'The official headline measure for this passage task.' },
  { key: 'map', label: 'AP@100', meaning: 'Average precision through rank 100 for this query. Grades 2 and 3 count as relevant; the 43-query mean is MAP@100.', purpose: 'Shows relevant-answer coverage at the depth this replay reranks.' },
  { key: 'rr_10', label: 'RR@10', meaning: 'Reciprocal rank of the first passage graded 2 or 3 within the first ten positions.', purpose: 'A secondary check for how quickly the first answer appears.' },
  { key: 'judged_10', label: 'Judged@10', meaning: 'The share of the first ten positions containing a passage with any NIST judgment, regardless of grade.', purpose: 'Checks whether newly promoted passages were covered by the judgment pool.' },
]

function Grade({ grade }: { grade: number | null }) {
  if (grade === null) return <span className="judgment judgment-unjudged">Unjudged</span>
  if (grade === 3) return <span className="judgment judgment-relevant"><CheckIcon className="size-3.5" /> 3 · Exact answer</span>
  if (grade === 2) return <span className="judgment judgment-relevant"><CheckIcon className="size-3.5" /> 2 · Limited answer</span>
  if (grade === 1) return <span className="judgment judgment-partial">1 · Related</span>
  return <span className="judgment judgment-irrelevant">0 · Irrelevant</span>
}

export function PassageSimulator({ initial, options, taskInfo, referenceMetrics }: {
  initial: QueryPayload
  options: Option[]
  taskInfo: PassageEvidence['tasks']
  referenceMetrics: PassageMetrics
}) {
  const [qid, setQid] = useState(initial.id)
  const task: PassageTaskId = 'original'
  const [payload, setPayload] = useState<QueryPayload>(initial)
  const [phase, setPhase] = useState<Phase>('before')
  const [replayReady, setReplayReady] = useState(false)
  const [showGrades, setShowGrades] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'passage' | 'call'>('passage')
  const [documentData, setDocumentData] = useState<Record<string, DocumentPayload>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [documentError, setDocumentError] = useState<string | null>(null)
  const [loadingHeight, setLoadingHeight] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const replayFrame = useRef<number | null>(null)
  const resultList = useRef<HTMLOListElement | null>(null)
  const searchController = useRef<AbortController | null>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    autoTimer.current = setTimeout(startReplay, AUTO_REPLAY_DELAY_MS)
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
  const activeTask = taskInfo[task]
  const afterShown = phase === 'after'

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
    const search = fetch(`/api/msmarco/query?qid=${encodeURIComponent(value)}&task=${task}`, { signal: controller.signal })
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Could not load the saved query.')
        return data as QueryPayload
      })
    Promise.all([search, new Promise<void>(resolve => setTimeout(resolve, reduced ? 0 : 650))])
      .then(([data]) => {
        if (controller.signal.aborted) return
        setPayload(data)
        autoTimer.current = setTimeout(() => { if (!controller.signal.aborted) startReplay() }, AUTO_REPLAY_DELAY_MS)
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
      }, reduced ? 100 : 2250)
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
    setActiveTab('passage')
    setDocumentError(null)
    const key = `${qid}:${task}:${docid}`
    if (documentData[key]) return
    fetch(`/api/msmarco/document?qid=${encodeURIComponent(qid)}&task=${task}&docid=${encodeURIComponent(docid)}`)
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Could not load this passage.')
        setDocumentData(existing => ({ ...existing, [key]: data as DocumentPayload }))
      })
      .catch(error => setDocumentError(error.message))
  }

  return <main className="site-shell passage-site">
    <header className="site-header page-wrap"><div className="brand"><RouteMark className="brand-mark" /><span>Rerank Lab</span></div><nav className="dataset-nav" aria-label="Experiment dataset"><a href="/">WSJ</a><a href="/passages" aria-current="page">MS MARCO</a></nav><ThemeToggle /></header>
    <div className="page-wrap">
      <section className="hero passage-hero" aria-labelledby="passage-title">
        <div className="hero-copy">
          <h1 id="passage-title">Passages, reranked.</h1>
          <p><a href="https://microsoft.github.io/msmarco/Datasets.html" target="_blank" rel="noreferrer">MS MARCO v1</a> contains 8,841,823 passages from millions of web pages. The saved <a href="https://trec.nist.gov/data/deep2019.html" target="_blank" rel="noreferrer">TREC DL 2019</a> experiment scored 41,042 supplied pairs across 43 queries. This view compares monoBERT and JEV on up to 100 monoBERT-ranked candidates per query, using JEV’s recorded original-text scores.</p>
        </div>
      </section>

      <section className="control-room" aria-label="Choose an MS MARCO query">
        <div className="control-group query-control"><label className="control-label" htmlFor="passage-query">Search query</label><Select id="passage-query" value={qid} onChange={event => changeQuery(event.target.value)}>{options.map(option => <option key={option.id} value={option.id}>{option.text}</option>)}</Select></div>
        <p className="control-context" aria-live="polite">{isLoading ? 'Loading monoBERT results…' : loadError ? 'Results unavailable' : phase === 'scoring' ? 'JEV reranking…' : phase === 'after' ? 'JEV order' : 'monoBERT order'}</p>
      </section>

      <section className="metrics-section" aria-labelledby="passage-metric-title">
        <div className="section-heading"><h2 id="passage-metric-title">Ranking quality · top 100</h2></div>
        <div className="metric-board">
          <div className="metric-header"><span>Metric</span><span>monoBERT</span><span>JEV</span></div>
          {metricLabels.map(({ key, label, meaning, purpose }) => {
            const before = current ? payload.beforeMetrics[key] : 0
            const after = current ? payload.afterMetrics[key] : 0
            const delta = after - before
            return <div className={`metric-row ${key === 'ndcg_cut_10' ? 'metric-primary' : ''}`} key={key}>
              <div className="metric-name"><MetricTooltip label={label} meaning={meaning} purpose={purpose} /></div>
              <div className="metric-before">{current ? <AnimatedNumber value={before} animateIn /> : '—'}</div>
              <div className={`metric-after ${afterShown && delta >= 0 ? 'improved' : ''} ${afterShown && delta < 0 ? 'declined' : ''}`}>{current ? <AnimatedNumber value={after} active={afterShown} /> : '—'}{afterShown && <RelativeChange before={before} after={after} />}</div>
            </div>
          })}
          <div className="metric-row metric-coverage">
            <div className="metric-name"><MetricTooltip label="Recall@100" meaning="The share of passages graded 2 or 3 already present in monoBERT’s first 100 candidates." purpose="This fixed shortlist is the ceiling for JEV in this replay; rescoring cannot add a missing passage." /></div>
            <div className="metric-before">{current ? <AnimatedNumber value={payload.beforeMetrics.recall_100} animateIn /> : '—'}</div>
            <div className="metric-coverage-note">Fixed shortlist</div>
          </div>
        </div>
        <p className="metric-footnote">Percentage change is relative to monoBERT. nDCG@10 uses grades 0–3; AP@100 and RR@10 count grades 2–3 as relevant.</p>
      </section>

      <section className="ranking-section" aria-labelledby="passage-rank-title"><div className="section-heading ranking-heading"><div><h2 id="passage-rank-title">Results</h2><p>Up to 10 shown · up to 100 reranked</p></div><label className="judgment-toggle"><input type="checkbox" checked={showGrades} onChange={event => setShowGrades(event.target.checked)} /><span className="toggle-track"><span /></span> NIST grades</label></div><div className="ranking-toolbar"><div className="ranking-status"><span className={`status-lamp ${isLoading ? 'searching' : phase}`} /><strong>{isLoading ? 'Loading monoBERT results…' : loadError ? 'Results unavailable' : phase === 'after' ? 'JEV order' : phase === 'scoring' ? 'Scoring' : 'monoBERT order'}</strong></div><div className="toolbar-actions">{afterShown && replayReady && <><button type="button" className="quiet-action" onClick={reset}><ArrowPathIcon className="size-4" /> Reset</button><Button type="button" color="emerald" onClick={replay}><PlayIcon data-slot="icon" />Replay JEV</Button></>}</div></div>{isLoading && <div className="replay-progress" role="status" aria-label="Loading the saved monoBERT reference ranking"><span className="search-progress-fill" /></div>}{phase === 'scoring' && <div className="replay-progress" role="status"><span className="replay-progress-fill" /><span className="sr-only">Playing back recorded passage scores before reordering.</span></div>}{loadError && <div className="inline-error">{loadError}</div>}{!payload.contentAvailable && <div className="content-alert"><DocumentTextIcon className="size-5" /><span>Passage text is not installed on this server. Rankings still replay; prepare the local licensed TREC DL 2019 source files to inspect passages and exact calls.</span></div>}{!current ? <div className="ranking-loading" style={loadingHeight ? { minHeight: loadingHeight } : undefined}>{loadError ? 'Results unavailable.' : 'Loading saved monoBERT results…'}</div> : <ol className="result-list" ref={resultList}><AnimatePresence initial={false} mode="popLayout">{visible.map((docid, index) => {
        const doc = payload.documents[docid]
        if (!doc) return null
        const isOpen = openId === docid
        const details = documentData[`${qid}:${task}:${docid}`]
        const movement = doc.originalRank - doc.finalRank
        return <motion.li key={docid} layout="position" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} transition={{ layout: { type: 'spring', stiffness: 340, damping: 34 }, opacity: { duration: .2 } }} className={`result-row ${isOpen ? 'result-open' : ''}`}><div className="result-main" role="button" tabIndex={0} aria-expanded={isOpen} aria-label={`${doc.title}. ${isOpen ? 'Hide' : 'Show'} passage details`} onClick={() => toggleResult(docid)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleResult(docid) } }}><div className="rank-cell"><span className="rank-number">{String(index + 1).padStart(2, '0')}</span></div><div className="result-copy"><div className="result-eyeline"><span className="doc-id">PASSAGE {docid}</span>{showGrades && <Grade grade={doc.judgment} />}</div><div className="result-title">{doc.title}<span className="result-open-icon">{isOpen ? <ChevronUpIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}</span></div>{afterShown && <div className="result-subline"><span className={movement > 0 ? 'moved-up' : movement < 0 ? 'moved-down' : ''}>{movement > 0 ? `↑ ${movement} from monoBERT` : movement < 0 ? `↓ ${Math.abs(movement)} from monoBERT` : 'Same rank'}</span></div>}</div><div className="result-score">{phase !== 'before' && doc.score !== null ? <motion.div initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: phase === 'scoring' && !reduced ? Math.min(index * .13, 1.2) : 0 }}><small>JEV</small><strong><AnimatedNumber value={doc.score} places={2} animateIn /></strong></motion.div> : <span className="score-pending">—</span>}</div></div><AnimatePresence initial={false}>{isOpen && <motion.div className="result-details" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: reduced ? 0 : .28, ease: [0.16, 1, 0.3, 1] }}><div className="details-inner"><div className="details-tabs" role="tablist" aria-label={`Inspect passage ${docid}`}><button type="button" role="tab" aria-selected={activeTab === 'passage'} onClick={() => setActiveTab('passage')}><DocumentTextIcon className="size-4" /> Passage</button><button type="button" role="tab" aria-selected={activeTab === 'call'} onClick={() => setActiveTab('call')}><CommandLineIcon className="size-4" /> JEV call</button></div>{documentError ? <div className="inline-error">{documentError}</div> : !details ? <div className="details-loading">Loading the saved passage…</div> : activeTab === 'passage' ? <div className="article-pane"><div className="pane-head"><strong>Supplied passage {docid}</strong><span>{details.text ? `${details.text.length.toLocaleString()} characters` : 'Text unavailable'}</span></div><p>{details.text || 'Passage text is not installed on this server.'}</p></div> : <CallPane details={details} task={task} query={payload.text} question={activeTask.question} stateField="candidate_passage" />}</div></motion.div>}</AnimatePresence></motion.li>
      })}</AnimatePresence></ol>}<div className="ranking-tail"><span>Only the monoBERT shortlist is reordered.</span><span>{afterShown ? `${payload.calls} recorded scores · subset time unmeasured` : 'Saved-score projection'}</span></div></section>

      <section className="evidence-section" aria-labelledby="passage-evidence-title">
        <div className="evidence-intro"><h2 id="passage-evidence-title">Across 43 queries</h2><p>Top-100 projection from saved scores. The original experiment scored all 41,042 supplied pairs.</p></div>
        <div className="evidence-facts">
          <div><span>nDCG@10</span><strong>{referenceMetrics.ndcg_cut_10.toFixed(4)} <ArrowRightIcon className="size-4" /> {activeTask.metrics.ndcg_cut_10.toFixed(4)}</strong><small>Graded relevance</small></div>
          <div><span>MAP@100</span><strong>{referenceMetrics.map.toFixed(4)} <ArrowRightIcon className="size-4" /> {activeTask.metrics.map.toFixed(4)}</strong><small>Grades 2–3 relevant</small></div>
          <div><span>Estimated subset API cost</span><strong>${activeTask.estimatedCostUsd.toFixed(3)}</strong><small>Recorded usage · historical price</small></div>
        </div>
        <div className="evidence-bottom"><span>{activeTask.calls.toLocaleString()} saved scores · subset wall time not measured</span><a href="https://github.com/carlaiau/jev-reranking/blob/main/reranking/results/msmarco-dl2019/results.md" target="_blank" rel="noreferrer">Full-candidate report <ArrowRightIcon className="size-4" /></a></div>
      </section>
    </div>
  </main>
}
