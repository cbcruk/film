import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 3000,
  },
  plugins: [tanstackStart(), viteReact()],
})
