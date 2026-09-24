import metricsFile from '../data/wsj-top100-metrics.json'
import type { Metrics } from './evidence'

type MetricSet = { all: Metrics; queries: Record<string, Metrics> }

export const wsjTop100 = metricsFile as {
  cutoff: number
  before: MetricSet
  after: MetricSet
}
