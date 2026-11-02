import { startArchiveWorker, type WorkerScope } from './workerProtocol'

startArchiveWorker(self as unknown as WorkerScope)
