import { startDiffWorker } from './diffWorker'

startDiffWorker(self as unknown as Parameters<typeof startDiffWorker>[0])
