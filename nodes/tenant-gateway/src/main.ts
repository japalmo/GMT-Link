import { createServer } from 'node:http';
import { handleHealth } from './app.js';

const PORT = Number(process.env.PORT ?? 3010);
const TENANT = process.env.TENANT_ID;

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(handleHealth(TENANT)));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[tenant-gateway:${TENANT ?? 'unknown'}] escuchando en http://0.0.0.0:${PORT}`);
});
