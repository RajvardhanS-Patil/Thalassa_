import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  // Parse URL
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // 1. Proxy /erddap requests to https://erddap.incois.gov.in
  if (pathname.startsWith('/erddap')) {
    console.log(`[Proxy] ${req.method} ${pathname} -> https://erddap.incois.gov.in${pathname}${parsedUrl.search}`);
    
    const targetUrl = `https://erddap.incois.gov.in${pathname}${parsedUrl.search}`;
    
    const proxyReq = https.request(targetUrl, {
      method: req.method,
      headers: {
        ...req.headers,
        host: 'erddap.incois.gov.in',
      },
      rejectUnauthorized: false, // Ignore self-signed/expired SSL certificates
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error(`[Proxy Error] ${err.message}`);
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`Bad Gateway: ${err.message}`);
    });

    req.pipe(proxyReq);
    return;
  }

  // 2. Serve static files
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);

  // Safety check: prevent path traversal
  const relative = path.relative(__dirname, filePath);
  const isSafe = !relative.startsWith('..') && !path.isAbsolute(relative);
  
  if (!isSafe) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fall back to index.html
      filePath = path.join(__dirname, 'index.html');
      fs.stat(filePath, (err2, stats2) => {
        if (err2 || !stats2.isFile()) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
          return;
        }
        serveFile(filePath, res);
      });
      return;
    }

    serveFile(filePath, res);
  });
});

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Internal Server Error: ${err.code}`);
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content, 'utf-8');
  });
}

server.listen(PORT, () => {
  console.log(`[Thalassa Dev Server] Running at http://localhost:${PORT}`);
});
