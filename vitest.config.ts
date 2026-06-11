import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  oxc: {
    jsx: {
      runtime: 'automatic',
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,ts,tsx}'],
    exclude: ['node_modules', '.next', 'dist'],
    // Performance assertions (ms thresholds) are sensitive to cross-file contention.
    // Running files sequentially keeps these tests stable across environments.
    fileParallelism: false,
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', '.next/', 'src/**/*.d.ts', 'src/**/__tests__/test-utils.ts'],
    },
    testTimeout: 30000,
    hookTimeout: 10000,
    setupFiles: ['./src/test-utils/vitest-auth-setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
