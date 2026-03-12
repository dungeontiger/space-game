import * as THREE from 'three';
import { KM_PER_LY, type System } from './spaceObjects.js';
import starSystem1 from './assets/star-system-minimal-1.svg';
import starSystem2 from './assets/star-system-minimal-2.svg';
import starSystem3 from './assets/star-system-minimal-3.svg';
import starSystem4 from './assets/star-system-minimal-4.svg';
import starSystem5 from './assets/star-system-minimal-5.svg';

const objectMap = new Map<string, THREE.Object3D>();

const STAR_MAX_PIXEL_DIAMETER = 100;
const STAR_VISUAL_EXAGGERATION = 7e5;

const SYSTEM_ICON_PIXEL_SIZE = 10;

const systemIconTextures = new Map<number, THREE.Texture>();
const textureLoader = new THREE.TextureLoader();

const systemIconUrls: Record<number, string> = {
  1: starSystem1,
  2: starSystem2,
  3: starSystem3,
  4: starSystem4,
  5: starSystem5,
};

function getSystemIconTexture(starCount: number): THREE.Texture {
  const clamped = THREE.MathUtils.clamp(Math.round(starCount) || 1, 1, 5);
  const cached = systemIconTextures.get(clamped);
  if (cached) return cached;
  const url = systemIconUrls[clamped] ?? systemIconUrls[1];
  const tex = textureLoader.load(url);
  // Ensure correct color space where supported (Three r152+).
  if ('colorSpace' in tex) {
    (tex as THREE.Texture & { colorSpace?: THREE.ColorSpace }).colorSpace = THREE.SRGBColorSpace;
  }
  systemIconTextures.set(clamped, tex);
  return tex;
}

function buildSystem(system: System): THREE.Group {
  const group = new THREE.Group();
  group.position.set(system.position.x, system.position.y, system.position.z);

  const starCount = system.stars.length || 1;
  const iconTex = getSystemIconTexture(starCount);
  const spriteMat = new THREE.SpriteMaterial({
    map: iconTex,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.userData = { spaceId: system.id, systemStarCount: starCount };
  group.add(sprite);

  // Store a single position so selection helpers can find the centroid.
  const starPositions = [{ x: system.position.x, y: system.position.y, z: system.position.z }];
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
): void {
  const tanHalfFov = Math.tan((camera.fov * Math.PI) / 180 * 0.5);
  scene.traverseVisible((obj) => {
    if (!(obj instanceof THREE.Sprite)) return;
    const ud = obj.userData as { spaceId?: string };
    if (!ud.spaceId) return;
    obj.getWorldPosition(_starPos);
    const distance = Math.max(0.001, camera.position.distanceTo(_starPos));
    const desiredPx = SYSTEM_ICON_PIXEL_SIZE;
    const worldSize = (desiredPx * 2 * distance * tanHalfFov) / viewportHeight;
    obj.scale.set(worldSize, worldSize, 1);
  });
}
