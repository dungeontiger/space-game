import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { objectsJsonApi } from './server/api';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const objectsJsonPath = path.resolve(__dirname, '..', '..', 'public', 'universe_definition.json');

export default defineConfig({
  plugins: [react(), objectsJsonApi(objectsJsonPath)],
  server: {
    // Keep it reachable on localhost; avoid firewall prompts for external access.
    host: '127.0.0.1',
  },
});

