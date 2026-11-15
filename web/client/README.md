# The website

React and Vite. Three screens on the browsing path: browse, search
results, and a project page with its download.

    npm install
    npm run dev          # http://localhost:5173

It expects the API next door on 3200, and proxies /api to it, so run
`npm run dev` in `web/` first. The browser only ever sees one origin.

## What is here

    src/api.ts        the API, typed. Nothing in it sends credentials,
                      because nothing on this path needs an account.
    src/styles.css    the design language as custom properties
    src/components/   the pieces every screen shares
    src/pages/        Browse, SearchResults, Project

## The design language

One weight, 300, everywhere. Emphasis comes from size, never from
weight. Only these sizes exist: 14, 16, 18, 20, 24, 48, 64, 80. If a
new number creeps in, something is wrong.

Cream ground, near black ink, one teal for good news and one clay for
a problem. Panels carry a sideways wash so they read as glass.

The real design uses GT Canon and GT Standard, licensed from Grilli
Type, which we cannot ship. Fraunces and Inter stand in. To put the
real ones back, change the @import and the two font stacks at the top
of styles.css. Nothing else refers to them.

## What it deliberately does not do

No sign in on this path. Browse, the project page and the download all
work with no account, and there is a test in the API asserting it. If
a global auth guard ever appears here, that promise is broken and the
demo goes with it.
