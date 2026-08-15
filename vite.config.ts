import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The 1.3 MB question bank is imported statically, so it lands in its own chunk
// rather than bloating the entry bundle.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('src/data/questions.json')) return 'bank';
          if (id.includes('node_modules')) return 'vendor';
          return undefined;
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
