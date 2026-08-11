/* CORS proxy for the ELVIRA nostalgia page.
 *
 * MÁV's OpenTripPlanner answers anyone who asks, but it sends no
 * Access-Control-Allow-Origin header, so a browser refuses to hand the response
 * to a page served from github.io. This Worker sits in between: it forwards the
 * GraphQL request unchanged and attaches the missing headers.
 *
 * Deploy: see README.md in this folder.
 */

const UPSTREAM =
  "https://mavplusz.hu/otp2-backend/otp/routers/default/index/graphql";

/* Which web pages may use this proxy.
 *
 * An empty list means any page, which is the default because it needs no setup
 * and this only relays a public timetable. To keep other people's sites off your
 * daily quota, list the addresses your own page is served from — scheme and host
 * only, never a path:
 *
 *   const ALLOWED_ORIGINS = [
 *     "https://yourname.github.io",   // NOT ".../regi-elvira/"
 *     "http://localhost:8000",
 *   ];
 *
 * Be clear about what this achieves. A browser attaches an Origin header naming
 * the page that is making the call, and it will not let a page read a response
 * unless the reply approves that exact origin. So this does stop somebody else's
 * *website* from quietly using your Worker. It does not stop a script or a curl
 * command, which can send any Origin it likes or none at all. It is a fence
 * against casual reuse, not a security control — there is nothing behind it worth
 * attacking anyway. */
const ALLOWED_ORIGINS = [
  "https://holazelvira.hu",
  "https://www.holazelvira.hu",
  "https://kajc10.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

// Requests larger than this are almost certainly not ours.
const MAX_BODY_BYTES = 16 * 1024;

function isAllowed(origin) {
  // No Origin at all: a direct call rather than a page, e.g. curl. Nothing to gate.
  return ALLOWED_ORIGINS.length === 0 || !origin || ALLOWED_ORIGINS.includes(origin);
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/* The page asks by GET so the answer can be cached and the preflight skipped;
 * POST is still accepted, because an older copy of the page may be in somebody's
 * browser cache. Both end up as the same JSON body upstream. */
function readRequest(request) {
  if (request.method === "POST") return request.text();
  if (request.method !== "GET") return null;
  const params = new URL(request.url).searchParams;
  const query = params.get("query");
  if (!query) return null;
  return JSON.stringify({
    query,
    variables: JSON.parse(params.get("variables") || "{}"),
  });
}

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") ?? "";
    const cors = corsHeaders(origin);

    /* Say no plainly instead of returning a mismatched CORS header — the browser
     * would block it either way, but this way the reason is visible. */
    if (!isAllowed(origin)) {
      return new Response("This proxy does not serve " + origin + ".", {
        status: 403,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "GET" && request.method !== "POST") {
      return new Response("GET or POST requests only.", {
        status: 405,
        headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    let body;
    try {
      const read = await readRequest(request);
      if (read === null) {
        return new Response("Expected a GraphQL query.", {
          status: 400,
          headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      body = read;
    } catch (err) {
      return new Response("Malformed query parameters.", {
        status: 400,
        headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (body.length > MAX_BODY_BYTES) {
      return new Response("Request too large.", {
        status: 413,
        headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    let upstream;
    try {
      upstream = await fetch(UPSTREAM, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ errors: [{ message: "The MÁV server did not respond." }] }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    const text = await upstream.text();

    /* MÁV rate limits by source network and refuses Cloudflare's with
     * "host limit achived". Returning that as a 403 would reach the browser as a
     * bare "failed to fetch", so pass it on as a readable message instead. See
     * README.md — the fix is to host the proxy elsewhere. */
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
        /* Never cached. Live delays are the point of the page, and a stored
         * answer is a wrong one the moment a train loses another minute. The
         * request is a GET so that it costs no CORS preflight — not so that it
         * can be stored. */
        "Cache-Control": "no-store",
      },
    });
  },
};
