import { config } from 'dotenv'
import { defineConfig } from 'vitest/config'

config({ path: '../../.env', quiet: true })

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,
  },
})
