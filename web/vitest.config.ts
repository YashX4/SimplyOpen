import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    // Every test builds its own database in memory, which is slow when all files run at once.
    hookTimeout: 120_000,
    // Real password hashing is slow on purpose; tests use the cheapest setting.
    env: { PASSWORD_HASH_COST: '1024' },
    pool: 'forks',
  },
})
