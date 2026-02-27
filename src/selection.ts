import * as THREE from 'three';
import type { System } from './spaceObjects.js';

const _worldPos = new THREE.Vector3();

export function formatDistance(ly: number): string {
  if (ly === 0) return '0 ly';
  const abs = Math.abs(ly);
  if (abs >= 1000 || (abs < 0.01 && abs > 0)) {
    const s = ly.toExponential(1);
    return s.replace(/(\.\d)e/, '$1e') + ' ly';
  }
  if (abs >= 1) return ly.toFixed(1) + ' ly';
  return ly.toPrecision(2) + ' ly';
}

/** System centroid from stored star positions (world space; group is at origin). */
export function getObjectWorldPosition(scene: THREE.Scene, id: string): THREE.Vector3 | null {
  const found = findSceneObjectBySpaceId(scene, id);
  if (!found) return null;
  const ud = (found.userData as { starPositions?: { x: number; y: number; z: number }[] })?.starPositions;
  if (ud && ud.length > 0) {
    _worldPos.set(0, 0, 0);
    for (const p of ud) {
      _worldPos.x += p.x;
      _worldPos.y += p.y;
      _worldPos.z += p.z;
    }
    _worldPos.divideScalar(ud.length);
    return _worldPos.clone();
  }
  found.getWorldPosition(_worldPos);
  return _worldPos.clone();
}

const nameTextureCache = new Map<string, THREE.CanvasTexture>();

const LABEL_PT = 12;
const LABEL_PIXEL_HEIGHT = LABEL_PT * (96 / 72);
const SELECTION_CIRCLE_PIXEL_WIDTH = 2;
const SELECTION_PADDING_PX = 2;
const STAR_SELECTION_PADDING_PX = 4;
const LABEL_GAP_PX = 4;

function findSceneObjectBySpaceId(scene: THREE.Scene, id: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  scene.traverse((obj) => {
    const ud = (obj as THREE.Object3D & { userData?: { spaceId?: string; isSelectionMarker?: boolean } }).userData;
    if (ud?.isSelectionMarker) return;
    if (ud?.spaceId === id) found = obj as THREE.Object3D;
  });
  return found;
}

function isStarObject(found: THREE.Object3D | null): boolean {
  if (!found) return false;
  const hasRadiusKm = (o: THREE.Object3D | null | undefined) => (o?.userData as { radiusKm?: number } | undefined)?.radiusKm != null;
  if (hasRadiusKm(found) || hasRadiusKm(found.parent)) return true;
  if (found instanceof THREE.Group) return found.children.some((c) => hasRadiusKm(c));
  return false;
}

/** Pixel radius of system's enclosing sphere (centroid to farthest star). */
function getObjectPixelRadius(
  scene: THREE.Scene,
  id: string,
  camera: THREE.PerspectiveCamera,
  viewportHeight: number,
): number {
  const tanHalfFov = Math.tan((camera.fov * Math.PI) / 180 * 0.5);
  const found = findSceneObjectBySpaceId(scene, id);
  if (!found) return 12;
  const ud = (found.userData as { starPositions?: { x: number; y: number; z: number }[] })?.starPositions;
  if (!ud || ud.length === 0) return 12;
  _worldPos.set(0, 0, 0);
  for (const p of ud) {
    _worldPos.x += p.x;
    _worldPos.y += p.y;
    _worldPos.z += p.z;
  }
  _worldPos.divideScalar(ud.length);
  const distance = Math.max(0.1, camera.position.distanceTo(_worldPos));
  let maxWorldR = 0;
  for (const p of ud) {
    const d = Math.hypot(p.x - _worldPos.x, p.y - _worldPos.y, p.z - _worldPos.z);
    if (d > maxWorldR) maxWorldR = d;
  }
  const worldRadiusToPixels = (r: number) => (r * viewportHeight) / (2 * distance * tanHalfFov);
  return worldRadiusToPixels(maxWorldR);
}

function makeNameTexture(name: string): THREE.CanvasTexture {
  let tex = nameTextureCache.get(name);
  if (tex) return tex;
  const w = 128;
  const h = 24;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, w, h);
  ctx.font = `${LABEL_PT}pt system-ui, sans-serif`;
  ctx.fillStyle = '#e0e8f8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, w / 2, h / 2);
  tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  nameTextureCache.set(name, tex);
  return tex;
}

export function updateSelectionVisuals(
  selectionGroup: THREE.Group,
  selectedIds: Set<string>,
  scene: THREE.Scene,
  systems: System[],
  camera: THREE.PerspectiveCamera,
  viewportHeight: number,
): void {
  while (selectionGroup.children.length) selectionGroup.remove(selectionGroup.children[0]);

  const systemById = new Map(systems.map((s) => [s.id, s]));

  for (const id of selectedIds) {
    const pos = getObjectWorldPosition(scene, id);
    if (!pos) continue;
    const system = systemById.get(id);
    const name = system?.name ?? id;

    const markerGroup = new THREE.Group();
    markerGroup.position.copy(pos);
    markerGroup.userData.isSelectionMarker = true;
    (markerGroup.userData as { targetSpaceId?: string }).targetSpaceId = id;

    const ringGeom = new THREE.RingGeometry(0.9, 1, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00ccff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
    });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    markerGroup.add(ring);

    const nameSpriteMat = new THREE.SpriteMaterial({
      map: makeNameTexture(name),
      transparent: true,
      depthTest: false,
    });
    const nameSprite = new THREE.Sprite(nameSpriteMat);
    nameSprite.scale.set(0.55, 0.55, 1);
    markerGroup.add(nameSprite);

    selectionGroup.add(markerGroup);
  }

  const selectedArray = Array.from(selectedIds);
  for (let i = 0; i < selectedArray.length; i++) {
    for (let j = i + 1; j < selectedArray.length; j++) {
      const posA = getObjectWorldPosition(scene, selectedArray[i]);
      const posB = getObjectWorldPosition(scene, selectedArray[j]);
      if (!posA || !posB) continue;
      const distance = posA.distanceTo(posB);

      const lineGeom = new THREE.BufferGeometry().setFromPoints([posA, posB]);
      const line = new THREE.Line(lineGeom, new THREE.LineBasicMaterial({ color: 0x00ccff, transparent: true, opacity: 0.8 }));
      selectionGroup.add(line);

      const mid = new THREE.Vector3().addVectors(posA, posB).multiplyScalar(0.5);
      const distLabelGroup = new THREE.Group();
      distLabelGroup.position.copy(mid);
      const distLabelGeom = new THREE.PlaneGeometry(1, 1);
      const distLabelTex = makeNameTexture(formatDistance(distance));
      const distLabelMat = new THREE.MeshBasicMaterial({
        map: distLabelTex,
        transparent: true,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      const distLabelMesh = new THREE.Mesh(distLabelGeom, distLabelMat);
      const distToMid = camera.position.distanceTo(mid);
      const tanHalfFov = Math.tan((camera.fov * Math.PI) / 180 * 0.5);
      const scaleY = (LABEL_PIXEL_HEIGHT * distToMid * 2 * tanHalfFov) / viewportHeight;
      distLabelMesh.scale.set(scaleY * 5, scaleY, 1);
      distLabelGroup.add(distLabelMesh);
      selectionGroup.add(distLabelGroup);
    }
  }
}

export function updateSelectionMarkerRotation(
  selectionGroup: THREE.Group,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  viewportHeight: number,
): void {
  const tanHalfFov = Math.tan((camera.fov * Math.PI) / 180 * 0.5);
  selectionGroup.children.forEach((child) => {
    if (!(child instanceof THREE.Group)) return;
    const g = child as THREE.Group & { userData: { isSelectionMarker?: boolean; targetSpaceId?: string } };
    if (g.userData?.isSelectionMarker && g.userData?.targetSpaceId) {
      const id = g.userData.targetSpaceId;
      const dist = Math.max(0.1, camera.position.distanceTo(g.position));
      const objectRadiusPx = getObjectPixelRadius(scene, id, camera, viewportHeight);
      const found = findSceneObjectBySpaceId(scene, id);
      const paddingPx = isStarObject(found) ? STAR_SELECTION_PADDING_PX : SELECTION_PADDING_PX;
      const selectionRadiusPx = objectRadiusPx + paddingPx;
      const scale = (selectionRadiusPx * dist * 2 * tanHalfFov) / viewportHeight;
      g.scale.set(scale, scale, scale);
      g.lookAt(camera.position);
      const ring = g.children[0];
      if (ring instanceof THREE.Mesh && ring.geometry instanceof THREE.RingGeometry) {
        ring.geometry.dispose();
        const inner = Math.max(0.01, 1 - SELECTION_CIRCLE_PIXEL_WIDTH / selectionRadiusPx);
        ring.geometry = new THREE.RingGeometry(inner, 1, 32);
        const mat = ring.material;
        if (mat instanceof THREE.MeshBasicMaterial) mat.opacity = 0.95;
      }
      const sprite = g.children[1];
      if (sprite instanceof THREE.Sprite) {
        const labelOffsetUnits = 1 + (LABEL_GAP_PX + LABEL_PIXEL_HEIGHT * 0.5) / selectionRadiusPx;
        sprite.position.y = -labelOffsetUnits;
      }
      const scaleForLabel = (LABEL_PIXEL_HEIGHT * dist * 2 * tanHalfFov) / viewportHeight;
      if (g.children[1] instanceof THREE.Sprite) {
        g.children[1].scale.set(scaleForLabel * 5 / scale, scaleForLabel / scale, 1);
      }
    } else if (g.children.some((c) => c instanceof THREE.Mesh)) {
      g.lookAt(camera.position);
    }
  });
}

export function updateSelectionLabelSizes(
  selectionGroup: THREE.Group,
  camera: THREE.PerspectiveCamera,
  viewportHeight: number,
): void {
  const tanHalfFov = Math.tan((camera.fov * Math.PI) / 180 * 0.5);
  selectionGroup.traverse((node) => {
    if (node instanceof THREE.Mesh && node.parent && node.parent instanceof THREE.Group) {
      const parent = node.parent as THREE.Group & { userData: { isSelectionMarker?: boolean } };
      if (parent.userData?.isSelectionMarker) return;
      const dist = parent.getWorldPosition(new THREE.Vector3()).distanceTo(camera.position);
      const scaleY = (LABEL_PIXEL_HEIGHT * dist * 2 * tanHalfFov) / viewportHeight;
      node.scale.set(scaleY * 5, scaleY, 1);
    }
  });
}
