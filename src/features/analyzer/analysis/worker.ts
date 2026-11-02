import { startAnalyzerWorker } from './analyzerWorker'
import type { WorkerScope } from './analyzerProtocol'

startAnalyzerWorker(self as unknown as WorkerScope)
