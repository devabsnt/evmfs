import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: [
      'viem',
      'wagmi',
      '@rainbow-me/rainbowkit',
      '@tanstack/react-query',
    ],
  },
})
