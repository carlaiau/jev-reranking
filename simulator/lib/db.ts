import 'server-only'

import { neon } from '@neondatabase/serverless'

const connection = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL
if (!connection) throw new Error('Set DATABASE_URL_POOLED or DATABASE_URL for the simulator server.')

const sql = neon(connection)

export async function dbRows<T>(statement: string, values: unknown[] = []): Promise<T[]> {
  return await sql.query(statement, values) as T[]
}
