import type { Metadata } from 'next'
import '@fontsource-variable/space-grotesk/wght.css'
import './globals.css'

export const metadata: Metadata = {
  title: 'JEV reranking',
  description: 'An interactive replay of measured JEV reranking on a fixed WSJ BM25 candidate set.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('rerank-theme');if(t==='dark'){document.documentElement.dataset.theme='dark';document.documentElement.classList.add('dark')}}catch(e){}" }} /></head><body>{children}</body></html>
}
