'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowPathIcon, ArrowRightIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, CommandLineIcon, DocumentTextIcon, InformationCircleIcon, PlayIcon } from '@heroicons/react/20/solid'
import { Button } from '@/components/catalyst/button'
import { Select } from '@/components/catalyst/select'
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
  if (grade === 3) return <span className="judgment judgment-relevant"><CheckIcon className="size-3.5" /> Grade 3 · exact answer</span>
  if (grade === 2) return <span className="judgment judgment-relevant"><CheckIcon className="size-3.5" /> Grade 2 · limited answer</span>
  if (grade === 1) return <span className="judgment judgment-partial">Grade 1 · related</span>
  return <span className="judgment judgment-irrelevant">Grade 0 · irrelevant</span>
}

export function PassageSimulator({ initial, options, taskInfo, referenceMetrics }: {
  initial: QueryPayload
  options: Option[]
  taskInfo: PassageEvidence['tasks']
  referenceMetrics: PassageMetrics
}) {
  const [qid, setQid] = useState(initial.id)
  const [task, setTask] = useState<PassageTaskId>(initial.task)
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
  const reduced = useReducedMotion()

  useEffect(() => {
    if (payload.id === qid && payload.task === task) return
    const controller = new AbortController()
    setIsLoading(true)
    setLoadError(null)
    fetch(`/api/msmarco/query?qid=${encodeURIComponent(qid)}&task=${task}`, { signal: controller.signal })
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Could not load the saved query.')
        setPayload(data as QueryPayload)
      })
      .catch(error => { if (error.name !== 'AbortError') setLoadError(error.message) })
      .finally(() => { if (!controller.signal.aborted) setIsLoading(false) })
    return () => controller.abort()
  }, [payload.id, payload.task, qid, task])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const current = payload.id === qid && payload.task === task
  const visible = phase === 'after' ? payload.after : payload.before
  const activeTask = taskInfo[task]
  const afterShown = phase === 'after'

  function changeTask(value: PassageTaskId) {
    if (timer.current) clearTimeout(timer.current)
    setTask(value)
    setPhase('before')
    setOpenId(null)
  }

  function changeQuery(value: string) {
    if (timer.current) clearTimeout(timer.current)
    setQid(value)
    setPhase('before')
    setOpenId(null)
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
    <div className="top-line" />
    <header className="site-header page-wrap"><div className="brand"><RouteMark className="brand-mark" /><span>Rerank<span className="brand-light"> Lab</span></span></div><nav className="dataset-nav" aria-label="Experiment dataset"><a href="/">WSJ / BM25</a><a href="/passages" aria-current="page">MS MARCO passages</a></nav><div className="header-right"><span className="live-dot" /> Saved experiment replay</div></header>
    <div className="page-wrap">
      <section className="hero passage-hero" aria-labelledby="passage-title"><div className="hero-copy"><h1 id="passage-title">One candidate set.<br /><em>Two ways to rank it.</em></h1><p>Watch JEV score the same supplied passages ranked by the local monoBERT reference. This task tests a passage reranker; the supplied file order is not a BM25 search ranking.</p><div className="hero-proof"><span className="proof-pulse" /> 43 judged queries <span className="hero-separator" /> 41,042 passage pairs <span className="hero-separator" /> NIST grades 0–3</div></div><div className="signal-diagram" aria-label="Supplied passage candidates, monoBERT reference ranking, JEV ranking"><div className="signal-diagram-head"><span>THE PASSAGE TASK</span><span>FIXED CANDIDATES</span></div><div className="signal-stage"><span className="stage-index">A</span><span><strong>Supplied candidates</strong><small>Up to 1,000 per query</small></span><span className="stage-count">1,000</span></div><div className="signal-rail"><span /></div><div className="signal-stage"><span className="stage-index">B</span><span><strong>monoBERT reference</strong><small>Ranked comparison view</small></span><span className="stage-count">RANKED</span></div><div className="signal-rail signal-rail-cross"><span /></div><div className="signal-stage signal-stage-active"><span className="stage-index">C</span><span><strong>JEV pointwise scores</strong><small>Same candidate pool</small></span><ArrowRightIcon className="size-4" /></div></div></section>

      <section className="control-room" aria-label="Choose a passage reranking task and query"><div className="control-top"><h2>Set the passage experiment</h2><span>MS MARCO v1 / TREC DL 2019</span></div><div className="controls-grid"><div className="control-group"><label className="control-label">JEV input representation</label><div className="task-switch" role="group" aria-label="JEV passage input representation">{(['original', 'matched'] as PassageTaskId[]).map(id => <button key={id} type="button" className={task === id ? 'task-option active' : 'task-option'} onClick={() => changeTask(id)} aria-pressed={task === id}><span>{taskInfo[id].label}</span><small>{id === 'original' ? 'source casing + spacing' : 'decoded BERT text'}</small></button>)}</div></div><div className="control-group query-control"><label className="control-label" htmlFor="passage-query">Search query</label><Select id="passage-query" value={qid} onChange={event => changeQuery(event.target.value)}>{options.map(option => <option key={option.id} value={option.id}>{option.id} · {option.text}</option>)}</Select></div></div><div className="query-note"><InformationCircleIcon className="size-4" /> Both JEV conditions cover each supplied passage in full. They differ in text representation, not context length.</div></section>

      <section className="metrics-section" aria-labelledby="passage-metric-title"><div className="section-heading"><div><h2 id="passage-metric-title">Judged ranking quality</h2><p>Query {qid}: <strong>{current ? payload.text : 'Loading…'}</strong> · evaluated over the complete candidate list.</p></div><span className="section-tag">NDCG@10 IS PRIMARY</span></div><div className="metric-board"><div className="metric-header"><span>MEASURE</span><span>BEFORE · MONOBERT</span><span>AFTER · JEV</span></div>{metricLabels.map(({ key, label, help }) => {
        const before = current ? payload.beforeMetrics[key] : 0
        const after = current ? payload.afterMetrics[key] : 0
        const delta = after - before
        return <div className={`metric-row ${key === 'ndcg_cut_10' ? 'metric-primary' : ''}`} key={key}><div className="metric-name"><span>{label}</span><span className="metric-help" title={help} aria-label={help}><InformationCircleIcon className="size-3.5" /></span></div><div className="metric-before">{current ? <AnimatedNumber value={before} /> : '—'}</div><div className={`metric-after ${afterShown && delta >= 0 ? 'improved' : ''} ${afterShown && delta < 0 ? 'declined' : ''}`}>{current ? <AnimatedNumber value={after} active={afterShown} /> : '—'}{afterShown && <span className="metric-delta">{delta >= 0 ? '+' : ''}{delta.toFixed(4)}</span>}</div></div>
      })}</div><p className="metric-footnote">nDCG@10 uses grades 0–3. Binary metrics count grades 2–3 as relevant. Each query can move differently from the 43-query average.</p></section>

      <section className="ranking-section" aria-labelledby="passage-rank-title"><div className="section-heading ranking-heading"><div><h2 id="passage-rank-title">Follow the passages</h2><p>Ten visible results from the same supplied candidate pool.</p></div><label className="judgment-toggle"><input type="checkbox" checked={showGrades} onChange={event => setShowGrades(event.target.checked)} /><span className="toggle-track"><span /></span> Show NIST grades</label></div><div className="ranking-toolbar"><div className="ranking-status"><span className={`status-lamp ${phase}`} /><strong>{phase === 'after' ? 'JEV order' : phase === 'scoring' ? 'Scoring passages' : 'monoBERT order'}</strong><span className="status-note">{phase === 'after' ? 'same candidates reranked' : phase === 'scoring' ? 'recorded calls playing back' : 'local reference ranking'}</span></div><div className="toolbar-actions">{afterShown && <button type="button" className="quiet-action" onClick={reset}><ArrowPathIcon className="size-4" /> Reset</button>}<Button type="button" color="amber" onClick={replay} disabled={!current || isLoading || phase === 'scoring'}><PlayIcon data-slot="icon" />{afterShown ? 'Replay movement' : phase === 'scoring' ? 'Scoring…' : 'Run JEV replay'}</Button></div></div>{phase === 'scoring' && <div className="replay-progress" role="status"><span className="replay-progress-fill" /><span className="sr-only">Playing back recorded passage scores before reordering.</span></div>}{loadError && <div className="inline-error">{loadError}</div>}{!payload.contentAvailable && <div className="content-alert"><DocumentTextIcon className="size-5" /><span>Passage text is not installed on this server. Rankings still replay; prepare the local licensed TREC DL 2019 source files to inspect passages and exact calls.</span></div>}{(!current || isLoading) ? <div className="ranking-loading">Loading saved passage evidence…</div> : <ol className="result-list"><AnimatePresence initial={false} mode="popLayout">{visible.map((docid, index) => {
        const doc = payload.documents[docid]
        if (!doc) return null
        const isOpen = openId === docid
        const details = documentData[`${qid}:${task}:${docid}`]
        const movement = doc.originalRank - doc.finalRank
        return <motion.li key={docid} layout="position" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -14 }} transition={{ layout: { type: 'spring', stiffness: 340, damping: 34 }, opacity: { duration: .2 } }} className={`result-row ${isOpen ? 'result-open' : ''}`}><div className="result-main"><div className="rank-cell"><span className="rank-number">{String(index + 1).padStart(2, '0')}</span><span className="rank-rail" /></div><div className="result-copy"><div className="result-eyeline"><span className="doc-id">PASSAGE {docid}</span>{showGrades && <Grade grade={doc.judgment} />}</div><button type="button" className="result-title" aria-expanded={isOpen} onClick={() => toggleResult(docid)}>{doc.title}<span className="result-open-icon">{isOpen ? <ChevronUpIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}</span></button><div className="result-subline">{afterShown ? <span className={movement > 0 ? 'moved-up' : movement < 0 ? 'moved-down' : ''}>{movement > 0 ? `↑ ${movement} places from monoBERT` : movement < 0 ? `↓ ${Math.abs(movement)} places from monoBERT` : 'Same position'}</span> : <span>monoBERT rank #{doc.originalRank}</span>}<span className="subline-dot" /><span>Open passage and call</span></div></div><div className="result-score">{phase !== 'before' && doc.score !== null ? <motion.div initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: phase === 'scoring' && !reduced ? Math.min(index * .13, 1.2) : 0 }}><small>JEV SCORE</small><strong><AnimatedNumber value={doc.score} places={2} animateIn /></strong></motion.div> : <span className="score-pending">JEV<br />pending</span>}</div></div><AnimatePresence initial={false}>{isOpen && <motion.div className="result-details" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: reduced ? 0 : .28, ease: [0.16, 1, 0.3, 1] }}><div className="details-inner"><div className="details-tabs" role="tablist" aria-label={`Inspect passage ${docid}`}><button type="button" role="tab" aria-selected={activeTab === 'passage'} onClick={() => setActiveTab('passage')}><DocumentTextIcon className="size-4" /> Passage</button><button type="button" role="tab" aria-selected={activeTab === 'call'} onClick={() => setActiveTab('call')}><CommandLineIcon className="size-4" /> JEV call + result</button></div>{documentError ? <div className="inline-error">{documentError}</div> : !details ? <div className="details-loading">Loading the saved passage…</div> : activeTab === 'passage' ? <div className="article-pane"><div className="pane-head"><strong>Supplied passage {docid}</strong><span>{details.text ? `${details.text.length.toLocaleString()} characters` : 'Text unavailable'}</span></div><p>{details.text || 'Passage text is not installed on this server.'}</p></div> : <CallPane details={details} task={task} query={payload.text} question={activeTask.question} stateField="candidate_passage" />}</div></motion.div>}</AnimatePresence></motion.li>
      })}</AnimatePresence></ol>}<div className="ranking-tail"><span>All supplied candidates were scored in this experiment; ten are visible here.</span><span>{afterShown ? `Recorded query time ${payload.seconds.toFixed(2)} s · ${payload.calls} calls` : 'Press replay to see the measured change.'}</span></div></section>

      <section className="evidence-section" aria-labelledby="passage-evidence-title"><div className="evidence-intro"><h2 id="passage-evidence-title">The aggregate tradeoff</h2><p>Across 43 queries, JEV improved binary MAP against local monoBERT, while its graded nDCG@10 was lower. The paired headline difference was not significant after Holm correction. This replay is evidence of a measured option, not a universal win.</p></div><div className="evidence-facts"><div><span>43-query nDCG@10</span><strong>{referenceMetrics.ndcg_cut_10.toFixed(4)} <ArrowRightIcon className="size-4" /> {activeTask.metrics.ndcg_cut_10.toFixed(4)}</strong><small>Primary graded metric</small></div><div><span>43-query MAP</span><strong>{referenceMetrics.map.toFixed(4)} <ArrowRightIcon className="size-4" /> {activeTask.metrics.map.toFixed(4)}</strong><small>Grades 2–3 relevant</small></div><div><span>Estimated JEV API spend</span><strong>${activeTask.estimatedCostUsd.toFixed(3)}</strong><small>Successful responses only</small></div></div><div className="evidence-bottom"><span>{activeTask.calls.toLocaleString()} uncached JEV calls · {activeTask.rerankSeconds.toFixed(1)} s total reranking · supplied-candidate retrieval time unknown</span><a href="https://github.com/carlaiau/jev-reranking/blob/main/reranking/results/msmarco-dl2019/results.md" target="_blank" rel="noreferrer">Read the passage report <ArrowRightIcon className="size-4" /></a></div></section>
    </div><footer className="site-footer page-wrap"><span><RouteMark className="footer-mark" /> Rerank Lab</span><span>Measured MS MARCO / TREC DL 2019 evidence · local replay</span></footer>
  </main>
}
