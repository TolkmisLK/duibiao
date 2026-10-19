import { defineConfig } from 'vitest/config';
export default defineConfig({
  base: '/duibiao/',
  build: { target: 'es2022' },
  test: { include: ['tests/core/**/*.test.ts'] },
  plugins: [{
    name: 'local-only-production-policy',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-src 'none'">`);
    },
  }],
});
