import { PassageSimulator } from './passage-simulator'
import { getMsmarcoCollection, getMsmarcoQueryPayload, getQueryOptions } from '@/lib/server-data'
import { selectDemoQueries } from '@/lib/demo-queries'

export const dynamic = 'force-dynamic'

export default async function PassagesPage() {
  const collection = await getMsmarcoCollection()
  const [initial, allOptions] = await Promise.all([
    getMsmarcoQueryPayload(collection.source.defaultQuery, 'original'),
    getQueryOptions('msmarco'),
  ])
  if (!initial) throw new Error('The fixed passage query is missing from the evidence.')
  const options = selectDemoQueries(allOptions, collection.source.defaultQuery)
  return <PassageSimulator initial={initial} options={options} taskInfo={collection.tasks} referenceMetrics={collection.referenceMetrics} />
}
