const QUERY_COUNT = 20
const queryCollator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

export function selectDemoQueries<T extends { id: string; text: string }>(options: T[], defaultId: string): T[] {
  const ordered = [...options].sort((a, b) => Number(a.id) - Number(b.id))
  const defaultIndex = ordered.findIndex(option => option.id === defaultId)
  if (defaultIndex < 0) throw new Error(`Default query ${defaultId} is missing`)
  const alphabetize = (sample: T[]) => sample.sort((a, b) =>
    queryCollator.compare(a.text, b.text) || Number(a.id) - Number(b.id),
  )
  if (ordered.length <= QUERY_COUNT) return alphabetize(ordered)

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
  return alphabetize(indices.map(index => ordered[index]))
}
