import { isPassageTask } from '@/lib/msmarco-evidence'
import { getMsmarcoQueryPayload } from '@/lib/server-data'

export const runtime = 'nodejs'

export function GET(request: Request) {
  const url = new URL(request.url)
  const qid = url.searchParams.get('qid') || ''
  const task = url.searchParams.get('task')
  if (!isPassageTask(task)) return Response.json({ error: 'Choose a valid passage reranking task.' }, { status: 400 })
  const payload = getMsmarcoQueryPayload(qid, task)
  if (!payload) return Response.json({ error: 'That query is not in the saved passage run.' }, { status: 404 })
  return Response.json(payload, { headers: { 'Cache-Control': 'no-store' } })
}
