import { startTsWorker } from './tsWorker'
import type { WorkerScope } from './tsProtocol'

// Vite builds this entry as a classic same-origin worker; the TypeScript compiler stays
// inside it and never enters the page bundle.
startTsWorker(self as unknown as WorkerScope)
