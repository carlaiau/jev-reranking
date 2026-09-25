export type WsjMetricKey = 'ndcg_cut_10' | 'map' | 'P_10' | 'bpref' | 'recall_100' | 'judged_10'
export type WsjMetrics = Record<WsjMetricKey, number>
