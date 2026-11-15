import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Browse } from './pages/Browse'
import { Project } from './pages/Project'
import { SearchResults } from './pages/SearchResults'
import { Shell, Trouble } from './components/bits'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('no #root in the page')

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Browse />} />
        <Route path="/search" element={<SearchResults />} />
        <Route path="/p/:slug" element={<Project />} />
        <Route path="*" element={
          <Shell><Trouble message="There is nothing at that address." /></Shell>
        } />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
