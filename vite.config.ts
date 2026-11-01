import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Package ID used to namespace saved-session storage keys. Defaults to the
// repository app.json (production identity); test builds set NOOR_APP_ID to
// the test package ID (e.g. com.noor.quran.fullscreen.test) so test and
// production apps never share saved sessions.
const appJson = JSON.parse(readFileSync(resolve(process.cwd(), 'app.json'), 'utf8'))
const appId = process.env.NOOR_APP_ID || appJson.package_id

export default defineConfig({
  define: {
    __NOOR_APP_ID__: JSON.stringify(appId),
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
  server: {
    port: 5173,
    // Allow cross-origin requests from the Even Hub simulator
    cors: true,
  },
})
