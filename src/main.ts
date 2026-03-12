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

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
camera.position.set(20, 15, 20);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const selectionGroup = new THREE.Group();
scene.add(selectionGroup);
let systems: System[] = [];
let systemById = new Map<string, System>();
const selectedIds = new Set<string>();

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
  const wasEnabled = controls.enabled;
  controls.enabled = false;

  let cancelled = false;
  activeZoomAnimCancel = () => {
    cancelled = true;
    controls.enabled = wasEnabled;
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
      controls.enabled = wasEnabled;
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
  updateStarApparentSizes(scene, camera, viewportHeight, 'default');
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
  navApi = initNavControls(camera, controls, systems, setCameraHelperVisible, setAxesVisible, setSphereVisible, deselectAll);
  animate();
}
init();
