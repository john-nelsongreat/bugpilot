import { checkTypeScriptFile } from './tsSyntaxCore'
import type { TsCheckRequest, WorkerScope } from './tsProtocol'

export function startTsWorker(scope: WorkerScope): void {
  scope.onmessage = (event) => {
    const message = event.data as TsCheckRequest | null
    if (!message || message.type !== 'check') return
    try {
      const findings = checkTypeScriptFile(message.name, message.text)
      scope.postMessage({ type: 'result', id: message.id, findings })
    } catch (error) {
      scope.postMessage({
        type: 'error',
        id: message.id,
        message: error instanceof Error ? error.message : 'The syntax checker stopped unexpectedly.',
      })
    }
  }
}
