import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { ToastMessage, ToastTone } from '../components/Toast'
import { useBugWorkspace } from '../features/bugs/useBugWorkspace'

type NotifyOptions = {
  tone?: ToastTone
}

type WorkspaceValue = ReturnType<typeof useBugWorkspace> & {
  toast: ToastMessage | null
  notify: (message: string, options?: NotifyOptions) => void
  dismissToast: () => void
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null)

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

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext)
  if (!value) {
    throw new Error('useWorkspace must be used inside WorkspaceProvider')
  }
  return value
}
