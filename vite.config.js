import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    allowedHosts: 'all', // Esto quita el bloqueo que ves en el móvil
    host: true,
    port: 5173
  }
})
