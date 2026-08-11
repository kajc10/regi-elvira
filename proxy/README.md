# The proxy

## Why it exists

A browser will not hand your page a response from another site unless that site's reply
approves it with an `Access-Control-Allow-Origin` header. MÁV's timetable server sends
no such header, so the browser fetches the data and throws it away. That rule only
applies to browsers — one server calling another is unaffected. So the proxy asks MÁV,
attaches the missing header, and passes the answer on. That is all it does.

## Deploying it

`deno-deploy.ts` is the one in use. [Deno Deploy](https://deno.com/deploy) is free and
lets you choose the whole subdomain, so the address carries no account name.

1. Sign in at <https://dash.deno.com>, **New Playground**, paste `deno-deploy.ts`,
   **Save & Deploy**, and rename the project to the address you want.
2. Check it:

   ```sh
   curl -s 'https://YOUR-PROJECT.deno.net?query=%7Bfeeds%7BfeedId%7D%7D'
   ```

   A list of feeds means it works.
3. Put the address in `assets/js/api.js` as `API_URL`, then commit.

`cloudflare-worker.js` is the same proxy for Cloudflare Workers. Which host works can
change: MÁV rate limits per source network and currently refuses Cloudflare's shared
addresses with `403 host limit achived` while answering Deno's normally. If a proxy
stops being answered, deploy it elsewhere or run it from your own connection — do not
disguise the traffic to get around a limit.

## Who may use it

`ALLOWED_ORIGINS` lists the pages allowed to call the proxy; empty means any.

```ts
const ALLOWED_ORIGINS: string[] = [
  "https://kajc10.github.io",
  "http://localhost:8000",
];
```

**Scheme and host only, never a path** — `https://kajc10.github.io/regi-elvira/` locks
out your own site, because that is not what the browser sends as the `Origin`. One entry
covers every repository under the account.

This keeps other people's *websites* off your request allowance, which is the only real
risk: at worst someone spends your free quota for the day. It does not stop `curl`,
which can send any origin or none — a fence against casual reuse, not a security
control, and the right amount of effort given there is nothing behind it to protect.

## Notes

- **GET and POST both work; the page uses GET**, because a POST with a JSON content type
  costs an extra CORS preflight round trip. Upstream takes only POST, so the proxy sends
  one either way. The page falls back to POST on a `405`, so page and proxy can be
  deployed in any order.
- **Nothing is cached** (`Cache-Control: no-store`) — live delays are the point.
- A `403` from MÁV carries no CORS headers, so it would reach the browser as a bare
  `Failed to fetch` and make a working site look broken. Both proxies translate it into
  a readable message.
- If MÁV moves the endpoint, only `UPSTREAM` needs changing.
- Your editor may flag `Deno` as undefined in `deno-deploy.ts`. Local only — that file
  is never compiled or run by this project.
