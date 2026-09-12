import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

async function bootstrap(): Promise<void> {
  // Keep the browser runtime out of Electron's eager renderer path.
  if (!window.nais) await import('./browser/install-browser-api')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void bootstrap()
