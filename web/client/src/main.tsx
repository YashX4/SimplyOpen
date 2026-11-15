import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom'
import { Browse } from './pages/Browse'
import { Project } from './pages/Project'
import { SearchResults } from './pages/SearchResults'
import { Plain } from './components/bits'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('no #root in the page')

/** A new page starts at its top, the way a new page always has. */
function TopOnMove() {
  const { pathname, search } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname, search])
  return null
}

const home = <div className="col"><Link className="btn" to="/">Browse everything</Link></div>

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <TopOnMove />
      <Routes>
        <Route path="/" element={<Browse />} />
        <Route path="/search" element={<SearchResults />} />
        <Route path="/p/:slug" element={<Project />} />
        {/* These three are designed and not built yet. They say so rather than break. */}
        <Route path="/publish" element={
          <Plain current="Publish" title="Publish" line="This part of the site is still being built.">{home}</Plain>
        } />
        <Route path="/my-things" element={
          <Plain current="My things" title="My things" line="This part of the site is still being built.">{home}</Plain>
        } />
        <Route path="/sign-in" element={
          <Plain title="Sign in" line="Signing in is still being built. Everything on browse works without it.">{home}</Plain>
        } />
        <Route path="*" element={
          <Plain title="There is nothing here" line="The address may be wrong, or the page may have moved.">{home}</Plain>
        } />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
