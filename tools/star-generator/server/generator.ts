import type { GeneratorParams } from '../src/lib/schema';
import {
  loadGeneratorData,
  getSystemTypeByStarCount,
  getStarTypeById,
  type GeneratorData,
  type StarTypeEntry,
  type SystemTypeEntry,
} from './dataLoader.js';

export type GeneratedStarInSystem = {
  id: string;
  name: string;
  position: { x: number; y: number; z: number };
  radius: number;
  color: string;
};

export type GeneratedSystem = {
  id: string;
  type: 'system';
  name: string;
  position: { x: number; y: number; z: number };
  stars: GeneratedStarInSystem[];
};

/** Small spread (ly) so stars in a system are visually distinct. */
const SYSTEM_STAR_SPREAD_LY = 0.02;

/** Pick a star type id from system type's starTypeChances (weighted random). */
function pickStarTypeId(rng: () => number, systemType: SystemTypeEntry): string {
  const entries = Object.entries(systemType.starTypeChances).filter(([, pct]) => pct > 0);
  const total = entries.reduce((s, [, pct]) => s + pct, 0);
  let t = rng() * total;
  for (const [id, pct] of entries) {
    t -= pct;
    if (t <= 0) return id;
  }
  return entries[entries.length - 1]?.[0] ?? 'G';
}

/** Given data and system star count, pick a star type and return radius (km) and color. */
function pickStarRadiusAndColor(
  rng: () => number,
  data: GeneratorData,
  numStarsInSystem: number,
): { radiusKm: number; color: string } {
  const systemType = getSystemTypeByStarCount(data, numStarsInSystem);
  const starTypes = data.starTypes;
  const fallback: StarTypeEntry | undefined = starTypes.find((s) => s.id === 'G');
  if (!systemType) {
    const st = fallback ?? starTypes[0];
    const radiusKm = st
      ? (st.diameterKmMin + (st.diameterKmMax - st.diameterKmMin) * rng()) / 2
      : 696_000;
    return { radiusKm, color: st?.color ?? '#fff5d4' };
  }
  const starTypeId = pickStarTypeId(rng, systemType);
  const starType = getStarTypeById(data, starTypeId) ?? fallback ?? starTypes[0];
  if (!starType) {
    return { radiusKm: 696_000, color: '#fff5d4' };
  }
  const radiusKm = (starType.diameterKmMin + (starType.diameterKmMax - starType.diameterKmMin) * rng()) / 2;
  return { radiusKm, color: starType.color };
}

function pickSystemSize(rng: () => number, p: GeneratorParams): number {
  const t = rng() * 100;
  if (t < p.pct1) return 1;
  if (t < p.pct1 + p.pct2) return 2;
  if (t < p.pct1 + p.pct2 + p.pct3) return 3;
  if (t < p.pct1 + p.pct2 + p.pct3 + p.pct4) return 4;
  return 5;
}

export function generateSystems(params: GeneratorParams): GeneratedSystem[] {
  const data = loadGeneratorData();
  const rng = makeRng(params.seed);
  const half = params.diameterLy / 2;
  const systems: GeneratedSystem[] = [];
  const usedSystemNames = new Set<string>();
  const usedStarNames = new Set<string>();

  const centers =
    params.algorithm === 'clustered'
      ? Array.from({ length: params.clusterCount }, () => samplePointInSphere(rng, half))
      : [];

  const trySample = (): { x: number; y: number; z: number } | null => {
    if (params.algorithm === 'uniform') {
      return samplePointInSphere(rng, half);
    }
    if (params.algorithm === 'clustered') {
      const useBackground = rng() < params.backgroundFraction;
      if (useBackground) {
        return samplePointInSphere(rng, half);
      }
      const c = centers[Math.floor(rng() * centers.length)] ?? { x: 0, y: 0, z: 0 };
      const x = c.x + randNormal(rng) * params.clusterSigmaLy;
      const y = c.y + randNormal(rng) * params.clusterSigmaLy;
      const z = c.z + randNormal(rng) * params.clusterSigmaLy;
      if (Math.hypot(x, y, z) > half) return null;
      return { x, y, z };
    }
    const maxR = half;
    const r = sampleExponential(rng, params.diskScaleLengthLy);
    const theta = rng() * Math.PI * 2;
    const x = r * Math.cos(theta);
    const z = r * Math.sin(theta);
    const y = randNormal(rng) * params.diskScaleHeightLy;
    if (Math.abs(x) > half || Math.abs(y) > half || Math.abs(z) > half) return null;
    if (Math.hypot(x, z) > maxR) return null;
    return { x, y, z };
  };

  let attempts = 0;
  const maxAttempts = params.maxSystems * 50;
  while (systems.length < params.maxSystems && attempts < maxAttempts) {
    attempts++;
    const center = trySample();
    if (!center) continue;
    const numStars = pickSystemSize(rng, params);
    const systemName = uniqueSystemName(rng, usedSystemNames);
    const systemId = `system-${systems.length + 1}`;
    const stars: GeneratedStarInSystem[] = [];
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < numStars; i++) {
      const offsetX = (rng() - 0.5) * 2 * SYSTEM_STAR_SPREAD_LY;
      const offsetY = (rng() - 0.5) * 2 * SYSTEM_STAR_SPREAD_LY;
      const offsetZ = (rng() - 0.5) * 2 * SYSTEM_STAR_SPREAD_LY;
      const x = round3(center.x + offsetX);
      const y = round3(center.y + offsetY);
      const z = round3(center.z + offsetZ);
      cx += x; cy += y; cz += z;
      const starName = uniqueStarName(rng, usedStarNames);
      const { radiusKm, color } = pickStarRadiusAndColor(rng, data, numStars);
      stars.push({
        id: `${systemId}-star-${i + 1}`,
        name: starName,
        position: { x, y, z },
        radius: Math.round(radiusKm),
        color,
      });
    }
    cx /= numStars; cy /= numStars; cz /= numStars;
    systems.push({
      id: systemId,
      type: 'system',
      name: systemName,
      position: { x: round3(cx), y: round3(cy), z: round3(cz) },
      stars,
    });
  }

  while (systems.length < params.maxSystems) {
    const pt = samplePointInSphere(rng, half);
    const center = { x: round3(pt.x), y: round3(pt.y), z: round3(pt.z) };
    const numStars = pickSystemSize(rng, params);
    const systemName = uniqueSystemName(rng, usedSystemNames);
    const systemId = `system-${systems.length + 1}`;
    const stars: GeneratedStarInSystem[] = [];
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < numStars; i++) {
      const offsetX = (rng() - 0.5) * 2 * SYSTEM_STAR_SPREAD_LY;
      const offsetY = (rng() - 0.5) * 2 * SYSTEM_STAR_SPREAD_LY;
      const offsetZ = (rng() - 0.5) * 2 * SYSTEM_STAR_SPREAD_LY;
      const x = round3(center.x + offsetX);
      const y = round3(center.y + offsetY);
      const z = round3(center.z + offsetZ);
      cx += x; cy += y; cz += z;
      const starName = uniqueStarName(rng, usedStarNames);
      const { radiusKm, color } = pickStarRadiusAndColor(rng, data, numStars);
      stars.push({
        id: `${systemId}-star-${i + 1}`,
        name: starName,
        position: { x, y, z },
        radius: Math.round(radiusKm),
        color,
      });
    }
    cx /= numStars; cy /= numStars; cz /= numStars;
    systems.push({
      id: systemId,
      type: 'system',
      name: systemName,
      position: { x: round3(cx), y: round3(cy), z: round3(cz) },
      stars,
    });
  }

  return systems;
}

function uniqueSystemName(rng: () => number, used: Set<string>): string {
  for (let i = 0; i < 20; i++) {
    const base = makeName(rng) + ' System';
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
  }
  const fallback = `System-${Math.floor(rng() * 1_000_000)}`;
  used.add(fallback);
  return fallback;
}

function uniqueStarName(rng: () => number, used: Set<string>): string {
  for (let i = 0; i < 20; i++) {
    const base = makeName(rng);
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
  }
  const fallback = `Star-${Math.floor(rng() * 1_000_000)}`;
  used.add(fallback);
  return fallback;
}

function makeName(rng: () => number): string {
  const syll = [
    'al', 'an', 'ar', 'be', 'bel', 'cor', 'da', 'den', 'el', 'en', 'fi', 'gar', 'hal', 'io', 'ka', 'kel',
    'la', 'lin', 'mor', 'nar', 'or', 'pha', 'qua', 'ran', 'sel', 'tan', 'ul', 'vor', 'wen', 'xe', 'yor', 'zen',
  ];
  const parts = 2 + (rng() < 0.45 ? 1 : 0);
  let s = '';
  for (let i = 0; i < parts; i++) s += syll[Math.floor(rng() * syll.length)];
  s = s[0].toUpperCase() + s.slice(1);
  if (rng() < 0.18) s += '-' + String.fromCharCode(65 + Math.floor(rng() * 26));
  return s;
}

function makeRng(seed: string): () => number {
  const h = xfnv1a(seed);
  return mulberry32(h);
}

function xfnv1a(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randRange(rng: () => number, min: number, max: number): number {
  return min + (max - min) * rng();
}

function randNormal(rng: () => number): number {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function sampleExponential(rng: () => number, mean: number): number {
  return -mean * Math.log(Math.max(1e-12, 1 - rng()));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Uniform random point inside a sphere of given radius (centered at origin). */
function samplePointInSphere(rng: () => number, radius: number): { x: number; y: number; z: number } {
  const u = rng();
  const v = rng();
  const w = rng();
  const r = radius * Math.cbrt(u);
  const theta = 2 * Math.PI * v;
  const phi = Math.acos(2 * w - 1);
  return {
    x: r * Math.sin(phi) * Math.cos(theta),
    y: r * Math.cos(phi),
    z: r * Math.sin(phi) * Math.sin(theta),
  };
}
