# The proxy

## Why one is needed at all

A browser will not hand your page a response from another site unless that site's
reply carries an `Access-Control-Allow-Origin` header approving your page. MÁV's
timetable server never sends one — it was not built for other people's websites — so
the browser fetches the data and then throws it away before your page can read it.

That rule only exists inside browsers. One server calling another is unaffected. So
the proxy is a small program that asks MÁV, receives the answer, attaches the missing
header, and passes it on. About sixty lines, and nothing else.

## Deno Deploy — the one in use

This project runs on [Deno Deploy](https://deno.com/deploy). Free, no card, and you
choose the whole subdomain.

1. Sign in at <https://dash.deno.com> with GitHub.
2. **New Playground**, paste the contents of `deno-deploy.ts`, **Save & Deploy**.
3. Rename the project to whatever you want the address to be.
4. Check it before wiring it in:

   ```sh
   curl -s -X POST -H "Content-Type: application/json" \
     -d '{"query":"{feeds{feedId}}"}' \
     https://YOUR-PROJECT.deno.net
   ```

   A list of feeds (`{"data":{"feeds":[{"feedId":"tatabanya"}…`) means it works.

5. Put that address in `js/api.js`:

   ```js
   var API_URL = "https://YOUR-PROJECT.deno.net";
   ```

6. Commit and push.

Your editor may underline `Deno` in `deno-deploy.ts` with "Cannot find name 'Deno'".
That is local only — the global is supplied by the Deno runtime, and the file is never
compiled or run by this project.

## The Cloudflare version

`cloudflare-worker.js` is the same proxy for Cloudflare Workers, kept as an
alternative. Which host works can vary: the upstream applies its own rate limits per
source network, and at the time of writing requests from Cloudflare's shared addresses
are declined with `403 host limit achived`, while Deno's are answered normally. That is
the upstream's decision to make, and it can change in either direction.

If a proxy stops being answered, the sensible responses are to deploy it somewhere else,
run it from your own connection (`tools/dev-proxy.mjs` behind a tunnel), use the page
locally, or simply ask MÁV. Do not try to disguise the traffic or cycle through
addresses to get around a limit — it is their server, and this is a hobby page.

Because a 403 carries no CORS headers it would otherwise reach the browser as a bare
`Failed to fetch`, making a working site look broken. Both proxies translate it into a
readable message instead.

## Restricting who may use your proxy (optional)

### Why the address is public

The browser is what calls the proxy, so its address has to be written in `js/api.js`,
which is served to every visitor and sits in a public repository. There is no way
around that for a static site, and no reason to want one: the address is not a
credential. It grants no access to your Deno or Cloudflare account, cannot change or
delete anything, and reveals nothing beyond "this relays MÁV timetable data".

### What somebody could do with it

Point their own website at it and let their visitors spend your request allowance.
That is the whole threat. At worst you exhaust the free quota for the day and your own
page stops answering until it resets; there is no bill to run up.

### Closing that door

Every request a browser makes carries an `Origin` header naming the page it came from,
and a browser will not let a page read a response unless the reply approves that exact
origin. Listing your own addresses therefore keeps other people's *sites* out.

In `deno-deploy.ts` (or `cloudflare-worker.js`), change:

```ts
const ALLOWED_ORIGINS: string[] = [];
```

to:

```ts
const ALLOWED_ORIGINS: string[] = [
  "https://kajc10.github.io",
  "http://localhost:8000",
];
```

and deploy again. Nothing else changes.

**Scheme and host only — never a path.** `https://kajc10.github.io/regi-elvira/` is
wrong and locks out your own site, because the browser sends `https://kajc10.github.io`
as the Origin whichever page of yours is open. One entry covers every repository and
path under it. Keep the `localhost` line or local testing stops working.

Anything not on the list gets a plain `403` that explains itself, which is easier to
diagnose than a silent CORS failure.

### What it does not do

It does not stop a script or a `curl` command, which can send any `Origin` they like
or none at all — a request with no `Origin` is allowed through on purpose so the check
above keeps working. This is a fence against casual reuse by other websites, not a
security control. That is the right level of effort here, because there is nothing
behind it to protect.

## Notes

- The proxy caches identical requests for a minute (`Cache-Control: max-age=60`). MÁV
  does not update delays faster than that, so nothing is lost.
- If MÁV ever moves the endpoint, only the `UPSTREAM` line needs changing; the rest of
  the site stays as it is.
