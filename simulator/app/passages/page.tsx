import { PassageSimulator } from './passage-simulator'
import { passageEvidence } from '@/lib/msmarco-evidence'
import { getMsmarcoOptions, getMsmarcoQueryPayload } from '@/lib/server-data'

export const dynamic = 'force-dynamic'

export default function PassagesPage() {
  const initial = getMsmarcoQueryPayload(passageEvidence.source.defaultQuery, 'original')
  if (!initial) throw new Error('The fixed passage query is missing from the evidence.')
  return <PassageSimulator initial={initial} options={getMsmarcoOptions()} taskInfo={passageEvidence.tasks} referenceMetrics={passageEvidence.referenceMetrics} />
}
