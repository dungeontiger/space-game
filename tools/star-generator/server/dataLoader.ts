import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

export type StarTypeEntry = {
  id: string;
  spectralClass: string;
  name: string;
  diameterKmMin: number;
  diameterKmMax: number;
  massSolarMin: number;
  massSolarMax: number;
  color: string;
};

export type SystemTypeEntry = {
  starCount: number;
  description?: string;
  /** Percentage chance per star type id; should sum to 100. */
  starTypeChances: Record<string, number>;
};

export type GeneratorData = {
  starTypes: StarTypeEntry[];
  systemTypes: SystemTypeEntry[];
};

let cached: GeneratorData | null = null;

export function loadGeneratorData(): GeneratorData {
  if (cached) return cached;
  const starTypesPath = path.join(DATA_DIR, 'star-types.json');
  const systemTypesPath = path.join(DATA_DIR, 'system-types.json');
  const starTypes: StarTypeEntry[] = JSON.parse(fs.readFileSync(starTypesPath, 'utf-8'));
  const systemTypes: SystemTypeEntry[] = JSON.parse(fs.readFileSync(systemTypesPath, 'utf-8'));
  cached = { starTypes, systemTypes };
  return cached;
}

export function getStarTypeById(data: GeneratorData, id: string): StarTypeEntry | undefined {
  return data.starTypes.find((s) => s.id === id);
}

export function getSystemTypeByStarCount(data: GeneratorData, starCount: number): SystemTypeEntry | undefined {
  return data.systemTypes.find((s) => s.starCount === starCount);
}
