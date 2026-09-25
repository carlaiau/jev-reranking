import { isTaskId } from '@/lib/evidence'
import { getDocumentPayload } from '@/lib/server-data'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const qid = url.searchParams.get('qid') || ''
  const docid = url.searchParams.get('docid') || ''
  const task = url.searchParams.get('task')
  if (!isTaskId(task)) return Response.json({ error: 'Choose a valid reranking task.' }, { status: 400 })
  const payload = await getDocumentPayload(qid, task, docid)
  if (!payload) return Response.json({ error: 'That result is not in this scored candidate set.' }, { status: 404 })
  return Response.json(payload, { headers: { 'Cache-Control': 'no-store' } })
}
