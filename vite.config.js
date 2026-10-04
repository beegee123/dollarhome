// Vite runs the app while we develop and bundles it for the web.
// The React plugin lets Vite understand JSX (the HTML-like syntax inside .jsx files).
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
