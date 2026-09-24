import metricsFile from '../data/wsj-top100-metrics.json'

export type WsjMetricKey = 'ndcg_cut_10' | 'map' | 'P_10' | 'bpref' | 'recall_100' | 'judged_10'
export type WsjMetrics = Record<WsjMetricKey, number>

type MetricSet = { all: WsjMetrics; queries: Record<string, WsjMetrics> }

export const wsjTop100 = metricsFile as {
  cutoff: number
  before: MetricSet
  after: MetricSet
}
