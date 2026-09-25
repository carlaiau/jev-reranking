import { Simulator } from './simulator'
import { getQueryOptions, getQueryPayload, getWsjCollection } from '@/lib/server-data'
import { selectDemoQueries } from '@/lib/demo-queries'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const collection = await getWsjCollection()
  const [initial, allOptions] = await Promise.all([
    getQueryPayload(collection.source.defaultQuery, 'documents'),
    getQueryOptions('wsj'),
  ])
  if (!initial) throw new Error('The fixed default query is missing from the evidence.')
  const options = selectDemoQueries(allOptions, collection.source.defaultQuery)
  return <Simulator initial={initial} options={options} taskInfo={collection.tasks} source={collection.source} aggregate={collection.aggregate} />
}
