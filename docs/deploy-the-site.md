# Putting trueline.tools on Cloudflare

The domain is registered and not connected. This is the whole path from that to
a live site, in order. Nothing here costs money: Cloudflare Pages is free for a
static site, with unlimited bandwidth and 500 builds a month.

---

## 1. Build it, and open the folder so you can drag it

```bash
cd ~/trueline && npm run site && open -R site/dist
```

`open -R` reveals `dist` **selected inside its parent window**, which is the
thing you drag. `open site/dist` puts you inside the folder, where there is
nothing to drag — that is the difference, and it has caught us before.

The build ends by checking itself: 43 pages, every canonical, every piece of
structured data parsed, no dead links, no orphans, no duplicate titles. If it
prints a problem, it does not deploy until that is fixed.

## 2. Point the domain at Cloudflare

This is a nameserver change at whoever you bought `trueline.tools` from.

1. <https://dash.cloudflare.com> → **Add a site** → type `trueline.tools`
2. Choose the **Free** plan.
3. Cloudflare shows you **two nameservers**, something like
   `ana.ns.cloudflare.com` and `rick.ns.cloudflare.com`. Copy both.
4. Go to your registrar (wherever you bought the domain), find **Nameservers**,
   choose **Custom**, and paste those two in place of what is there.
5. Save. Cloudflare emails you when it has taken; it is usually minutes and can
   be up to 24 hours.

You do not need to add any DNS records by hand. Step 4 below does it.

## 3. Create the Pages project and drop the folder on it

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Upload assets**.
2. Project name: `trueline`.
3. Drag the **`dist` folder itself** from the Finder window step 1 opened onto
   the upload area. Not the files inside it — the folder.
4. **Deploy site.**

## 4. Attach trueline.tools

1. In the Pages project → **Custom domains** → **Set up a custom domain**.
2. Enter `trueline.tools`. Cloudflare creates the DNS record itself and issues
   the certificate. Wait until it says **Active** — usually a minute or two.
3. Do it a second time for `www.trueline.tools`. The `_redirects` file already
   in the build 301s `www` to the bare domain, so both addresses work and only
   one is ever indexed.

Open `https://trueline.tools` on your phone. That is the site.

## 5. Tell Google it exists

Until you do this, nothing is indexed no matter how good the pages are.

1. <https://search.google.com/search-console> → **Add property** → **Domain** →
   `trueline.tools`.
2. It asks for a **TXT record** to prove you own it. In Cloudflare: the site →
   **DNS** → **Add record** → type `TXT`, name `@`, content = the string Google
   gave you. Save, then **Verify** in Search Console.
3. Search Console → **Sitemaps** → enter `sitemap.xml` → **Submit**.
4. Search Console → **URL Inspection** → paste `https://trueline.tools/` →
   **Request indexing**. Do the same for `/guides/`.

Indexing takes days, not minutes. Coverage appears under **Pages**.

## 6. Every time after that

```bash
cd ~/trueline && npm run site && open -R site/dist
```

Then Cloudflare → the `trueline` project → **Create deployment** → drag `dist`
again. Each deployment keeps the one before it, so a bad one is a one-click
rollback.

---

## What is already in the build, so you do not have to set it up

| | |
|---|---|
| `robots.txt` | allows everything except `/thanks/`, points at the sitemap |
| `sitemap.xml` | all 41 indexable pages, with dates |
| `_headers` | HSTS, nosniff, no framing, no camera/mic/location, and a year of caching on the typefaces |
| `_redirects` | `www` → the bare domain, 301 |
| canonical tags | on every page, pointing at itself |
| Open Graph + Twitter cards | on every page, with an image |
| structured data | Article, FAQPage, BreadcrumbList, SoftwareApplication, Organization |
| the typefaces | served from this domain, so no third party sees your visitors and no page waits on one |
| Content-Security-Policy | `script-src 'self'` with no `unsafe-inline` and no `eval`, plus the sha256 of the one inline script, computed by the build. Enforced against all 42 pages at seven widths before it shipped. |

## What is NOT set up, and is yours to decide

- **Analytics.** Cloudflare Web Analytics is free and needs no cookie banner
  because it sets no cookie. One toggle in the Pages project.
- **hstspreload.org.** The header claims `preload`; the claim only counts once
  you submit the domain, and only do that when you are sure you will never want
  http.
