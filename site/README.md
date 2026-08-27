# The Trueline website

One command builds it, one command proves it is not broken.

```bash
node site/build.mjs        # writes site/dist
node site/tools/check.mjs  # reads site/dist and fails on anything wrong
```

## What is here

| | |
|---|---|
| `content/site.mjs` | The business: name, price, email, and the list of things the site is allowed to claim. |
| `content/guides/` | 28 guides as data — four files, one per audience. |
| `content/templates.mjs` | The free PDF forms, field by field. |
| `src/style.css` | The design: drafting paper, blueprint ink, dimension lines. |
| `src/room3d.js` | A real room in WebGL, hand written, about 6 kB. |
| `src/shots/` | Real screenshots of the real app. |
| `build.mjs` | Generates every page, the sitemap and robots.txt. |
| `tools/capture.mjs` | Re-takes the screenshots by driving the actual app. |
| `tools/pdfs.mjs` | Generates the free forms with the same library the app uses. |
| `tools/check.mjs` | The red-team pass. Runs in the Netlify build. |
| `tools/shots.mjs` | Photographs the built site in both themes and measures contrast. |

## The one thing you still have to fill in

`content/site.mjs` → `PEOPLE.trade`. Gilbert's name, how he describes his own
trade, and two sentences from him. Until it is filled in, no reviewer appears
anywhere — not in a byline, and not in the `reviewedBy` of any guide's
structured data.

That is deliberate. Telling Google something false about a named human being is
not a thing to risk on a placeholder, so the site simply ships without a
reviewer until the real details arrive. Everything else works today.

## Adding a guide

Add an entry to the right file in `content/guides/`, give it three `related`
slugs, and rebuild. `tools/check.mjs` will refuse the build if it is under 800
words, links to fewer than three other guides, has no inbound link from
anywhere, or is missing from the sitemap.

## Re-taking the screenshots

```bash
npm run build
(cd web && npx vite preview --port 4173 &)
node site/tools/capture.mjs
```

Nothing on this site is a mock-up. Every screenshot is the real app, driven in a
real browser, with real numbers off the fixture scan the app's own tests use.

## Deploying

Add a new Netlify site from this repository with the base directory set to
`site`. `netlify.toml` here does the rest, including running the checker as part
of the build — a deploy that would ship a dead link or broken structured data
fails instead of going live.

Then point `trueline.tools` at it, and set `SITE.origin` in `content/site.mjs`
if the domain is ever anything else.
