// @ts-nocheck — `Deno` is provided by the Deno runtime, which your editor's
// TypeScript does not know about unless the Deno extension is installed. The
// "Cannot find name 'Deno'" warning is local only; this file is meant to be
// pasted into Deno Deploy, where the global exists. Nothing here is compiled or
// run by this project.

/* The same CORS proxy, for Deno Deploy instead of Cloudflare Workers.
 *
 * Why this exists: MÁV refuses requests coming from Cloudflare's network with
 * "host limit achived" (HTTP 403), while answering ordinary clients normally. The
 * page itself does not care which of the two is in front of it — whichever one
 * answers, put its address in js/api.js.
 *
 * Deno Deploy also lets you choose the whole subdomain, so the address contains
 * no account name.
 *
 * Deploy: see README.md in this folder.
 */

const UPSTREAM =
  "https://mavplusz.hu/otp2-backend/otp/routers/default/index/graphql";

/* Web pages allowed to use this proxy; empty means any. Scheme and host only,
 * never a path. See the Cloudflare notes in README.md — the reasoning and the
 * limits of this check are identical here. */
const ALLOWED_ORIGINS: string[] = [
  "https://holazelvira.hu",
  "https://www.holazelvira.hu",
  "https://kajc10.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

const MAX_BODY_BYTES = 16 * 1024;

function isAllowed(origin: string): boolean {
  // No Origin at all: a direct call rather than a page, e.g. curl. Nothing to gate.
  return ALLOWED_ORIGINS.length === 0 || !origin || ALLOWED_ORIGINS.includes(origin);
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin") ?? "";
  const cors = corsHeaders(origin);

  if (!isAllowed(origin)) {
    return new Response(`This proxy does not serve ${origin}.`, {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (request.method !== "POST") {
    return new Response("POST requests only.", {
      status: 405,
      headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const body = await request.text();

  if (body.length > MAX_BODY_BYTES) {
    return new Response("Request too large.", {
      status: 413,
      headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body,
    });
  } catch {
    return new Response(
      JSON.stringify({ errors: [{ message: "The MÁV server did not respond." }] }),
      { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const text = await upstream.text();

  /* Pass the upstream's own refusal through in a shape the page can explain,
   * rather than letting it surface as a bare "failed to fetch". */
  if (upstream.status === 403) {
    return new Response(
      JSON.stringify({
        errors: [
          {
            message:
              "MÁV refused this proxy (" + text.trim() + "). " +
              "Its network is being rate limited — try another host for the proxy.",
          },
        ],
      }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  return new Response(text, {
    status: upstream.status,
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
      // Identical searches within a minute reuse the answer, which keeps realtime
      // data fresh enough while asking as little of MÁV as possible.
      "Cache-Control": "public, max-age=60",
    },
  });
});
