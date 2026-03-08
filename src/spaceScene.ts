import * as THREE from 'three';
import { KM_PER_LY, type System, type StarInSystem } from './spaceObjects.js';

const objectMap = new Map<string, THREE.Object3D>();

function parseColor(hex: string | undefined): number {
  if (!hex) return 0xffffff;
  return new THREE.Color(hex).getHex();
}

const STAR_MIN_PIXEL_DIAMETER = 4;
const STAR_MAX_PIXEL_DIAMETER = 100;
const STAR_VISUAL_EXAGGERATION = 7e5;
const STAR_BASE_RADIUS = 1;
const AVG_STAR_RADIUS_KM = 696_000;
/** Radius (ly) of the circle on which stars in a system are arranged. */
const SYSTEM_STAR_CIRCLE_RADIUS_LY = 0.06;

export type SystemColorMode = 'default' | 'starCount';

function colorForStarCount(count: number): THREE.Color {
  const t = THREE.MathUtils.clamp((count - 1) / 4, 0, 1);
  return new THREE.Color(1, 1 - t, 1 - t); // white -> red
}

function buildStarMesh(star: StarInSystem, systemId: string, systemStarCount: number): THREE.Mesh {
  const radiusKm = star.radius ?? AVG_STAR_RADIUS_KM;
  const sphereGeom = new THREE.SphereGeometry(STAR_BASE_RADIUS, 24, 16);
  const sphereColor = parseColor(star.color);
  const sphereMat = new THREE.MeshStandardMaterial({
    color: sphereColor,
    metalness: 0,
    roughness: 0.25,
    emissive: sphereColor,
    emissiveIntensity: 0.35,
  });
  const mesh = new THREE.Mesh(sphereGeom, sphereMat);
  mesh.userData = { spaceId: systemId, radiusKm, baseColor: sphereColor, systemStarCount };
  return mesh;
}

function buildSystem(system: System): THREE.Group {
  const group = new THREE.Group();
  group.position.set(system.position.x, system.position.y, system.position.z);
  const n = system.stars.length;
  const r = SYSTEM_STAR_CIRCLE_RADIUS_LY;
  const cx = system.position.x;
  const cy = system.position.y;
  const cz = system.position.z;
  const starPositions: { x: number; y: number; z: number }[] = [];

  for (let i = 0; i < n; i++) {
    const angle = n === 1 ? 0 : (2 * Math.PI * i) / n;
    const lx = n === 1 ? 0 : r * Math.cos(angle);
    const lz = n === 1 ? 0 : r * Math.sin(angle);
    starPositions.push({ x: cx + lx, y: cy, z: cz + lz });
    const mesh = buildStarMesh(system.stars[i], system.id, n);
    mesh.position.set(lx, 0, lz);
    group.add(mesh);
  }

  group.userData = { spaceId: system.id, starPositions };
  return group;
}

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    if (child instanceof THREE.Points && child.geometry) child.geometry.dispose();
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (child.material instanceof THREE.Material) child.material.dispose();
    }
  });
}

function addOrUpdateSystem(scene: THREE.Scene, system: System): void {
  const existing = objectMap.get(system.id);
  if (existing) {
    scene.remove(existing);
    disposeObject(existing);
    objectMap.delete(system.id);
  }
  const threeObj = buildSystem(system);
  scene.add(threeObj);
  objectMap.set(system.id, threeObj);
}

function removeStaleSystems(scene: THREE.Scene, ids: Set<string>): void {
  for (const [id, threeObj] of objectMap.entries()) {
    if (!ids.has(id)) {
      scene.remove(threeObj);
      disposeObject(threeObj);
      objectMap.delete(id);
    }
  }
}

export function updateSpaceScene(scene: THREE.Scene, systems: System[]): void {
  const ids = new Set(systems.map((s) => s.id));
  for (const system of systems) {
    addOrUpdateSystem(scene, system);
  }
  removeStaleSystems(scene, ids);
}

const _starPos = new THREE.Vector3();

export function getStarDistanceForMaxSizePx(
  radiusKm: number,
  camera: THREE.PerspectiveCamera,
  viewportHeight: number,
): number {
  const tanHalfFov = Math.tan((camera.fov * Math.PI) / 180 * 0.5);
  const radiusLy = radiusKm / KM_PER_LY;
  const diameterLy = radiusLy * 2;
  const dist = (diameterLy * viewportHeight * STAR_VISUAL_EXAGGERATION) / (2 * STAR_MAX_PIXEL_DIAMETER * tanHalfFov);
  return Math.max(0.2, dist);
}

export function updateStarApparentSizes(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  viewportHeight: number,
  colorMode: SystemColorMode,
): void {
  const tanHalfFov = Math.tan((camera.fov * Math.PI) / 180 * 0.5);
  scene.traverseVisible((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const radiusKm = (obj.userData as { radiusKm?: number }).radiusKm ?? (obj.parent?.userData as { radiusKm?: number } | undefined)?.radiusKm;
    if (radiusKm == null) return;
    obj.getWorldPosition(_starPos);
    const distance = Math.max(0.001, camera.position.distanceTo(_starPos));

    const radiusLy = radiusKm / KM_PER_LY;
    const diameterLy = radiusLy * 2;
    const physicalDiameterPx = (diameterLy * viewportHeight) / (2 * distance * tanHalfFov);

    const boostedDiameterPx = physicalDiameterPx * STAR_VISUAL_EXAGGERATION;
    const clampedDiameterPx = Math.min(STAR_MAX_PIXEL_DIAMETER, Math.max(STAR_MIN_PIXEL_DIAMETER, boostedDiameterPx));
    const desiredDiameterWorld = (clampedDiameterPx * 2 * distance * tanHalfFov) / viewportHeight;
    const desiredRadiusWorld = desiredDiameterWorld * 0.5;

    const s = desiredRadiusWorld / STAR_BASE_RADIUS;
    obj.scale.setScalar(s);

    const mat = obj.material;
    if (!(mat instanceof THREE.MeshStandardMaterial)) return;
    const baseColor = (obj.userData as { baseColor?: number }).baseColor ?? 0xffffff;
    if (colorMode === 'default') {
      mat.color.setHex(baseColor);
      mat.emissive.setHex(baseColor);
      return;
    }
    const count = (obj.userData as { systemStarCount?: number }).systemStarCount ?? 1;
    const c = colorForStarCount(count);
    mat.color.copy(c);
    mat.emissive.copy(c);
  });
}
