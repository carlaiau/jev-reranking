import { Simulator } from './simulator'
import { evidence } from '@/lib/evidence'
import { getQueryPayload } from '@/lib/server-data'
import { selectDemoQueries } from '@/lib/demo-queries'
import { wsjTop100 } from '@/lib/wsj-top100'

export const dynamic = 'force-dynamic'

export default function Home() {
  const initial = getQueryPayload(evidence.source.defaultQuery, 'documents')
  if (!initial) throw new Error('The fixed default query is missing from the evidence.')
  const options = selectDemoQueries(
    Object.values(evidence.queries).map(query => ({ id: query.id, text: query.text })),
    evidence.source.defaultQuery,
  )
  return <Simulator initial={initial} options={options} taskInfo={evidence.tasks} source={evidence.source} aggregate={{ before: wsjTop100.before.all, after: wsjTop100.after.all }} />
}
