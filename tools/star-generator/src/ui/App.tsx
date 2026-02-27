import React, { useEffect, useMemo, useState } from 'react';
import { DEFAULT_PARAMS, normalizeParams, type GeneratorMeta, type GeneratorParams, type StarGenerationAlgorithm } from '../lib/schema';

type ApiState = {
  params: GeneratorParams;
  meta: GeneratorMeta | null;
  hasBackup: boolean;
  systemCount?: number;
  objectsCount: number;
};

type ApiPreview = {
  params: GeneratorParams;
  systemCount: number;
  starCount: number;
  sampleNames: string[];
  bounds: { min: [number, number, number]; max: [number, number, number] };
};

type ApiWrite = { ok: true; systemCount: number; starCount: number; wrote: string; backup: string };

export function App(): React.JSX.Element {
  const [loading, setLoading] = useState(true);
  const [params, setParams] = useState<GeneratorParams>(DEFAULT_PARAMS);
  const [stateMeta, setStateMeta] = useState<GeneratorMeta | null>(null);
  const [hasBackup, setHasBackup] = useState(false);
  const [preview, setPreview] = useState<ApiPreview | null>(null);
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState<'preview' | 'write' | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/state');
        const data = (await res.json()) as ApiState;
        if (cancelled) return;
        setParams(normalizeParams(data.params ?? DEFAULT_PARAMS));
        setStateMeta(data.meta ?? null);
        setHasBackup(Boolean(data.hasBackup));
      } catch (e) {
        if (!cancelled) setStatus(`Failed to load state: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const halfExtent = useMemo(() => params.diameterLy / 2, [params.diameterLy]);

  const set = <K extends keyof GeneratorParams>(key: K, value: GeneratorParams[K]) => {
    setParams((p) => normalizeParams({ ...p, [key]: value }));
  };

  const onPreview = async () => {
    setBusy('preview');
    setStatus('');
    try {
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params }),
      });
      const data = (await res.json()) as ApiPreview;
      if (!res.ok) throw new Error((data as any)?.error ?? `HTTP ${res.status}`);
      setPreview(data);
      setStatus(`Preview: ${data.systemCount} systems, ${data.starCount} stars.`);
    } catch (e) {
      setStatus(`Preview failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const onWrite = async () => {
    setBusy('write');
    setStatus('');
    try {
      const res = await fetch('/api/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params }),
      });
      const data = (await res.json()) as ApiWrite | { error?: string };
      if (!res.ok || !(data as ApiWrite).ok) throw new Error((data as any)?.error ?? `HTTP ${res.status}`);
      const ok = data as ApiWrite;
      setHasBackup(true);
      setStateMeta({ tool: 'star-generator', version: 1, generatedAt: new Date().toISOString(), params, systemCount: ok.systemCount, starCount: ok.starCount });
      setPreview(null);
      setStatus(`Wrote ${ok.systemCount} systems (${ok.starCount} stars) to universe_definition.json (backup: universe_definition.json.bak).`);
    } catch (e) {
      setStatus(`Write failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const AlgoFields = () => {
    if (params.algorithm === 'clustered') {
      return (
        <div style={styles.grid}>
          <Field label="Cluster count">
            <input type="number" value={params.clusterCount} min={1} step={1} onChange={(e) => set('clusterCount', Number(e.target.value))} />
          </Field>
          <Field label="Cluster sigma (ly)">
            <input type="number" value={params.clusterSigmaLy} min={0.1} step={0.1} onChange={(e) => set('clusterSigmaLy', Number(e.target.value))} />
          </Field>
          <Field label="Background fraction">
            <input type="number" value={params.backgroundFraction} min={0} max={1} step={0.01} onChange={(e) => set('backgroundFraction', Number(e.target.value))} />
          </Field>
        </div>
      );
    }
    if (params.algorithm === 'disk') {
      return (
        <div style={styles.grid}>
          <Field label="Disk scale length (ly)">
            <input type="number" value={params.diskScaleLengthLy} min={1} step={1} onChange={(e) => set('diskScaleLengthLy', Number(e.target.value))} />
          </Field>
          <Field label="Disk scale height (ly)">
            <input type="number" value={params.diskScaleHeightLy} min={0.1} step={0.1} onChange={(e) => set('diskScaleHeightLy', Number(e.target.value))} />
          </Field>
        </div>
      );
    }
    return null;
  };

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <div style={styles.title}>System Generator</div>
          <div style={styles.subtitle}>
            Generates systems (1–5 stars each) and writes to <code>public/universe_definition.json</code> (one backup{' '}
            <code>universe_definition.json.bak</code>).
          </div>
        </div>
        <div style={styles.badges}>
          <Badge label={hasBackup ? 'Backup: yes' : 'Backup: no'} />
          <Badge label={`Extent: ±${halfExtent.toFixed(0)} ly`} />
        </div>
      </div>

      <div style={styles.panel}>
        {loading ? (
          <div>Loading…</div>
        ) : (
          <>
            <div style={styles.row}>
              <Field label="Seed">
                <input value={params.seed} onChange={(e) => set('seed', e.target.value)} />
              </Field>
              <Field label="Diameter (ly)">
                <input type="number" value={params.diameterLy} min={1} step={1} onChange={(e) => set('diameterLy', Number(e.target.value))} />
              </Field>
              <Field label="Max systems">
                <input type="number" value={params.maxSystems} min={1} step={1} onChange={(e) => set('maxSystems', Number(e.target.value))} />
              </Field>
              <Field label="Algorithm">
                <select value={params.algorithm} onChange={(e) => set('algorithm', e.target.value as StarGenerationAlgorithm)}>
                  <option value="uniform">Uniform (cube)</option>
                  <option value="clustered">Clustered (Gaussian + background)</option>
                  <option value="disk">Disk (exponential radius + thin plane)</option>
                </select>
              </Field>
            </div>

            <div style={styles.pctRow}>
              <Field label="1-star %">
                <input type="number" value={params.pct1} min={0} max={100} step={1} onChange={(e) => set('pct1', Number(e.target.value))} />
              </Field>
              <Field label="2-star %">
                <input type="number" value={params.pct2} min={0} max={100} step={1} onChange={(e) => set('pct2', Number(e.target.value))} />
              </Field>
              <Field label="3-star %">
                <input type="number" value={params.pct3} min={0} max={100} step={1} onChange={(e) => set('pct3', Number(e.target.value))} />
              </Field>
              <Field label="4-star %">
                <input type="number" value={params.pct4} min={0} max={100} step={1} onChange={(e) => set('pct4', Number(e.target.value))} />
              </Field>
              <Field label="5-star %">
                <input type="number" value={params.pct5} min={0} max={100} step={1} onChange={(e) => set('pct5', Number(e.target.value))} />
              </Field>
              <div style={styles.pctTotal}>
                Total: {params.pct1 + params.pct2 + params.pct3 + params.pct4 + params.pct5}%
              </div>
            </div>

            <AlgoFields />

            <div style={styles.actions}>
              <button onClick={onPreview} disabled={busy != null}>
                {busy === 'preview' ? 'Previewing…' : 'Preview'}
              </button>
              <button onClick={onWrite} disabled={busy != null} style={styles.primaryBtn}>
                {busy === 'write' ? 'Writing…' : 'Generate & write universe_definition.json'}
              </button>
            </div>

            {status && <div style={styles.status}>{status}</div>}

            {stateMeta && (
              <div style={styles.meta}>
                Last saved params in <code>universe_definition.json</code>:{' '}
                {stateMeta.generatedAt ? new Date(stateMeta.generatedAt).toLocaleString() : 'unknown'}
                {' · '}systems: {stateMeta.systemCount ?? 0}, stars: {stateMeta.starCount ?? 0}
              </div>
            )}

            {preview && (
              <div style={styles.preview}>
                <div style={styles.previewTitle}>Preview</div>
                <div style={styles.previewRow}>
                  <div>
                    <div style={styles.muted}>Systems</div>
                    <div>{preview.systemCount}</div>
                  </div>
                  <div>
                    <div style={styles.muted}>Stars</div>
                    <div>{preview.starCount}</div>
                  </div>
                  <div>
                    <div style={styles.muted}>Bounds (min)</div>
                    <div>{fmt3(preview.bounds.min)}</div>
                  </div>
                  <div>
                    <div style={styles.muted}>Bounds (max)</div>
                    <div>{fmt3(preview.bounds.max)}</div>
                  </div>
                </div>
                <div style={{ marginTop: 10 }}>
                  <div style={styles.muted}>Sample system names</div>
                  <div style={styles.nameWrap}>
                    {preview.sampleNames.map((n) => (
                      <span key={n} style={styles.namePill}>
                        {n}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div style={styles.footer}>
        Tip: start with <b>Clustered</b> for non-uniform density, then tune sigma/background. Disk gives a more “galaxy plane” feel.
      </div>
    </div>
  );
}

function Field(props: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <label style={styles.field}>
      <div style={styles.label}>{props.label}</div>
      {props.children}
    </label>
  );
}

function Badge(props: { label: string }): React.JSX.Element {
  return <div style={styles.badge}>{props.label}</div>;
}

function fmt3(v: [number, number, number]): string {
  return `(${v[0].toFixed(1)}, ${v[1].toFixed(1)}, ${v[2].toFixed(1)})`;
}

const styles: Record<string, React.CSSProperties> = {
  page: { height: '100%', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  title: { fontSize: 20, fontWeight: 700 },
  subtitle: { color: 'var(--muted)', maxWidth: 760, marginTop: 4, lineHeight: 1.3 },
  badges: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' },
  badge: { border: '1px solid var(--border)', borderRadius: 999, padding: '6px 10px', background: 'rgba(0,0,0,0.25)', color: 'var(--muted)' },
  panel: { border: '1px solid var(--border)', background: 'var(--panel)', borderRadius: 12, padding: 14 },
  row: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 2fr', gap: 10 },
  pctRow: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr auto', gap: 10, alignItems: 'end' },
  pctTotal: { color: 'var(--muted)', fontSize: 12, marginBottom: 2 },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 12 },
  actions: { display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' },
  primaryBtn: { background: 'rgba(80,167,255,0.25)', border: '1px solid rgba(80,167,255,0.45)' },
  status: { marginTop: 10, color: 'var(--muted)' },
  meta: { marginTop: 10, color: 'var(--muted)' },
  preview: { marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 },
  previewTitle: { fontWeight: 700, marginBottom: 8 },
  previewRow: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 },
  muted: { color: 'var(--muted)', fontSize: 12 },
  nameWrap: { display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 },
  namePill: { border: '1px solid var(--border)', borderRadius: 999, padding: '3px 8px', color: 'var(--text)', background: 'rgba(0,0,0,0.2)' },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { color: 'var(--muted)', fontSize: 12 },
  footer: { color: 'var(--muted)', fontSize: 12, marginTop: 'auto' },
};

