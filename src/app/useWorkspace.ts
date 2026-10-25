import { createContext, useContext } from 'react'
import type { ToastMessage, ToastTone } from '../components/Toast'
import { useBugWorkspace } from '../features/bugs/useBugWorkspace'

export type NotifyOptions = {
  tone?: ToastTone
  link?: { to: string; label: string }
}

export type WorkspaceValue = ReturnType<typeof useBugWorkspace> & {
  toast: ToastMessage | null
  notify: (message: string, options?: NotifyOptions) => void
  dismissToast: () => void
}

export const WorkspaceContext = createContext<WorkspaceValue | null>(null)

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext)
  if (!value) {
    throw new Error('useWorkspace must be used inside WorkspaceProvider')
  }
  return value
}
