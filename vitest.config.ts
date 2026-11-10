import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/sim', 'apps/server', 'apps/web'],
  },
});
