'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowPathIcon, ArrowRightIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, CommandLineIcon, DocumentTextIcon, InformationCircleIcon, PlayIcon } from '@heroicons/react/20/solid'
import { Button } from '@/components/catalyst/button'
import { Select } from '@/components/catalyst/select'
import { ThemeToggle } from '@/components/theme-toggle'
import { AnimatedNumber, CallPane, RouteMark, type DocumentPayload } from '../simulator'
import type { PassageEvidence, PassageMetricKey, PassageMetrics, PassageTaskId } from '@/lib/msmarco-evidence'
import type { getMsmarcoQueryPayload } from '@/lib/server-data'

type QueryPayload = NonNullable<ReturnType<typeof getMsmarcoQueryPayload>>
type Phase = 'before' | 'scoring' | 'after'
type Option = { id: string; text: string }

const metricLabels: { key: PassageMetricKey; label: string; help: string }[] = [
  { key: 'ndcg_cut_10', label: 'nDCG@10', help: 'Headline metric. Rewards highly relevant graded passages near the top ten.' },
  { key: 'map', label: 'AP', help: 'Average precision for this query; grades 2 and 3 count as relevant.' },
  { key: 'P_10', label: 'P@10', help: 'Fraction of the first ten passages graded 2 or 3.' },
  { key: 'Rprec', label: 'R-prec', help: 'Precision at rank R, where R is the count of relevant judged passages.' },
  { key: 'bpref', label: 'bpref', help: 'Preference metric accounting for incomplete judgments.' },
  { key: 'recip_rank', label: 'RR', help: 'Reciprocal rank of the first passage graded 2 or 3.' },
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
  const [showGrades, setShowGrades] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'passage' | 'call'>('passage')
  const [documentData, setDocumentData] = useState<Record<string, DocumentPayload>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [documentError, setDocumentError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchController = useRef<AbortController | null>(null)
  const reduced = useReducedMotion()

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    searchController.current?.abort()
  }, [])

  const current = !isLoading && payload.id === qid && payload.task === task
  const visible = phase === 'after' ? payload.after : payload.before
  const activeTask = taskInfo[task]
  const afterShown = phase === 'after'

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
    const search = fetch(`/api/msmarco/query?qid=${encodeURIComponent(value)}&task=${task}`, { signal: controller.signal })
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
      <section className="hero passage-hero" aria-labelledby="passage-title"><div className="hero-copy"><h1 id="passage-title">Passages, reranked.</h1><p>Compare JEV on the original supplied passages with a monoBERT reference ranking. The candidate set stays fixed.</p></div></section>

      <section className="control-room" aria-label="Choose an MS MARCO query"><div className="control-group query-control"><label className="control-label" htmlFor="passage-query">Search query</label><Select id="passage-query" value={qid} onChange={event => changeQuery(event.target.value)}>{options.map(option => <option key={option.id} value={option.id}>{option.id} · {option.text}</option>)}</Select></div><p className="control-context">MS MARCO v1 / TREC DL 2019 · Original passage text</p></section>

      <section className="metrics-section" aria-labelledby="passage-metric-title"><div className="section-heading"><div><h2 id="passage-metric-title">Ranking quality</h2><p>Query {qid}: <strong>{current ? payload.text : 'Loading…'}</strong> · full candidate list</p></div></div><div className="metric-board"><div className="metric-header"><span>Metric</span><span>monoBERT</span><span>JEV</span></div>{metricLabels.map(({ key, label, help }) => {
        const before = current ? payload.beforeMetrics[key] : 0
        const after = current ? payload.afterMetrics[key] : 0
        const delta = after - before
        return <div className={`metric-row ${key === 'ndcg_cut_10' ? 'metric-primary' : ''}`} key={key}><div className="metric-name"><span>{label}</span><span className="metric-help" title={help} aria-label={help}><InformationCircleIcon className="size-3.5" /></span></div><div className="metric-before">{current ? <AnimatedNumber value={before} animateIn /> : '—'}</div><div className={`metric-after ${afterShown && delta >= 0 ? 'improved' : ''} ${afterShown && delta < 0 ? 'declined' : ''}`}>{current ? <AnimatedNumber value={after} active={afterShown} /> : '—'}{afterShown && <span className="metric-delta">{delta >= 0 ? '+' : ''}{delta.toFixed(4)}</span>}</div></div>
      })}</div><p className="metric-footnote">nDCG@10 uses grades 0–3; other metrics count grades 2–3 as relevant.</p></section>

      <section className="ranking-section" aria-labelledby="passage-rank-title"><div className="section-heading ranking-heading"><div><h2 id="passage-rank-title">Results</h2><p>Top 10 shown · same candidates</p></div><label className="judgment-toggle"><input type="checkbox" checked={showGrades} onChange={event => setShowGrades(event.target.checked)} /><span className="toggle-track"><span /></span> NIST grades</label></div><div className="ranking-toolbar"><div className="ranking-status"><span className={`status-lamp ${isLoading ? 'searching' : phase}`} /><strong>{isLoading ? 'Loading monoBERT results…' : loadError ? 'Results unavailable' : phase === 'after' ? 'JEV order' : phase === 'scoring' ? 'Scoring' : 'monoBERT order'}</strong></div><div className="toolbar-actions">{afterShown && <button type="button" className="quiet-action" onClick={reset}><ArrowPathIcon className="size-4" /> Reset</button>}<Button type="button" color="emerald" onClick={replay} disabled={!current || phase === 'scoring'}><PlayIcon data-slot="icon" />Replay JEV</Button></div></div>{isLoading && <div className="replay-progress" role="status" aria-label="Loading the saved monoBERT reference ranking"><span className="search-progress-fill" /></div>}{phase === 'scoring' && <div className="replay-progress" role="status"><span className="replay-progress-fill" /><span className="sr-only">Playing back recorded passage scores before reordering.</span></div>}{loadError && <div className="inline-error">{loadError}</div>}{!payload.contentAvailable && <div className="content-alert"><DocumentTextIcon className="size-5" /><span>Passage text is not installed on this server. Rankings still replay; prepare the local licensed TREC DL 2019 source files to inspect passages and exact calls.</span></div>}{!current ? <div className="ranking-loading">{loadError ? 'Results unavailable.' : 'Loading saved monoBERT results…'}</div> : <ol className="result-list"><AnimatePresence initial={false} mode="popLayout">{visible.map((docid, index) => {
        const doc = payload.documents[docid]
        if (!doc) return null
        const isOpen = openId === docid
        const details = documentData[`${qid}:${task}:${docid}`]
        const movement = doc.originalRank - doc.finalRank
        return <motion.li key={docid} layout="position" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} transition={{ layout: { type: 'spring', stiffness: 340, damping: 34 }, opacity: { duration: .2 } }} className={`result-row ${isOpen ? 'result-open' : ''}`}><div className="result-main"><div className="rank-cell"><span className="rank-number">{String(index + 1).padStart(2, '0')}</span></div><div className="result-copy"><div className="result-eyeline"><span className="doc-id">PASSAGE {docid}</span>{showGrades && <Grade grade={doc.judgment} />}</div><button type="button" className="result-title" aria-expanded={isOpen} onClick={() => toggleResult(docid)}>{doc.title}<span className="result-open-icon">{isOpen ? <ChevronUpIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}</span></button>{afterShown && <div className="result-subline"><span className={movement > 0 ? 'moved-up' : movement < 0 ? 'moved-down' : ''}>{movement > 0 ? `↑ ${movement} from monoBERT` : movement < 0 ? `↓ ${Math.abs(movement)} from monoBERT` : 'Same rank'}</span></div>}</div><div className="result-score">{phase !== 'before' && doc.score !== null ? <motion.div initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: phase === 'scoring' && !reduced ? Math.min(index * .13, 1.2) : 0 }}><small>JEV</small><strong><AnimatedNumber value={doc.score} places={2} animateIn /></strong></motion.div> : <span className="score-pending">—</span>}</div></div><AnimatePresence initial={false}>{isOpen && <motion.div className="result-details" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: reduced ? 0 : .28, ease: [0.16, 1, 0.3, 1] }}><div className="details-inner"><div className="details-tabs" role="tablist" aria-label={`Inspect passage ${docid}`}><button type="button" role="tab" aria-selected={activeTab === 'passage'} onClick={() => setActiveTab('passage')}><DocumentTextIcon className="size-4" /> Passage</button><button type="button" role="tab" aria-selected={activeTab === 'call'} onClick={() => setActiveTab('call')}><CommandLineIcon className="size-4" /> JEV call</button></div>{documentError ? <div className="inline-error">{documentError}</div> : !details ? <div className="details-loading">Loading the saved passage…</div> : activeTab === 'passage' ? <div className="article-pane"><div className="pane-head"><strong>Supplied passage {docid}</strong><span>{details.text ? `${details.text.length.toLocaleString()} characters` : 'Text unavailable'}</span></div><p>{details.text || 'Passage text is not installed on this server.'}</p></div> : <CallPane details={details} task={task} query={payload.text} question={activeTask.question} stateField="candidate_passage" />}</div></motion.div>}</AnimatePresence></motion.li>
      })}</AnimatePresence></ol>}<div className="ranking-tail"><span>All supplied candidates were rescored.</span><span>{afterShown ? `${payload.seconds.toFixed(2)} s · ${payload.calls} recorded calls` : 'Saved experiment replay'}</span></div></section>

      <section className="evidence-section" aria-labelledby="passage-evidence-title"><div className="evidence-intro"><h2 id="passage-evidence-title">Across 43 queries</h2><p>JEV raised binary MAP; graded nDCG@10 was lower. The primary-metric difference was not significant after Holm correction.</p></div><div className="evidence-facts"><div><span>nDCG@10</span><strong>{referenceMetrics.ndcg_cut_10.toFixed(4)} <ArrowRightIcon className="size-4" /> {activeTask.metrics.ndcg_cut_10.toFixed(4)}</strong><small>Primary graded metric</small></div><div><span>MAP</span><strong>{referenceMetrics.map.toFixed(4)} <ArrowRightIcon className="size-4" /> {activeTask.metrics.map.toFixed(4)}</strong><small>Grades 2–3 relevant</small></div><div><span>Estimated API cost</span><strong>${activeTask.estimatedCostUsd.toFixed(3)}</strong><small>Successful responses</small></div></div><div className="evidence-bottom"><span>{activeTask.calls.toLocaleString()} uncached calls · {activeTask.rerankSeconds.toFixed(1)} s reranking · retrieval time unknown</span><a href="https://github.com/carlaiau/jev-reranking/blob/main/reranking/results/msmarco-dl2019/results.md" target="_blank" rel="noreferrer">Experiment report <ArrowRightIcon className="size-4" /></a></div></section>
    </div>
  </main>
}
