import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted variable fonts (offline-safe): Onest — UI, Unbounded — display, JetBrains Mono — code/IDs.
import '@fontsource-variable/onest'
import '@fontsource-variable/unbounded'
import '@fontsource-variable/jetbrains-mono'
import './styles/tokens.css'
import './styles/global.css'
import './styles/glyphs.css'
import './styles/atmosphere.css'
import App from './App'
import { initTheme } from './shell/theme'

// Тема уже выставлена инлайн-скриптом в index.html (без вспышки) — здесь синхронизируем meta theme-color.
initTheme()

const container = document.getElementById('root')
if (!container) throw new Error('Root element #root not found')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
