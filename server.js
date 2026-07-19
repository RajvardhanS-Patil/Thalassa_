import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import 'dotenv/config';

// Initialize Groq Client via OpenAI SDK
const ai = process.env.GROQ_API_KEY ? new OpenAI({ 
  apiKey: process.env.GROQ_API_KEY, 
  baseURL: 'https://api.groq.com/openai/v1' 
}) : null;

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

  // 1.5 Groq API Proxy
  if (pathname === '/api/gemini-advisory' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        if (!ai) {
          throw new Error('GROQ_API_KEY is not configured in .env file.');
        }
        
        const data = JSON.parse(body);
        const { query, context } = data;
        
        const systemPrompt = `You are Matsya Core, an advanced multimodal marine AI integrated into Thalassa (a digital twin of the Kerala coast).
You are an expert in oceanography, sustainable fishing, and maritime navigation.
The user is currently viewing the following spatial context:
${JSON.stringify(context, null, 2)}

Provide concise, practical advice based on this context. Answer the user's query clearly and directly. Keep responses under 100 words unless detail is required.
If you recommend navigating to a specific location or coordinate, you MUST include a spatial pan tag in your response in the format [PAN: lat, lng]. For example: [PAN: 10.4, 76.0]. This will allow the map to automatically pan to that location.`;

        const response = await ai.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: query }
          ],
          temperature: 0.2
        });
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text: response.choices[0].message.content }));
      } catch (error) {
        console.error('[Groq Error]', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
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
