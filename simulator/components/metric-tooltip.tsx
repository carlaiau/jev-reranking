'use client'

import { useState } from 'react'
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
} from '@floating-ui/react'
import { InformationCircleIcon } from '@heroicons/react/20/solid'

export function MetricTooltip({ label, meaning, purpose }: { label: string; meaning: string; purpose: string }) {
  const [open, setOpen] = useState(false)
  const narrow = typeof window !== 'undefined' && window.innerWidth <= 760
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: narrow ? 'bottom' : 'right',
    middleware: [offset(8), flip(), shift({ padding: 10 })],
    whileElementsMounted: autoUpdate,
  })
  const hover = useHover(context, { move: false, mouseOnly: true, delay: { open: 100, close: 80 } })
  const focus = useFocus(context)
  const click = useClick(context, { ignoreMouse: true })
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'tooltip' })
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, click, dismiss, role])

  return <>
    <button type="button" className="metric-help-trigger" ref={refs.setReference} {...getReferenceProps({ 'aria-label': `About ${label}` })}>
      <span>{label}</span><InformationCircleIcon className="size-3.5" aria-hidden="true" />
    </button>
    {open && <FloatingPortal><div className="metric-tooltip" ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()}>
      <strong>{label}</strong><p>{meaning}</p><p>{purpose}</p>
    </div></FloatingPortal>}
  </>
}
