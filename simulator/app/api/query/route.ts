import { isTaskId } from '@/lib/evidence'
import { getQueryPayload } from '@/lib/server-data'

export const runtime = 'nodejs'

export function GET(request: Request) {
  const url = new URL(request.url)
  const qid = url.searchParams.get('qid') || ''
  const task = url.searchParams.get('task')
  if (!isTaskId(task)) return Response.json({ error: 'Choose a valid reranking task.' }, { status: 400 })
  const payload = getQueryPayload(qid, task)
  if (!payload) return Response.json({ error: 'That query is not in the saved run.' }, { status: 404 })
  return Response.json(payload, { headers: { 'Cache-Control': 'no-store' } })
}
