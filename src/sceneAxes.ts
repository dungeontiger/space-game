import * as THREE from 'three';
import { KM_PER_LY, type System } from './spaceObjects.js';

const STAR_RADIUS_KM = 696000;

/** Radius (ly) of sphere centered at origin that encloses all systems (all star positions), plus 10%. */
export function getSceneExtentRadius(systems: System[]): number {
  let maxDist = 1;
  for (const sys of systems) {
    for (const star of sys.stars) {
      const r = (star.radius ?? STAR_RADIUS_KM) / KM_PER_LY;
      const p = star.position;
      const distFromOrigin = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      maxDist = Math.max(maxDist, distFromOrigin + r);
    }
  }
  return maxDist * 1.1;
}

const labelTextureCache = new Map<string, THREE.CanvasTexture>();

const LABEL_GRAY = '#aaaaaa';

function makeLabelTexture(text: string): THREE.CanvasTexture {
  const key = `label_${text}`;
  let tex = labelTextureCache.get(key);
  if (tex) return tex;
  const w = 56;
  const h = 20;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, w, h);
  ctx.font = '12pt system-ui, sans-serif';
  ctx.fillStyle = LABEL_GRAY;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);
  tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  labelTextureCache.set(key, tex);
  return tex;
}

function tickIntervalForRange(R: number): number {
  if (R <= 5) return 1;
  if (R <= 20) return 2;
  if (R <= 50) return 5;
  if (R <= 200) return 10;
  return Math.pow(10, Math.floor(Math.log10(R)));
}

export type AxesAndSphere = {
  axesGroup: THREE.Group;
  sphereMesh: THREE.Group;
};

export function createAxesAndSphere(systems: System[]): AxesAndSphere {
  const R = getSceneExtentRadius(systems);
  const axesGroup = new THREE.Group();
  const tickLen = R * 0.02;
  const step = tickIntervalForRange(R);
  const labelOffset = R * 0.04;

  const gray = '#888888';

  function addAxis(axis: 'x' | 'y' | 'z'): void {
    const a = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const lineGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(a === 0 ? -R : 0, a === 1 ? -R : 0, a === 2 ? -R : 0),
      new THREE.Vector3(a === 0 ? R : 0, a === 1 ? R : 0, a === 2 ? R : 0),
    ]);
    const line = new THREE.Line(
      lineGeom,
      new THREE.LineBasicMaterial({ color: gray, transparent: true, opacity: 0.5 }),
    );
    axesGroup.add(line);

    const tickPoints: number[] = [];
    const labelPositions: { value: number; pos: [number, number, number] }[] = [];

    for (let v = -R; v <= R + 1e-6; v += step) {
      const t = Math.round(v / step) * step;
      if (Math.abs(t) > R) continue;
      if (a === 0) {
        tickPoints.push(t, -tickLen, 0, t, tickLen, 0);
        labelPositions.push({ value: t, pos: [t, labelOffset, 0] });
      } else if (a === 1) {
        tickPoints.push(-tickLen, t, 0, tickLen, t, 0);
        labelPositions.push({ value: t, pos: [labelOffset, t, 0] });
      } else {
        tickPoints.push(0, -tickLen, t, 0, tickLen, t);
        labelPositions.push({ value: t, pos: [0, labelOffset, t] });
      }
    }
    if (tickPoints.length > 0) {
      const tickGeom = new THREE.BufferGeometry();
      tickGeom.setAttribute('position', new THREE.Float32BufferAttribute(tickPoints, 3));
      const tickLine = new THREE.LineSegments(
        tickGeom,
        new THREE.LineBasicMaterial({ color: gray, transparent: true, opacity: 0.5 }),
      );
      axesGroup.add(tickLine);
    }

    for (const { value, pos } of labelPositions) {
      const spriteMat = new THREE.SpriteMaterial({
        map: makeLabelTexture(String(value)),
        transparent: true,
        opacity: 0.5,
        depthTest: false,
      });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.set(pos[0], pos[1], pos[2]);
      sprite.scale.set(1, 1, 1);
      axesGroup.add(sprite);
    }
  }

  addAxis('x');
  addAxis('y');
  addAxis('z');

  const sphereGeom = new THREE.SphereGeometry(R, 16, 12);
  const sphereMat = new THREE.MeshStandardMaterial({
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    side: THREE.DoubleSide,
    color: 0x888888,
    metalness: 0,
    roughness: 0.9,
  });
  const sphereFill = new THREE.Mesh(sphereGeom, sphereMat);
  const wireframeGeom = new THREE.WireframeGeometry(sphereGeom.clone());
  const wireframeMat = new THREE.LineBasicMaterial({
    color: 0x888888,
    transparent: true,
    opacity: 0.25,
    depthTest: true,
  });
  const sphereWireframe = new THREE.LineSegments(wireframeGeom, wireframeMat);
  const sphereMesh = new THREE.Group();
  sphereMesh.add(sphereFill);
  sphereMesh.add(sphereWireframe);

  return { axesGroup, sphereMesh };
}

/** 12pt in pixels at 96 dpi */
const LABEL_PIXEL_HEIGHT = 12 * (96 / 72);

const _worldPos = new THREE.Vector3();

/** Call each frame when axes are visible so labels stay 10pt on screen. */
export function updateAxisLabelSizes(
  axesGroup: THREE.Group,
  camera: THREE.PerspectiveCamera,
  viewportHeight: number,
): void {
  const tanHalfFov = Math.tan((camera.fov * Math.PI) / 180 * 0.5);
  axesGroup.traverse((obj) => {
    if (!(obj instanceof THREE.Sprite)) return;
    obj.getWorldPosition(_worldPos);
    const distance = Math.max(0.1, camera.position.distanceTo(_worldPos));
    const scaleY = (LABEL_PIXEL_HEIGHT * distance * 2 * tanHalfFov) / viewportHeight;
    const scaleX = scaleY * 2;
    obj.scale.set(scaleX, scaleY, 1);
  });
}
