import { isPassageTask } from '@/lib/msmarco-evidence'
import { getMsmarcoDocumentPayload } from '@/lib/server-data'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const qid = url.searchParams.get('qid') || ''
  const docid = url.searchParams.get('docid') || ''
  const task = url.searchParams.get('task')
  if (!isPassageTask(task)) return Response.json({ error: 'Choose a valid passage reranking task.' }, { status: 400 })
  const payload = await getMsmarcoDocumentPayload(qid, task, docid)
  if (!payload) return Response.json({ error: 'That result is not in this scored candidate set.' }, { status: 404 })
  return Response.json(payload, { headers: { 'Cache-Control': 'no-store' } })
}
