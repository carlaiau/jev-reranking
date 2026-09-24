import { Simulator } from './simulator'
import { evidence } from '@/lib/evidence'
import { getQueryPayload } from '@/lib/server-data'

export const dynamic = 'force-dynamic'

export default function Home() {
  const initial = getQueryPayload(evidence.source.defaultQuery, 'documents')
  if (!initial) throw new Error('The fixed default query is missing from the evidence.')
  const options = Object.values(evidence.queries)
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map(query => ({ id: query.id, text: query.text }))
  return <Simulator initial={initial} options={options} taskInfo={evidence.tasks} source={evidence.source} />
}
