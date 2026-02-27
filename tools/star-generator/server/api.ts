import fs from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';
import { DEFAULT_PARAMS, normalizeParams, type GeneratorMeta, type GeneratorParams } from '../src/lib/schema';
import { generateSystems } from './generator';

type UniverseEntryLike = {
  id: string;
  type: string;
  position: { x: number; y: number; z: number };
  name?: string;
  stars?: Array<{ position: { x: number; y: number; z: number } }>;
  generator?: unknown;
};

const META_ID = '__generator__';

export function objectsJsonApi(objectsJsonPath: string): Plugin {
  const backupPath = objectsJsonPath + '.bak';

  return {
    name: 'objects-json-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const url = req.url ?? '';
          if (url.startsWith('/api/state')) {
            if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
            const entries = await readEntries(objectsJsonPath);
            const meta = extractMeta(entries);
            const params = meta?.params ?? DEFAULT_PARAMS;
            const hasBackup = await exists(backupPath);
            const systemCount = entries.filter((e) => e?.type === 'system').length;
            return sendJson(res, 200, { params, meta, hasBackup, systemCount, objectsCount: entries.length });
          }

          if (url.startsWith('/api/preview')) {
            if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
            const body = await readJsonBody(req);
            const params = normalizeParams((body?.params ?? {}) as Partial<GeneratorParams>);
            const systems = generateSystems(params);
            const allStars = systems.flatMap((s) => s.stars);
            const bounds = getBounds(allStars);
            const starCount = allStars.length;
            return sendJson(res, 200, {
              params,
              systemCount: systems.length,
              starCount,
              sampleNames: systems.slice(0, 6).map((s) => s.name),
              bounds,
            });
          }

          if (url.startsWith('/api/write')) {
            if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
            const body = await readJsonBody(req);
            const params = normalizeParams((body?.params ?? {}) as Partial<GeneratorParams>);
            const systems = generateSystems(params);
            const starCount = systems.reduce((n, s) => n + s.stars.length, 0);
            const meta = buildMeta(params, systems.length, starCount);
            const nextEntries: UniverseEntryLike[] = [
              {
                id: META_ID,
                type: 'meta',
                position: { x: 0, y: 0, z: 0 },
                name: 'Generator',
                generator: meta,
              },
              ...systems,
            ];

            await backupOnce(objectsJsonPath, backupPath);
            await writeEntries(objectsJsonPath, nextEntries);
            return sendJson(res, 200, {
              ok: true,
              systemCount: systems.length,
              starCount,
              wrote: path.normalize(objectsJsonPath),
              backup: path.normalize(backupPath),
            });
          }

          return next();
        } catch (err) {
          return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });
    },
  };
}

async function readEntries(filePath: string): Promise<UniverseEntryLike[]> {
  const raw = await fs.readFile(filePath, 'utf8').catch(() => '[]');
  const data = JSON.parse(raw);
  return Array.isArray(data) ? (data as UniverseEntryLike[]) : [];
}

async function writeEntries(filePath: string, entries: UniverseEntryLike[]): Promise<void> {
  const text = JSON.stringify(entries, null, 2) + '\n';
  await fs.writeFile(filePath, text, 'utf8');
}

function extractMeta(entries: UniverseEntryLike[]): GeneratorMeta | null {
  const entry = entries.find((o) => o && o.type === 'meta' && o.id === META_ID);
  const g = entry?.generator as GeneratorMeta | undefined;
  if (!g || g.tool !== 'star-generator' || g.version !== 1 || !g.params) return null;
  return {
    tool: 'star-generator',
    version: 1,
    generatedAt: String(g.generatedAt ?? ''),
    systemCount: Number(g.systemCount ?? 0),
    starCount: Number(g.starCount ?? 0),
    params: normalizeParams(g.params as Partial<GeneratorParams>),
  };
}

function buildMeta(params: GeneratorParams, systemCount: number, starCount: number): GeneratorMeta {
  return {
    tool: 'star-generator',
    version: 1,
    generatedAt: new Date().toISOString(),
    params,
    systemCount,
    starCount,
  };
}

async function backupOnce(srcPath: string, backupPath: string): Promise<void> {
  const hasSrc = await exists(srcPath);
  if (!hasSrc) return;
  await fs.copyFile(srcPath, backupPath);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function getBounds(stars: Array<{ position: { x: number; y: number; z: number } }>): { min: [number, number, number]; max: [number, number, number] } {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const s of stars) {
    const { x, y, z } = s.position;
    minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}
