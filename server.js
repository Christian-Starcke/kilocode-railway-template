#!/usr/bin/env node
/**
 * server.js — Kilo Code Railway Wrapper
 *
 * Provides:
 * - WebSocket proxy support for real-time console features
 * - Graceful shutdown (SIGTERM/SIGINT forwarding)
 * - Request/response proxying with Basic Auth
 * - Configurable log levels
 * - Root to /console redirect
 *
 * Assumes kilo serve is already running on INTERNAL_PORT (started by start.sh)
 */

const http = require('http');
const { spawn } = require('child_process');
const crypto = require('crypto');

// Configuration from environment
const PORT = parseInt(process.env.PORT || '8080', 10);
const INTERNAL_PORT = parseInt(process.env.INTERNAL_PORT || String(PORT + 1), 10);
const USERNAME = process.env.KILO_SERVER_USERNAME || 'kilo';
const PASSWORD = process.env.KILO_SERVER_PASSWORD;
const LOG_LEVEL = (process.env.LOG_LEVEL || 'INFO').toUpperCase();
const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.KILO_SHUTDOWN_TIMEOUT_MS || '10000', 10);
const SESSION_COOKIE_NAME = 'kilo_console_session';
const SESSION_MAX_AGE_MS = parseInt(
  process.env.KILO_SESSION_MAX_AGE_MS || String(7 * 24 * 60 * 60 * 1000),
  10,
);

// Log levels: ERROR=0, WARN=1, INFO=2, DEBUG=3
const LOG_LEVELS = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };
const currentLogLevel = LOG_LEVELS[LOG_LEVEL] || LOG_LEVELS.INFO;

function shouldLog(level) {
  return LOG_LEVELS[level] <= currentLogLevel;
}

function log(level, message) {
  if (shouldLog(level)) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] [server] ${message}`);
  }
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;

  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) cookies[key] = value;
  }

  return cookies;
}

function isSecureRequest(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return Boolean(req.socket.encrypted || forwardedProto === 'https');
}

function buildSessionToken(expiresAt) {
  const payload = `${USERNAME}:${expiresAt}`;
  const signature = crypto.createHmac('sha256', PASSWORD).update(payload).digest('base64url');
  return `${expiresAt}.${signature}`;
}

function buildSessionCookieHeader(req) {
  const expiresAt = Date.now() + SESSION_MAX_AGE_MS;
  const token = buildSessionToken(expiresAt);
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=None',
    `Max-Age=${Math.max(1, Math.floor(SESSION_MAX_AGE_MS / 1000))}`,
  ];

  if (isSecureRequest(req)) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

function hasValidSessionCookie(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return false;

  const [expiresAtRaw, signature] = token.split('.');
  const expiresAt = Number(expiresAtRaw);

  if (!expiresAtRaw || !signature || !Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    return false;
  }

  const expected = crypto.createHmac('sha256', PASSWORD).update(`${USERNAME}:${expiresAt}`).digest('base64url');
  return timingSafeEqual(signature, expected);
}

function buildInternalAuthHeader() {
  return `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64')}`;
}

if (!PASSWORD) {
  console.error('ERROR: KILO_SERVER_PASSWORD is required');
  process.exit(1);
}

log('INFO', `Starting Kilo proxy wrapper`);
log('INFO', `Port: ${PORT}, Internal port: ${INTERNAL_PORT}`);
log('INFO', `Log level: ${LOG_LEVEL}`);
log('INFO', `Username: ${USERNAME}, Password length: ${PASSWORD.length}`);

// Parse Basic Auth from request
function parseBasicAuth(req) {
  const auth = req.headers.authorization;
  
  if (shouldLog('DEBUG')) {
    log('DEBUG', `Auth header present: ${auth ? 'YES' : 'NO'}`);
    if (process.env.LOG_LEVEL === 'DEBUG') {
      log('DEBUG', `All headers: ${JSON.stringify(Object.keys(req.headers))}`);
    }
  }
  
  if (!auth) return null;

  const [scheme, encoded] = auth.split(' ');
  if (scheme !== 'Basic' || !encoded) return null;

  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const [user, pass] = decoded.split(':');
    return { user, pass };
  } catch {
    return null;
  }
}

// Constant-time string comparison to prevent timing attacks
function timingSafeEqual(a, b) {
  try {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

// Check if request is authenticated
function checkBasicAuth(req) {
  const auth = parseBasicAuth(req);
  if (!auth) {
    if (shouldLog('DEBUG')) log('DEBUG', 'No auth credentials parsed');
    return false;
  }
  
  const userMatch = timingSafeEqual(auth.user, USERNAME);
  const passMatch = timingSafeEqual(auth.pass, PASSWORD);
  
  if (shouldLog('DEBUG')) {
    log('DEBUG', `Received user: "${auth.user}" (expected: "${USERNAME}") - Match: ${userMatch}`);
    log('DEBUG', `Received pass: "${auth.pass.substring(0, 3)}***" (expected: "${PASSWORD.substring(0, 3)}***") - Match: ${passMatch}`);
  }
  
  return userMatch && passMatch;
}

// Unauthorized HTML body
const UNAUTHORIZED_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Kilo Console — Authentication Required</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 40px; }
    h1 { color: #333; }
    p { color: #666; line-height: 1.6; }
  </style>
</head>
<body>
  <h1>Authentication Required</h1>
  <p>This Kilo Console is password-protected. Your browser should prompt you for credentials.</p>
</body>
</html>
`;

// Handle regular HTTP requests
function handleRequest(req, res) {
  const url = req.url || '/';
  const pathname = url.split('?')[0];

  if (shouldLog('DEBUG')) {
    log('DEBUG', `${req.method} ${url} from ${req.socket.remoteAddress}`);
  }

  // Redirect root to /console
  if (pathname === '/' || pathname === '') {
    res.writeHead(302, { Location: '/console' });
    res.end();
    return;
  }

  // Check authentication
  if (shouldLog('DEBUG')) log('DEBUG', `Checking auth for ${req.method} ${req.url}`);
  const sessionValid = hasValidSessionCookie(req);
  if (shouldLog('DEBUG')) log('DEBUG', `Session cookie valid: ${sessionValid ? 'YES' : 'NO'}`);

  let authenticatedWithBasic = false;
  if (!sessionValid) {
    authenticatedWithBasic = checkBasicAuth(req);
    if (!authenticatedWithBasic) {
      if (shouldLog('DEBUG')) log('DEBUG', `Auth failed, returning 401`);
      const body = Buffer.from(UNAUTHORIZED_HTML, 'utf-8');
      res.writeHead(401, {
        'WWW-Authenticate': 'Basic realm="Kilo Console"',
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': String(body.length),
        'Cache-Control': 'no-store',
      });
      res.end(body);
      return;
    }
  }

  if (shouldLog('DEBUG')) {
    log('DEBUG', `Auth passed via ${sessionValid ? 'session cookie' : 'basic auth'}, proxying request`);
  }

  // Proxy to internal kilo serve
  const options = {
    hostname: '127.0.0.1',
    port: INTERNAL_PORT,
    path: url,
    method: req.method,
    headers: {
      ...req.headers,
      authorization: buildInternalAuthHeader(),
    },
  };

  // Strip only proxy-specific headers; we inject canonical auth for the internal service.
  delete options.headers['proxy-connection'];

  const proxyReq = http.request(options, (proxyRes) => {
    if (shouldLog('DEBUG')) {
      log('DEBUG', `Response: ${proxyRes.statusCode} for ${req.method} ${url}`);
    }

    const responseHeaders = { ...proxyRes.headers };
    if (authenticatedWithBasic) {
      const sessionCookie = buildSessionCookieHeader(req);
      const existingSetCookie = responseHeaders['set-cookie'];
      responseHeaders['set-cookie'] = existingSetCookie
        ? Array.isArray(existingSetCookie)
          ? [...existingSetCookie, sessionCookie]
          : [existingSetCookie, sessionCookie]
        : sessionCookie;
    }

    res.writeHead(proxyRes.statusCode, responseHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    log('ERROR', `Proxy error: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Bad Gateway\n');
    }
  });

  req.pipe(proxyReq);
}

// Handle WebSocket upgrades
function handleUpgrade(req, socket, head) {
  const url = req.url || '/';

  if (shouldLog('DEBUG')) {
    log('DEBUG', `WebSocket upgrade: ${url}`);
  }

  // Check authentication for WebSocket
  const sessionValid = hasValidSessionCookie(req);
  if (shouldLog('DEBUG')) log('DEBUG', `WebSocket session cookie valid: ${sessionValid ? 'YES' : 'NO'}`);

  let authenticatedWithBasic = false;
  if (!sessionValid) {
    authenticatedWithBasic = checkBasicAuth(req);
    if (!authenticatedWithBasic) {
      log('WARN', `WebSocket auth failed for ${url}`);
      socket.write(
        'HTTP/1.1 401 Unauthorized\r\n' +
        'WWW-Authenticate: Basic realm="Kilo Console"\r\n' +
        'Connection: close\r\n' +
        '\r\n'
      );
      socket.end();
      return;
    }
  }

  if (shouldLog('DEBUG')) {
    log('DEBUG', `WebSocket auth passed via ${sessionValid ? 'session cookie' : 'basic auth'}`);
  }

  // Create outbound WebSocket connection to internal port
  //
  // The inner kilo serve validates the WebSocket auth via the `auth_token` query
  // parameter on /pty/:id/connect. The browser sends `auth_token=base64(kilo:kilo)`
  // (its hardcoded default) because it doesn't know about KILO_SERVER_PASSWORD.
  //
  // If we forward that bad auth_token as-is, kilo serve silently rejects the
  // WebSocket upgrade and the browser shows "Terminal disconnected".
  //
  // Strip the auth_token from the upstream URL so the inner kilo serve falls back
  // to the Authorization header (which we inject below with the real credentials).
  const internalUrl = (() => {
    try {
      const u = new URL(url, 'http://127.0.0.1');
      u.searchParams.delete('auth_token');
      return u.pathname + (u.search ? u.search : '');
    } catch (_) {
      return url;
    }
  })();

  if (shouldLog('DEBUG')) {
    log('DEBUG', `Forwarding WebSocket to internal as ${internalUrl}`);
  }

  const outboundHeaders = {
    ...req.headers,
    authorization: buildInternalAuthHeader(),
  };
  delete outboundHeaders['proxy-connection'];

  const outboundReq = http.request({
    hostname: '127.0.0.1',
    port: INTERNAL_PORT,
    path: internalUrl,
    method: 'GET',
    headers: outboundHeaders,
  });

  outboundReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    if (shouldLog('DEBUG')) {
      log('DEBUG', `WebSocket upgrade successful for ${url}`);
    }

    const setCookieHeader = authenticatedWithBasic
      ? `Set-Cookie: ${buildSessionCookieHeader(req)}\r\n`
      : '';

    // Send response back to client
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      setCookieHeader +
      `Sec-WebSocket-Accept: ${crypto
        .createHash('sha1')
        .update((req.headers['sec-websocket-key'] || '') + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64')}\r\n` +
      '\r\n'
    );

    if (proxyHead.length > 0) {
      socket.write(proxyHead);
    }

    // Bidirectional tunnel
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);

    proxySocket.on('error', (err) => {
      log('WARN', `WebSocket proxy error: ${err.message}`);
      socket.destroy();
    });

    socket.on('error', (err) => {
      log('WARN', `WebSocket client error: ${err.message}`);
      proxySocket.destroy();
    });
  });

  outboundReq.on('error', (err) => {
    log('ERROR', `WebSocket upgrade failed: ${err.message}`);
    socket.write('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    socket.end();
  });

  outboundReq.end();
}

// Create HTTP server
const server = http.createServer(handleRequest);
server.on('upgrade', handleUpgrade);

// Graceful shutdown
let shuttingDown = false;

function gracefulShutdown(signal) {
  if (shuttingDown) {
    log('WARN', `Shutdown already in progress, ignoring ${signal}`);
    return;
  }

  shuttingDown = true;
  log('INFO', `Received ${signal}, initiating graceful shutdown`);

  // Stop accepting new connections
  server.close(() => {
    log('INFO', 'Server closed, waiting for connections to finish');
  });

  // Force exit after timeout
  const shutdownTimer = setTimeout(() => {
    log('ERROR', `Graceful shutdown timeout (${SHUTDOWN_TIMEOUT_MS}ms), force exiting`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  // Allow cleanup immediately if all connections close
  shutdownTimer.unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  log('ERROR', `Uncaught exception: ${err.message}`);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  log('ERROR', `Unhandled rejection: ${reason}`);
  gracefulShutdown('unhandledRejection');
});

// Start listening
server.listen(PORT, '0.0.0.0', () => {
  log('INFO', `Server listening on 0.0.0.0:${PORT}`);
  log('INFO', `Proxying to 127.0.0.1:${INTERNAL_PORT}`);
  log('INFO', `WebSocket support: enabled`);
  log('INFO', `Ready to accept connections`);
});

// Handle server errors
server.on('error', (err) => {
  log('ERROR', `Server error: ${err.message}`);
  process.exit(1);
});
