import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './shell/App'

import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('renderer: #root not found in index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
