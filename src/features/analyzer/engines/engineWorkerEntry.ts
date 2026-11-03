import { startEngineWorker } from './engineWorker'
import type { WorkerScope } from '../analysis/analyzerProtocol'

startEngineWorker(self as unknown as WorkerScope)
