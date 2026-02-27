export type StarGenerationAlgorithm = 'uniform' | 'clustered' | 'disk';

export type GeneratorParams = {
  seed: string;
  diameterLy: number;
  /** Max number of systems to generate. */
  maxSystems: number;
  algorithm: StarGenerationAlgorithm;

  /** Percentage chance for system to have 1, 2, 3, 4, 5 stars. Must total 100. */
  pct1: number;
  pct2: number;
  pct3: number;
  pct4: number;
  pct5: number;

  clusterCount: number;
  clusterSigmaLy: number;
  backgroundFraction: number;
  diskScaleLengthLy: number;
  diskScaleHeightLy: number;
};

export const DEFAULT_PARAMS: GeneratorParams = {
  seed: 'space-game',
  diameterLy: 300,
  maxSystems: 200,
  algorithm: 'clustered',
  pct1: 60,
  pct2: 30,
  pct3: 5,
  pct4: 4,
  pct5: 1,
  clusterCount: 6,
  clusterSigmaLy: 18,
  backgroundFraction: 0.25,
  diskScaleLengthLy: 120,
  diskScaleHeightLy: 20,
};

export function normalizeParams(input: Partial<GeneratorParams>): GeneratorParams {
  const p: GeneratorParams = { ...DEFAULT_PARAMS, ...input } as GeneratorParams;
  p.seed = String(p.seed ?? DEFAULT_PARAMS.seed);
  p.diameterLy = clampNumber(p.diameterLy, 1, 10000, DEFAULT_PARAMS.diameterLy);
  p.maxSystems = clampInt(p.maxSystems, 1, 50000, DEFAULT_PARAMS.maxSystems);
  p.algorithm = (['uniform', 'clustered', 'disk'] as const).includes(p.algorithm) ? p.algorithm : DEFAULT_PARAMS.algorithm;
  const pcts = [clampNumber(p.pct1, 0, 100, 60), clampNumber(p.pct2, 0, 100, 30), clampNumber(p.pct3, 0, 100, 5), clampNumber(p.pct4, 0, 100, 4), clampNumber(p.pct5, 0, 100, 1)];
  const sum = pcts.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    p.pct1 = 60; p.pct2 = 30; p.pct3 = 5; p.pct4 = 4; p.pct5 = 1;
  } else {
    const scale = 100 / sum;
    p.pct1 = Math.round(pcts[0] * scale); p.pct2 = Math.round(pcts[1] * scale); p.pct3 = Math.round(pcts[2] * scale);
    p.pct4 = Math.round(pcts[3] * scale); p.pct5 = Math.round(pcts[4] * scale);
    const diff = 100 - (p.pct1 + p.pct2 + p.pct3 + p.pct4 + p.pct5);
    if (diff !== 0) p.pct1 = Math.max(0, p.pct1 + diff);
  }
  p.clusterCount = clampInt(p.clusterCount, 1, 200, DEFAULT_PARAMS.clusterCount);
  p.clusterSigmaLy = clampNumber(p.clusterSigmaLy, 0.1, p.diameterLy, DEFAULT_PARAMS.clusterSigmaLy);
  p.backgroundFraction = clampNumber(p.backgroundFraction, 0, 1, DEFAULT_PARAMS.backgroundFraction);
  p.diskScaleLengthLy = clampNumber(p.diskScaleLengthLy, 1, p.diameterLy, DEFAULT_PARAMS.diskScaleLengthLy);
  p.diskScaleHeightLy = clampNumber(p.diskScaleHeightLy, 0.1, p.diameterLy, DEFAULT_PARAMS.diskScaleHeightLy);
  return p;
}

function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = clampNumber(v, min, max, fallback);
  return Math.round(n);
}

export type GeneratorMeta = {
  tool: 'star-generator';
  version: 1;
  generatedAt: string;
  params: GeneratorParams;
  systemCount: number;
  starCount: number;
};
