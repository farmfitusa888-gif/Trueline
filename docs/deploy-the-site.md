# Putting scantobid.app on Cloudflare

The domain is registered and not connected. This is the whole path from that to
a live site, in order. Nothing here costs money: Cloudflare Pages is free for a
static site, with unlimited bandwidth and 500 builds a month.

---

## 1. Build it, and open the folder so you can drag it

```bash
trueline site
```

That pulls first, then builds, then reveals the folder. **The pull is not
optional and it is not tidiness.** The website is deployed by dragging the
folder this produces, so a checkout that is four commits behind ships a site
that is four commits behind — with no error, no warning, and nothing on the
screen to say so. It happened: the CSP, the self-hosted typefaces, the one-row
mobile bar and the shortened titles all landed after a working copy was last
brought up to date.

If `trueline` is not installed yet, the long way is the same thing:

```bash
cd ~/trueline && bash setup-mac.sh --checks-only && npm run site && open -R site/dist
```

`open -R` reveals `dist` **selected inside its parent window**, which is the
thing you drag. `open site/dist` puts you inside the folder, where there is
nothing to drag — that is the difference, and it has caught us before.

The build ends by checking itself: 43 pages, every canonical, every piece of
structured data parsed, no dead links, no orphans, no duplicate titles. If it
prints a problem, it does not deploy until that is fixed.

## 2. Point the domain at Cloudflare

This is a nameserver change at whoever you bought `scantobid.app` from.

1. <https://dash.cloudflare.com> → **Add a site** → type `scantobid.app`
2. Choose the **Free** plan.
3. Cloudflare shows you **two nameservers**, something like
   `ana.ns.cloudflare.com` and `rick.ns.cloudflare.com`. Copy both.
4. Go to your registrar (wherever you bought the domain), find **Nameservers**,
   choose **Custom**, and paste those two in place of what is there.
5. Save. Cloudflare emails you when it has taken; it is usually minutes and can
   be up to 24 hours.

You do not need to add any DNS records by hand. Step 4 below does it.

## 2a. The imported records: grey out everything that is not the website

When Cloudflare imports the existing DNS it turns the orange proxy cloud ON for
every A and CNAME record it finds. That is right for the website and **wrong for
every mail record**, because the proxy only carries HTTP and HTTPS. Anything to
do with mail or Teams goes through it and dies. Cloudflare marks them with a
warning triangle; this is what the triangle means.

Click the orange cloud on each of these so it reads **DNS only**:

| Record | What breaks if it stays proxied |
|---|---|
| `selector1._domainkey` | **DKIM signing** — outbound mail fails DMARC and lands in spam |
| `selector2._domainkey` | same |
| `autodiscover` | Outlook cannot configure the account by itself |
| `sip` | Teams / Skype for Business sign-in |
| `lyncdiscover` | same |
| `msoid` | Microsoft account sign-in |
| `email` | webmail access |
| `_domainconnect` | the registrar's own auto-setup hooks |

**Keep `www` proxied.** That one is the website and belongs behind the proxy.

**Leave the MX, SRV and TXT records exactly as they are** — they are already
DNS only, which is correct, and they are the mail routing, the SPF record, the
DMARC policy and the Microsoft 365 domain verification. Deleting any of them
stops mail.

The DKIM pair is the one worth double-checking, because it fails quietly:
mail keeps sending and recipients simply stop trusting it.

The two **A records on the bare domain** are whatever the domain pointed at
before. They are not the website. Cloudflare Pages creates its own record when
the custom domain is attached in step 4 and will offer to replace them — say
yes, or delete them here.

### One thing in that list that is not about Cloudflare

The SPF record reads:

    v=spf1 include:secureserver.net -all

That is what GoDaddy tells you to use for Microsoft 365 bought through them, and
it works: `secureserver.net` chains through to `spf.protection.outlook.com`, so
mail sent through Microsoft 365 passes SPF. Nothing is broken.

But `secureserver.net` authorises more than Microsoft. It also covers GoDaddy's
outbound webmail servers and the unauthenticated gateways their shared-hosting
customers send through — so anybody on GoDaddy shared hosting can send mail that
passes SPF **for this domain**. With DMARC set to `p=quarantine` and relaxed
alignment, that is a real path to somebody spoofing an estimate or an invoice
from an address a client already trusts.

The tighter record, which is what Microsoft themselves publish, is:

    v=spf1 include:spf.protection.outlook.com -all

**Check before changing it.** That value authorises Microsoft 365 and nothing
else. If any mail is ever sent from GoDaddy's own webmail rather than through
Microsoft 365 — the `email.secureserver.net` record in the list suggests such a
mailbox may exist — that mail would start failing. Confirm every address that
sends as `@scantobid.app` goes through Microsoft 365 first, then change it.

It is one TXT record, edited in Cloudflare, and reversible in a minute.

### Check it after the nameservers have taken

```bash
dig +short MX scantobid.app
dig +short CNAME selector1._domainkey.scantobid.app
dig +short TXT scantobid.app
```

The MX must still name your mail host, and the DKIM selector must return a
CNAME to a mail host. If the selector returns a Cloudflare IP instead, it is
still proxied — go back and grey it out.

## 3. Create the Pages project and drop the folder on it

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Upload assets**.
2. Project name: `trueline`.
3. Drag the **`dist` folder itself** from the Finder window step 1 opened onto
   the upload area. Not the files inside it — the folder.
4. **Deploy site.**

## 4. Attach scantobid.app

1. In the Pages project → **Custom domains** → **Set up a custom domain**.
2. Enter `scantobid.app`. Cloudflare creates the DNS record itself and issues
   the certificate. Wait until it says **Active** — usually a minute or two.
3. Do it a second time for `www.scantobid.app`. The `_redirects` file already
   in the build 301s `www` to the bare domain, so both addresses work and only
   one is ever indexed.

Open `https://scantobid.app` on your phone. That is the site.

## 5. Tell Google it exists

Until you do this, nothing is indexed no matter how good the pages are.

1. <https://search.google.com/search-console> → **Add property** → **Domain** →
   `scantobid.app`.
2. It asks for a **TXT record** to prove you own it. In Cloudflare: the site →
   **DNS** → **Add record** → type `TXT`, name `@`, content = the string Google
   gave you. Save, then **Verify** in Search Console.
3. Search Console → **Sitemaps** → enter `sitemap.xml` → **Submit**.
4. Search Console → **URL Inspection** → paste `https://scantobid.app/` →
   **Request indexing**. Do the same for `/guides/`.

Indexing takes days, not minutes. Coverage appears under **Pages**.

## 6. Every time after that

```bash
trueline site
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
