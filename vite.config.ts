import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    restoreMocks: true,
    testTimeout: 60000,
    fileParallelism: false,
    // Forked workers intermittently miss the startup timeout on this Windows
    // machine; threads keep the same per-file isolation without process spawn.
    pool: 'threads',
  },
})
