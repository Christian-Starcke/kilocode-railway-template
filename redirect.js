#!/usr/bin/env node
/**
 * redirect.js — Lightweight Node.js proxy that redirects / → /console
 * for the Kilo Code Railway template.
 *
 * Runs on $PORT (default 8080), proxies everything to
 * $INTERNAL_PORT (default $PORT + 1) where kilo serve actually listens.
 *
 * Root path (/) gets a 302 redirect to /console.
 * 401 responses from kilo serve get an HTML body so the browser
 * shows the login prompt instead of a blank page.
 */
const http = require('http');

const PORT = parseInt(process.env.PORT || '8080', 10);
const INTERNAL_PORT = parseInt(process.env.INTERNAL_PORT || String(PORT + 1), 10);

/** Minimal HTML page for the 401 so the browser doesn't show a blank sheet. */
const UNAUTHORIZED_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Kilo Console — Authentication Required</title>
  <style>
    body {
      margin: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
    }
    .card {
      max-width: 420px;
      text-align: center;
      padding: 2rem;
    }
    h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.5rem; }
    p  { color: #8b949e; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Authentication Required</h1>
    <p>This Kilo Console is password-protected. Your browser should prompt you for credentials.</p>
  </div>
</body>
</html>`;

const server = http.createServer((req, res) => {
  const url = req.url || '/';

  // Redirect root to /console
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
    const { statusCode, headers: upstreamHeaders } = proxyRes;

    // If kilo serve returns 401 (no credentials), add a body so the
    // browser has content to show alongside the auth dialog.
    if (statusCode === 401) {
      const body = Buffer.from(UNAUTHORIZED_HTML, 'utf-8');
      const outHeaders = {
        ...upstreamHeaders,
        'content-type': 'text/html; charset=utf-8',
        'content-length': String(body.length),
        'www-authenticate': upstreamHeaders['www-authenticate'] || 'Basic realm="Kilo Console"',
      };
      // Let the original content-length from kilo serve (0) be
      // replaced by our actual body length.
      delete outHeaders['content-length'];
      res.writeHead(401, {
        ...upstreamHeaders,
        'content-type': 'text/html; charset=utf-8',
        'content-length': String(body.length),
        'www-authenticate': upstreamHeaders['www-authenticate'] || 'Basic realm="Kilo Console"',
      });
      res.end(body);
      return;
    }

    // All other responses pass through
    res.writeHead(statusCode, upstreamHeaders);
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