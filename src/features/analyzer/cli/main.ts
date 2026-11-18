import { analyzeMain } from './analyzeCli'

process.exitCode = await analyzeMain(process.argv.slice(2))
