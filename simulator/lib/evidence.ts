export type TaskId = 'documents' | 'passages'
export type MetricKey = 'map' | 'P_10' | 'Rprec' | 'bpref' | 'recip_rank'
export type Metrics = Record<MetricKey, number>

export type ScoreRecord = {
  score: number
  inputTokens: number
  outputTokens: number
  model: string
  seconds: number
  payloadCharacters: number
  payloadHash: string
  cacheHit: boolean
  passage_index?: number
  token_start?: number
  token_end?: number
  document_tokens?: number
}

export type QueryTask = {
  after: string[]
  beforeMetrics: Metrics
  afterMetrics: Metrics
  seconds: number
  calls: number
  scores: Record<string, ScoreRecord[]>
}

export type QueryEvidence = {
  id: string
  text: string
  before: string[]
  judgments: Record<string, number | null>
  tasks: Record<TaskId, QueryTask>
}

export type Evidence = {
  source: {
    baseline: string
    documents: string
    passages: string
    candidateCount: number
    rerankDepth: number
    queries: number
    defaultQuery: string
  }
  tasks: Record<TaskId, {
    label: string
    description: string
    metrics: Metrics
    calls: number
    rerankSeconds: number
    estimatedCostUsd: number
    queryP50Seconds: number
    model: string
    question: {
      type: string
      instructions: string
      criteria: { true: string; false: string }
    }
    contentPolicy: string
  }>
  queries: Record<string, QueryEvidence>
}

export const taskIds: TaskId[] = ['documents', 'passages']
export const metricKeys: MetricKey[] = ['map', 'P_10', 'Rprec', 'bpref', 'recip_rank']

export function isTaskId(value: string | null): value is TaskId {
  return value === 'documents' || value === 'passages'
}
