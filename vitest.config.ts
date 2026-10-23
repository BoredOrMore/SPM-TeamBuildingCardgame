import { defineConfig } from 'vitest/config';

// Full-game tests play 3 rounds per game [P41], so they need more than the 5 s default.
export default defineConfig({ test: { testTimeout: 60_000 } });
