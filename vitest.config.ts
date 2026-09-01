import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts'],
    // The suite must never reach the network: the OpenAI compiler is exercised
    // through an injected transport, never through a live request.
    testTimeout: 15_000,
  },
});
