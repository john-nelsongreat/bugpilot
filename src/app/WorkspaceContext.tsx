import { useCallback, useRef, useState, type ReactNode } from 'react'
import type { ToastMessage } from '../components/Toast'
import { useBugWorkspace } from '../features/bugs/useBugWorkspace'
import { WorkspaceContext, type NotifyOptions } from './useWorkspace'

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const workspace = useBugWorkspace()
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const nextToastId = useRef(0)

  const notify = useCallback((message: string, options?: NotifyOptions) => {
    nextToastId.current += 1
    setToast({
      id: nextToastId.current,
      message,
      tone: options?.tone ?? 'info',
      ...(options?.link ? { link: options.link } : {}),
    })
  }, [])

  const dismissToast = useCallback(() => {
    setToast(null)
  }, [])

  return (
    <WorkspaceContext.Provider
      value={{ ...workspace, toast, notify, dismissToast }}
    >
      {children}
    </WorkspaceContext.Provider>
  )
}
