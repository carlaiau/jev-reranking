const QUERY_COUNT = 20

export function selectDemoQueries<T extends { id: string }>(options: T[], defaultId: string): T[] {
  const ordered = [...options].sort((a, b) => Number(a.id) - Number(b.id))
  const defaultIndex = ordered.findIndex(option => option.id === defaultId)
  if (defaultIndex < 0) throw new Error(`Default query ${defaultId} is missing`)
  if (ordered.length <= QUERY_COUNT) return ordered

  // Spread examples across query IDs without selecting on reranking outcomes.
  const indices = Array.from({ length: QUERY_COUNT }, (_, index) =>
    Math.round(index * (ordered.length - 1) / (QUERY_COUNT - 1)),
  )
  if (!indices.includes(defaultIndex)) {
    const nearest = indices.slice(1, -1).reduce((best, index) =>
      Math.abs(index - defaultIndex) < Math.abs(best - defaultIndex) ? index : best,
    )
    indices[indices.indexOf(nearest)] = defaultIndex
  }
  return indices.sort((a, b) => a - b).map(index => ordered[index])
}
