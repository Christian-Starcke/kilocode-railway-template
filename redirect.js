#!/usr/bin/env node
/**
 * redirect.js — Lightweight Node.js proxy that redirects / → /console
 * for the Kilo Code Railway template.
 *
 * Runs on $PORT (default 8080), proxies everything to
 * $INTERNAL_PORT (default $PORT + 1) where kilo serve actually listens.
 * Root path (/) gets a 302 redirect to /console.
 */
const http = require('http');
const PORT = parseInt(process.env.PORT || '8080', 10);
const INTERNAL_PORT = parseInt(process.env.INTERNAL_PORT || String(PORT + 1), 10);

const server = http.createServer((req, res) => {
  // Redirect root to /console
  const url = req.url || '/';
  if (url === '/' || url === '') {
    res.writeHead(302, { Location: '/console' });
    res.end();
    return;
  }

  // Proxy everything else to the internal kilo serve instance
  const options = {
    hostname: '127.0.0.1',
    port: INTERNAL_PORT,
    path: url,
    method: req.method,
    headers: { ...req.headers },
  };
  // Strip hop-by-hop headers that could confuse the downstream
  delete options.headers['proxy-connection'];

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`[redirect] proxy error: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Bad Gateway');
    }
  });

  req.pipe(proxyReq);
});

server.listen(PORT, () => {
  console.log(`[redirect] listening on ${PORT}, proxying to internal :${INTERNAL_PORT}`);
  console.log(`[redirect] / → /console (302)`);
});