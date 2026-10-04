// Entry point: find the <div id="root"> in index.html and draw <App /> inside it.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App.jsx'
import './App.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* BrowserRouter keeps track of the address bar so each screen can have its own URL. */}
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
