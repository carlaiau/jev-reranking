import evidenceFile from '../data/msmarco-evidence.json'
import type { ScoreRecord } from './evidence'

export type PassageTaskId = 'matched' | 'original'
export type PassageMetricKey = 'ndcg_cut_10' | 'map' | 'P_10' | 'Rprec' | 'bpref' | 'recip_rank'
export type PassageMetrics = Record<PassageMetricKey, number>
export type PassageEvidence = {
  source: { reference: string; matched: string; original: string; queries: number; defaultQuery: string; rerankDepth: number }
  referenceMetrics: PassageMetrics
  tasks: Record<PassageTaskId, {
    label: string
    description: string
    metrics: PassageMetrics
    calls: number
    rerankSeconds: number
    estimatedCostUsd: number
    queryP50Seconds: number
    model: string
    question: { type: string; instructions: string; criteria: { true: string; false: string } }
    contentPolicy: string
  }>
  queries: Record<string, {
    id: string
    before: string[]
    judgments: Record<string, number | null>
    tasks: Record<PassageTaskId, {
      after: string[]
      beforeMetrics: PassageMetrics
      afterMetrics: PassageMetrics
      seconds: number
      calls: number
      scores: Record<string, ScoreRecord[]>
    }>
  }>
}

export const passageEvidence = evidenceFile as PassageEvidence
export function isPassageTask(value: string | null): value is PassageTaskId {
  return value === 'matched' || value === 'original'
}
