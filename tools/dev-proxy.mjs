#!/usr/bin/env node
// Local stand-in for the Cloudflare Worker, so the page can be tried out before
// anything is deployed. Same job: forward the GraphQL request and add the CORS
// headers MÁV's server omits.
//
//   node tools/dev-proxy.mjs        # listens on http://127.0.0.1:8787
//
// While it runs, a page opened from localhost uses it automatically (see
// js/api.js). Not meant for anything but local testing — it allows any origin.

import { createServer } from "node:http";

const UPSTREAM =
  "https://mavplusz.hu/otp2-backend/otp/routers/default/index/graphql";
const PORT = Number(process.env.PORT || 8787);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// GET is what the page uses (cacheable, no preflight); POST still works.
async function readBody(req) {
  if (req.method === "GET") {
    const params = new URL(req.url, "http://127.0.0.1").searchParams;
    const query = params.get("query");
    if (!query) return null;
    return JSON.stringify({
      query,
      variables: JSON.parse(params.get("variables") || "{}"),
    });
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS).end();
    return;
  }
  if (req.method !== "GET" && req.method !== "POST") {
    res.writeHead(405, { ...CORS, "Content-Type": "text/plain" }).end("GET or POST only");
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    body = null;
  }
  if (body === null) {
    res.writeHead(400, { ...CORS, "Content-Type": "text/plain" }).end("Expected a GraphQL query.");
    return;
  }

  try {
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const text = await upstream.text();
    console.log(`${new Date().toISOString().slice(11, 19)}  ${req.method}  ${upstream.status}  ${text.length} bytes`);
    res
      .writeHead(upstream.status, {
        ...CORS,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      })
      .end(text);
  } catch (err) {
    console.error("upstream error:", err.message);
    res
      .writeHead(502, { ...CORS, "Content-Type": "application/json" })
      .end(JSON.stringify({ errors: [{ message: "The MÁV server did not respond." }] }));
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`dev proxy: http://127.0.0.1:${PORT}  ->  ${UPSTREAM}`);
});
