import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://makostar.github.io',
  base: '/ss-status',
  output: 'static',
  build: { format: 'directory' },
})
