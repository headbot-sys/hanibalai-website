import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { consoleRouter, agentRouter } from './routes.js';
import './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 8787);

app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'forge-rmm', version: '0.1.0' });
});

app.use('/api/v1/console', consoleRouter);
app.use('/api/v1/agent', agentRouter);

const consoleDist = path.join(__dirname, '..', '..', 'console', 'dist');
if (fs.existsSync(consoleDist)) {
  app.use(express.static(consoleDist));
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(path.join(consoleDist, 'index.html'));
  });
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Forge RMM server listening on http://localhost:${PORT}`);
  console.log(`Console API key: ${process.env.FORGE_CONSOLE_KEY || 'forge-dev-console-key'}`);
});
