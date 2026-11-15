import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router-dom'
import { Browse } from './pages/Browse'
import { Project } from './pages/Project'
import { SearchResults } from './pages/SearchResults'
import { CheckEmail, SignIn, SignInDone } from './pages/SignIn'
import { Publish } from './pages/Publish'
import { Review } from './pages/Review'
import { Ready } from './pages/Ready'
import { MyThings } from './pages/MyThings'
import { Manage } from './pages/Manage'
import { Inbox, Suggestion, TakeIt } from './pages/Suggestions'
import { GoBack, Version, Versions } from './pages/Versions'
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
        <Route path="/p/:slug/versions" element={<Versions />} />
        <Route path="/p/:slug/v/:n" element={<Version />} />
        <Route path="/p/:slug/v/:n/back" element={<GoBack />} />
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/sign-in/check" element={<CheckEmail />} />
        <Route path="/sign-in/done" element={<SignInDone />} />
        <Route path="/publish" element={<Publish />} />
        <Route path="/publish/:slug" element={<Review />} />
        <Route path="/publish/:slug/ready" element={<Ready />} />
        <Route path="/my-things" element={<MyThings />} />
        <Route path="/my-things/:slug" element={<Manage />} />
        <Route path="/my-things/:slug/suggestions" element={<Inbox />} />
        <Route path="/suggestions/:id" element={<Suggestion />} />
        <Route path="/suggestions/:id/take" element={<TakeIt />} />
        <Route path="*" element={
          <Plain title="There is nothing here" line="The address may be wrong, or the page may have moved.">{home}</Plain>
        } />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
