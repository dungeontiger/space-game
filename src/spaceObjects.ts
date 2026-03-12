/** Approximate km per light year (for radius conversion). Coordinates are in ly, radius is in km. */
export const KM_PER_LY = 9.46073e12;

export interface StarInSystem {
  id: string;
  name: string;
  position: { x: number; y: number; z: number };
  radius?: number;
  color?: string;
}

export interface System {
  id: string;
  type: 'system';
  name: string;
  /** Centroid of stars (or primary); used for focus/extent. */
  position: { x: number; y: number; z: number };
  stars: StarInSystem[];
}

export interface MetaEntry {
  id: string;
  type: 'meta';
  position: { x: number; y: number; z: number };
  name?: string;
  generator?: unknown;
}

export type UniverseEntry = System | MetaEntry;

function isSystem(e: UniverseEntry): e is System {
  return e.type === 'system' && Array.isArray((e as System).stars);
}

function isMeta(e: UniverseEntry): e is MetaEntry {
  return e.type === 'meta';
}

/** All systems (excludes meta). */
export function getSystems(entries: UniverseEntry[]): System[] {
  return entries.filter(isSystem) as System[];
}

const OBJECTS_URL = '/universe_definition.json';

/** Legacy flat star entry (old format). */
interface LegacyStar {
  id: string;
  type: string;
  position: { x: number; y: number; z: number };
  radius?: number;
  color?: string;
  name?: string;
}

export async function loadUniverse(): Promise<UniverseEntry[]> {
  const res = await fetch(OBJECTS_URL);
  if (!res.ok) throw new Error(`Failed to load ${OBJECTS_URL}: ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('universe_definition.json must be an array');
  const raw = data as (UniverseEntry | LegacyStar)[];
  const out: UniverseEntry[] = [];
  for (const e of raw) {
    if (e.type === 'meta') {
      out.push(e as MetaEntry);
      continue;
    }
    if (e.type === 'system' && 'stars' in e && Array.isArray((e as System).stars)) {
      out.push(e as System);
      continue;
    }
    if (e.type === 'star') {
      const s = e as LegacyStar;
      out.push({
        id: s.id,
        type: 'system',
        name: s.name ?? s.id,
        position: { ...s.position },
        stars: [{ id: s.id + '-star-1', name: s.name ?? s.id, position: { ...s.position }, radius: s.radius, color: s.color }],
      } as System);
    }
  }
  return out;
}
