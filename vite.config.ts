import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

export default defineConfig({
  base: "./",
  server: {host: "127.0.0.1"},
  plugins: [react(), {
    name: "private-local-ledger",
    // Only the loopback development server reads this file; never bundled into dist.
    configureServer(server) {
      server.middlewares.use('/api/private-ledger', (req, res) => {
        const host=req.headers.host??'';
        const origin=req.headers.origin;
        if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) || (origin && origin!==`http://${host}`)) {res.statusCode=403;res.end();return;}
        res.setHeader('Cache-Control','no-store');
        const file=path.resolve('data/private/ledger.local.json');
        if(!fs.existsSync(file)){res.statusCode=404;res.end();return;}
        res.setHeader('Content-Type','application/json');res.end(fs.readFileSync(file));
      });
    },
  }],
});
