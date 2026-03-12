import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadUniverse, getSystems } from './spaceObjects.js';
import { createAxesAndSphere, updateAxisLabelSizes } from './sceneAxes.js';
import { getStarDistanceForMaxSizePx, updateSpaceScene, updateStarApparentSizes } from './spaceScene.js';
import { updateSelectionVisuals, updateSelectionMarkerRotation, updateSelectionLabelSizes } from './selection.js';
import { initNavControls } from './ui.js';
import type { System } from './spaceObjects.js';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const sceneContainer = document.getElementById('scene-container') as HTMLDivElement;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000011);
scene.add(new THREE.AmbientLight(0x404060, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 20, 10);
scene.add(dirLight);

const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10000);
camera.position.set(20, 15, 20);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 0.0001;
controls.maxDistance = 10000;

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const selectionGroup = new THREE.Group();
scene.add(selectionGroup);
let systems: System[] = [];
let systemById = new Map<string, System>();
const selectedIds = new Set<string>();

let isBoxZoomMode = false;
let isBoxZoomDragging = false;
let boxZoomStart = { x: 0, y: 0 };
let boxZoomEnd = { x: 0, y: 0 };
let controlsEnabledBeforeBoxZoom = true;

const boxZoomOverlay = document.createElement('div');
boxZoomOverlay.style.position = 'fixed';
boxZoomOverlay.style.border = '1px solid #00ccff';
boxZoomOverlay.style.backgroundColor = 'rgba(0, 204, 255, 0.12)';
boxZoomOverlay.style.pointerEvents = 'none';
boxZoomOverlay.style.display = 'none';
boxZoomOverlay.style.zIndex = '9999';
document.body.appendChild(boxZoomOverlay);

let activeZoomAnimCancel: (() => void) | null = null;

function getSelectableObjects(): THREE.Object3D[] {
  return scene.children.filter((c) => (c as THREE.Object3D & { userData: { spaceId?: string } }).userData?.spaceId);
}

function toggleSelection(id: string): void {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  refreshSelectionVisuals();
}

function refreshSelectionVisuals(): void {
  const h = renderer.domElement.clientHeight;
  updateSelectionVisuals(selectionGroup, selectedIds, scene, systems, camera, h);
}

const cameraHelper = (() => {
  const group = new THREE.Group();
  group.visible = false;
  const boxGeom = new THREE.BoxGeometry(0.8, 0.5, 0.8);
  const edges = new THREE.EdgesGeometry(boxGeom);
  const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x00ccff }));
  group.add(line);
  boxGeom.dispose();
  const dirLength = 3;
  const dirGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, dirLength),
  ]);
  const dirLine = new THREE.Line(dirGeom, new THREE.LineBasicMaterial({ color: 0xffaa00 }));
  group.add(dirLine);
  return group;
})();
scene.add(cameraHelper);

let axesGroup: THREE.Group;
let sphereMesh: THREE.Group;
let axesVisible = false;
let sphereVisible = false;
function setAxesVisible(visible: boolean): void {
  axesVisible = visible;
  if (axesGroup) axesGroup.visible = visible;
}
function setSphereVisible(visible: boolean): void {
  sphereVisible = visible;
  if (sphereMesh) sphereMesh.visible = visible;
}

function setSceneSize(): void {
  const w = sceneContainer.clientWidth;
  const h = sceneContainer.clientHeight;
  if (w === 0 || h === 0) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
setSceneSize();
const resizeObserver = new ResizeObserver(setSceneSize);
resizeObserver.observe(sceneContainer);

function getSpaceIdFromHit(object: THREE.Object3D): string | null {
  let obj: THREE.Object3D | null = object;
  while (obj) {
    const id = (obj as THREE.Object3D & { userData: { spaceId?: string } }).userData?.spaceId;
    if (id) return id;
    obj = obj.parent;
  }
  return null;
}

function onCanvasClick(event: MouseEvent): void {
  if (isBoxZoomMode || isBoxZoomDragging) return;
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(getSelectableObjects(), true);
  if (intersects.length > 0) {
    const id = getSpaceIdFromHit(intersects[0].object);
    if (id) toggleSelection(id);
  }
}
canvas.addEventListener('click', onCanvasClick);

function setBoxZoomMode(enabled: boolean): void {
  isBoxZoomMode = enabled;
  if (!enabled) {
    isBoxZoomDragging = false;
    boxZoomOverlay.style.display = 'none';
    canvas.style.cursor = '';
    controls.enabled = controlsEnabledBeforeBoxZoom;
  } else {
    controlsEnabledBeforeBoxZoom = controls.enabled;
    controls.enabled = false;
    canvas.style.cursor = 'crosshair';
  }
}

function updateBoxZoomOverlay(): void {
  if (!isBoxZoomDragging) {
    boxZoomOverlay.style.display = 'none';
    return;
  }
  boxZoomOverlay.style.display = 'block';
  const x0 = boxZoomStart.x;
  const y0 = boxZoomStart.y;
  const x1 = boxZoomEnd.x;
  const y1 = boxZoomEnd.y;
  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  const width = Math.abs(x1 - x0);
  const height = Math.abs(y1 - y0);
  boxZoomOverlay.style.left = `${left}px`;
  boxZoomOverlay.style.top = `${top}px`;
  boxZoomOverlay.style.width = `${width}px`;
  boxZoomOverlay.style.height = `${height}px`;
}

function getSystemsInScreenBox(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): System[] {
  const rect = canvas.getBoundingClientRect();
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);

  const v = new THREE.Vector3();
  const selected: System[] = [];
  for (const system of systems) {
    v.set(system.position.x, system.position.y, system.position.z);
    v.project(camera);

    // Convert NDC [-1,1] back to screen pixels.
    const sx = rect.left + ((v.x + 1) / 2) * rect.width;
    const sy = rect.top + ((1 - (v.y + 1) / 2) * rect.height);

    if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) {
      selected.push(system);
    }
  }
  return selected;
}

function zoomSystemsToFit(systemsToFrame: System[]): void {
  if (systemsToFrame.length === 0) return;
  if (systemsToFrame.length === 1) {
    zoomToId(systemsToFrame[0].id);
    return;
  }

  // Use 3D centroid of selected systems as target so the cluster is always centered.
  const center = new THREE.Vector3(0, 0, 0);
  for (const s of systemsToFrame) {
    center.x += s.position.x;
    center.y += s.position.y;
    center.z += s.position.z;
  }
  center.multiplyScalar(1 / systemsToFrame.length);

  let maxR = 0;
  for (const s of systemsToFrame) {
    const dx = s.position.x - center.x;
    const dy = s.position.y - center.y;
    const dz = s.position.z - center.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > maxR) maxR = d;
  }

  const fovRad = (camera.fov * Math.PI) / 180;
  const sinHalfFov = Math.sin(fovRad * 0.5);
  const distance = Math.max(0.0001, (maxR * 1.15) / Math.max(1e-6, sinHalfFov));

  const viewDir = new THREE.Vector3()
    .subVectors(camera.position, controls.target)
    .normalize();
  const desiredCamPos = new THREE.Vector3().copy(center).addScaledVector(viewDir, distance);

  animateCameraTo(center, desiredCamPos, 1800);
}

function zoomViewToBox(x0: number, y0: number, x1: number, y1: number): void {
  const rect = canvas.getBoundingClientRect();
  const viewportWidth = rect.width;
  const viewportHeight = renderer.domElement.clientHeight || rect.height;
  const boxHeight = Math.abs(y1 - y0);
  const boxWidth = Math.abs(x1 - x0);
  if (boxHeight < 4 || boxWidth < 4 || viewportHeight <= 0) return;

  const scaleY = boxHeight / viewportHeight;
  const scaleX = boxWidth / viewportWidth;
  const scale = Math.max(1e-3, Math.min(scaleX, scaleY));

  const currentDistance = controls.getDistance();
  const newDistance = Math.max(0.0001, currentDistance * scale);

  const cx = (x0 + x1) * 0.5;
  const cy = (y0 + y1) * 0.5;
  const ndcX = ((cx - rect.left) / rect.width) * 2 - 1;
  const ndcY = -((cy - rect.top) / rect.height) * 2 + 1;

  // Ray from camera through box center
  const ndc = new THREE.Vector3(ndcX, ndcY, 0.5);
  ndc.unproject(camera);
  const rayDir = ndc.sub(camera.position).normalize();

  // Plane through the current target, perpendicular to the view direction
  const viewDir = new THREE.Vector3().subVectors(controls.target, camera.position).normalize();
  const planePoint = controls.target.clone();
  const planeNormal = viewDir;
  const denom = rayDir.dot(planeNormal);

  let newTarget = controls.target.clone();
  if (Math.abs(denom) > 1e-4) {
    const t = planePoint.clone().sub(camera.position).dot(planeNormal) / denom;
    if (t > 0) {
      newTarget = camera.position.clone().addScaledVector(rayDir, t);
    }
  }

  const desiredCamPos = newTarget.clone().addScaledVector(viewDir, -newDistance);

  animateCameraTo(newTarget, desiredCamPos, 1800);
}

canvas.addEventListener('mousedown', (event: MouseEvent) => {
  if (!isBoxZoomMode || event.button !== 0) return;
  event.preventDefault();
  isBoxZoomDragging = true;
  boxZoomStart = { x: event.clientX, y: event.clientY };
  boxZoomEnd = { ...boxZoomStart };
  updateBoxZoomOverlay();
});

window.addEventListener('mousemove', (event: MouseEvent) => {
  if (!isBoxZoomDragging) return;
  boxZoomEnd = { x: event.clientX, y: event.clientY };
  updateBoxZoomOverlay();
});

window.addEventListener('mouseup', (event: MouseEvent) => {
  if (!isBoxZoomDragging || event.button !== 0) return;
  isBoxZoomDragging = false;
  boxZoomOverlay.style.display = 'none';
  const dx = Math.abs(boxZoomEnd.x - boxZoomStart.x);
  const dy = Math.abs(boxZoomEnd.y - boxZoomStart.y);
  if (dx > 4 && dy > 4) {
    const inBox = getSystemsInScreenBox(boxZoomStart.x, boxZoomStart.y, boxZoomEnd.x, boxZoomEnd.y);
    if (inBox.length > 0) {
      zoomSystemsToFit(inBox);
    } else {
      zoomViewToBox(boxZoomStart.x, boxZoomStart.y, boxZoomEnd.x, boxZoomEnd.y);
    }
  }
  setBoxZoomMode(false);
});

// Right-click context menu: zoom to object under cursor
const contextMenu = document.getElementById('context-menu') as HTMLDivElement | null;
let contextMenuTargetId: string | null = null;

function hideContextMenu(): void {
  if (!contextMenu) return;
  contextMenu.classList.add('hidden');
  contextMenu.setAttribute('aria-hidden', 'true');
  contextMenu.innerHTML = '';
  contextMenuTargetId = null;
}

function showContextMenu(x: number, y: number, id: string): void {
  if (!contextMenu) return;
  const system = systemById.get(id);
  const label = system?.name ?? id;
  contextMenuTargetId = id;
  contextMenu.innerHTML = '';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = `Zoom to ${label}`;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    zoomToId(id);
    hideContextMenu();
  });
  contextMenu.appendChild(btn);
  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;
  contextMenu.classList.remove('hidden');
  contextMenu.setAttribute('aria-hidden', 'false');
}

function zoomToId(id: string): void {
  const system = systemById.get(id);
  if (!system) return;
  const target = new THREE.Vector3(system.position.x, system.position.y, system.position.z);
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();

  let dist = 15;
  const firstStar = system.stars[0];
  if (firstStar) {
    const radiusKm = firstStar.radius ?? 696_000;
    const viewportHeight = renderer.domElement.clientHeight;
    dist = getStarDistanceForMaxSizePx(radiusKm, camera, viewportHeight) * 0.98;
  }

  const desiredCamPos = new THREE.Vector3().copy(target).addScaledVector(dir, dist);
  animateCameraTo(target, desiredCamPos, 1800);
}

function animateCameraTo(target: THREE.Vector3, cameraPos: THREE.Vector3, durationMs: number): void {
  if (activeZoomAnimCancel) activeZoomAnimCancel();

  const startTarget = controls.target.clone();
  const startCam = camera.position.clone();
  const start = performance.now();

  let cancelled = false;
  activeZoomAnimCancel = () => {
    cancelled = true;
    activeZoomAnimCancel = null;
  };

  const tick = () => {
    if (cancelled) return;
    const now = performance.now();
    const t = Math.min(1, (now - start) / Math.max(1, durationMs));
    const e = easeInOutCubic(t);
    controls.target.lerpVectors(startTarget, target, e);
    camera.position.lerpVectors(startCam, cameraPos, e);
    camera.lookAt(controls.target);
    if (t < 1) requestAnimationFrame(tick);
    else {
      activeZoomAnimCancel = null;
    }
  };
  requestAnimationFrame(tick);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

canvas.addEventListener('contextmenu', (event: MouseEvent) => {
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(getSelectableObjects(), true);
  if (intersects.length === 0) return hideContextMenu();
  const id = getSpaceIdFromHit(intersects[0].object);
  if (!id) return hideContextMenu();
  showContextMenu(event.clientX, event.clientY, id);
});

window.addEventListener('click', () => hideContextMenu(), { capture: true });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideContextMenu();
});

function focusOn(position: { x: number; y: number; z: number }): void {
  controls.target.set(position.x, position.y, position.z);
  const dist = 15;
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
  camera.position.copy(controls.target).addScaledVector(dir, dist);
}

let cameraHelperVisible = false;
function setCameraHelperVisible(visible: boolean): void {
  cameraHelperVisible = visible;
}

function animate(): void {
  requestAnimationFrame(animate);
  controls.update();
  if (cameraHelperVisible) {
    cameraHelper.visible = true;
    cameraHelper.position.copy(camera.position);
    cameraHelper.lookAt(controls.target);
  } else {
    cameraHelper.visible = false;
  }
  const viewportHeight = renderer.domElement.clientHeight;
  updateStarApparentSizes(scene, camera, viewportHeight);
  if (axesVisible && axesGroup) updateAxisLabelSizes(axesGroup, camera, viewportHeight);
  if (selectedIds.size > 0) {
    updateSelectionMarkerRotation(selectionGroup, scene, camera, viewportHeight);
    updateSelectionLabelSizes(selectionGroup, camera, viewportHeight);
  }
  navApi.updateReadout(camera.position);
  renderer.render(scene, camera);
}

let navApi: { updateReadout: (position: THREE.Vector3) => void; updateSelectionHighlight?: (ids: Set<string>) => void };

async function init(): Promise<void> {
  const entries = await loadUniverse();
  systems = getSystems(entries);
  systemById = new Map(systems.map((s) => [s.id, s]));
  updateSpaceScene(scene, systems);
  const { axesGroup: axes, sphereMesh: sphere } = createAxesAndSphere(systems);
  axesGroup = axes;
  sphereMesh = sphere;
  axesGroup.visible = false;
  sphereMesh.visible = false;
  scene.add(axesGroup);
  scene.add(sphereMesh);
  const deselectAll = () => {
    selectedIds.clear();
    refreshSelectionVisuals();
  };
  navApi = initNavControls(
    camera,
    controls,
    systems,
    setCameraHelperVisible,
    setAxesVisible,
    setSphereVisible,
    deselectAll,
    () => setBoxZoomMode(true),
  );
  animate();
}
init();
