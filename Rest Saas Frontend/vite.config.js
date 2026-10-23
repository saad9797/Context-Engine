import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  if (command === 'build' && mode !== 'development') {
    const value = process.env.VITE_API_BASE_URL || env.VITE_API_BASE_URL;
    let origin;
    try { origin = new URL(value); } catch { /* validated below */ }
    if (!origin || origin.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') {
      throw new Error('Production builds require VITE_API_BASE_URL set to your public HTTPS API origin (no path, credentials or query).');
    }
  }
  return {
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.js'],
    globals: true,
    pool: 'forks',
    maxWorkers: 1,
    testTimeout: 15000,
  },
  };
});
