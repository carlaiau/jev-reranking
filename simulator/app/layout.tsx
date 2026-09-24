import type { Metadata } from 'next'
import '@fontsource-variable/space-grotesk/wght.css'
import './globals.css'

export const metadata: Metadata = {
  title: 'Rerank Lab — BM25 to JEV',
  description: 'An interactive replay of measured JEV reranking on a fixed WSJ BM25 candidate set.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>
}
