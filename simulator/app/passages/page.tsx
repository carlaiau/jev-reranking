import { PassageSimulator } from './passage-simulator'
import { passageEvidence } from '@/lib/msmarco-evidence'
import { getMsmarcoOptions, getMsmarcoQueryPayload } from '@/lib/server-data'
import { selectDemoQueries } from '@/lib/demo-queries'

export const dynamic = 'force-dynamic'

export default function PassagesPage() {
  const initial = getMsmarcoQueryPayload(passageEvidence.source.defaultQuery, 'original')
  if (!initial) throw new Error('The fixed passage query is missing from the evidence.')
  const options = selectDemoQueries(getMsmarcoOptions(), passageEvidence.source.defaultQuery)
  return <PassageSimulator initial={initial} options={options} taskInfo={passageEvidence.tasks} referenceMetrics={passageEvidence.referenceMetrics} />
}
