import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { System } from './spaceObjects.js';
import { getSceneExtentRadius } from './sceneAxes.js';

export type FocusCallback = (position: { x: number; y: number; z: number }) => void;

/** Returns radius in world units (light years) for bounding box / fit-all. Radius in data is km. */
function getObjectRadiusLy(obj: SpaceObject): number {
  const radiusKm = obj.radius ?? (obj.type === 'star' ? 696000 : obj.type === 'planet' ? 6371 : 0.001);
  return radiusKm / KM_PER_LY;
}

export type ObjectListApi = {
  updateSelectionHighlight: (selectedIds: Set<string>) => void;
};

export function initObjectList(
  objects: SpaceObject[],
  onFocus: FocusCallback,
  selectedIds: Set<string>,
  onToggleSelection: (id: string) => void,
): ObjectListApi {
  const list = document.getElementById('object-list');
  const api: ObjectListApi = { updateSelectionHighlight: () => {} };
  if (!list) return api;

  function renderList(): void {
    list.innerHTML = '';
    for (const obj of objects) {
      if (obj.type === 'meta') continue;
      const li = document.createElement('li');
      li.dataset.objectId = obj.id;
      li.classList.toggle('selected', selectedIds.has(obj.id));
      li.style.cursor = 'pointer';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = obj.name ?? obj.id;
      const type = document.createElement('span');
      type.className = 'type';
      type.textContent = obj.type;
      const focusBtn = document.createElement('button');
      focusBtn.textContent = 'Focus';
      focusBtn.type = 'button';
      focusBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        onFocus(obj.position);
      });
      li.appendChild(name);
      li.appendChild(type);
      li.appendChild(focusBtn);
      li.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        onToggleSelection(obj.id);
      });
      list.appendChild(li);
    }
  }

  api.updateSelectionHighlight = (ids: Set<string>) => {
    list.querySelectorAll('li').forEach((li) => {
      const id = (li as HTMLElement).dataset.objectId;
      li.classList.toggle('selected', id != null && ids.has(id));
    });
  };

  renderList();

  const panel = document.getElementById('panel');
  const toggle = document.getElementById('panel-toggle');
  if (panel && toggle) {
    toggle.addEventListener('click', () => {
      const collapsed = panel.classList.toggle('collapsed');
      toggle.textContent = collapsed ? 'Show panel' : 'Hide panel';
    });
  }

  const objectsSection = document.getElementById('objects-section');
  const objectsHead = document.getElementById('objects-section-head');
  if (objectsSection && objectsHead) {
    objectsHead.addEventListener('click', () => objectsSection.classList.toggle('collapsed'));
  }

  return api;
}

export type NavControlsApi = {
  updateReadout: (position: THREE.Vector3) => void;
};

export function initNavControls(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  systems: System[],
  setCameraHelperVisible: (visible: boolean) => void,
  setAxesVisible: (visible: boolean) => void,
  setSphereVisible: (visible: boolean) => void,
  onDeselectAll: () => void,
): NavControlsApi {
  const container = document.getElementById('nav-controls');
  const api: NavControlsApi = { updateReadout: () => {} };
  if (!container) return api;

  let activeNavAnimCancel: (() => void) | null = null;

  function animateCameraTo(target: THREE.Vector3, cameraPos: THREE.Vector3, durationMs: number): void {
    if (activeNavAnimCancel) activeNavAnimCancel();

    const startTarget = controls.target.clone();
    const startCam = camera.position.clone();
    const start = performance.now();
    const wasEnabled = controls.enabled;
    controls.enabled = false;

    let cancelled = false;
    activeNavAnimCancel = () => {
      cancelled = true;
      controls.enabled = wasEnabled;
      activeNavAnimCancel = null;
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
        activeNavAnimCancel = null;
      }
    };
    requestAnimationFrame(tick);
  }

  function easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  const ROTATE_STEP = Math.PI / 12;
  const ZOOM_STEP = 3;
  const PAN_STEP = 2;
  const MOVE_STEP = 2;
  let cameraHelperOn = false;
  let axesOn = true;
  let sphereOn = false;

  function fitAll(): void {
    const R = getSceneExtentRadius(systems);
    const center = new THREE.Vector3(0, 0, 0);
    const fovRad = (camera.fov * Math.PI) / 180;
    const sinHalfFov = Math.sin(fovRad * 0.5);
    const distance = Math.max(1, (R * 1.05) / sinHalfFov);
    const direction = new THREE.Vector3()
      .subVectors(camera.position, controls.target)
      .normalize();
    const desiredTarget = center;
    const desiredCamPos = new THREE.Vector3().copy(center).addScaledVector(direction, distance);
    animateCameraTo(desiredTarget, desiredCamPos, 1800);
  }

  function rotate(deltaAzimuth: number, deltaPolar: number): void {
    const target = controls.target;
    const dist = controls.getDistance();
    const theta = controls.getAzimuthalAngle();
    const phi = controls.getPolarAngle();
    const newTheta = theta + deltaAzimuth;
    const newPhi = THREE.MathUtils.clamp(phi + deltaPolar, 0.05, Math.PI - 0.05);
    camera.position.set(
      target.x + dist * Math.sin(newPhi) * Math.sin(newTheta),
      target.y + dist * Math.cos(newPhi),
      target.z + dist * Math.sin(newPhi) * Math.cos(newTheta),
    );
  }

  function zoom(delta: number): void {
    const target = controls.target;
    const dir = new THREE.Vector3().subVectors(camera.position, target).normalize();
    const dist = controls.getDistance();
    const newDist = THREE.MathUtils.clamp(dist + delta, 1, 10000);
    camera.position.copy(target).addScaledVector(dir, newDist);
  }

  function pan(dx: number, dy: number): void {
    const forward = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    controls.target.addScaledVector(right, -dx).addScaledVector(up, dy);
    camera.position.addScaledVector(right, -dx).addScaledVector(up, dy);
  }

  function goToOrigin(): void {
    camera.position.set(0, 0, 0);
    controls.target.set(0, 0, -1);
  }

  function moveCamera(forwardDelta: number, rightDelta: number, upDelta: number): void {
    const forward = new THREE.Vector3().subVectors(controls.target, camera.position).normalize();
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    const delta = new THREE.Vector3()
      .addScaledVector(forward, forwardDelta)
      .addScaledVector(right, rightDelta)
      .addScaledVector(up, upDelta);
    camera.position.add(delta);
    controls.target.add(delta);
  }

  container.innerHTML = '';

  const readoutRow = document.createElement('div');
  readoutRow.className = 'row';
  const readoutEl = document.createElement('div');
  readoutEl.className = 'camera-readout';
  readoutEl.textContent = 'Camera: (0, 0, 0)';
  readoutRow.appendChild(readoutEl);
  container.appendChild(readoutRow);
  api.updateReadout = (pos: THREE.Vector3) => {
    readoutEl.textContent = `Camera: (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)})`;
  };

  const originRow = document.createElement('div');
  originRow.className = 'row';
  const originBtn = document.createElement('button');
  originBtn.type = 'button';
  originBtn.textContent = 'Go to origin';
  originBtn.addEventListener('click', goToOrigin);
  originRow.appendChild(originBtn);
  container.appendChild(originRow);

  const moveRow = document.createElement('div');
  moveRow.className = 'row';
  moveRow.innerHTML = '<label>Move</label>';
  const moveGroup = document.createElement('div');
  moveGroup.className = 'btn-group';
  const moveFwd = document.createElement('button');
  moveFwd.type = 'button';
  moveFwd.className = 'small';
  moveFwd.textContent = 'Fwd';
  moveFwd.title = 'Move forward';
  moveFwd.addEventListener('click', () => moveCamera(MOVE_STEP, 0, 0));
  const moveBack = document.createElement('button');
  moveBack.type = 'button';
  moveBack.className = 'small';
  moveBack.textContent = 'Back';
  moveBack.addEventListener('click', () => moveCamera(-MOVE_STEP, 0, 0));
  const moveLeft = document.createElement('button');
  moveLeft.type = 'button';
  moveLeft.className = 'small';
  moveLeft.textContent = 'L';
  moveLeft.title = 'Move left';
  moveLeft.addEventListener('click', () => moveCamera(0, -MOVE_STEP, 0));
  const moveRight = document.createElement('button');
  moveRight.type = 'button';
  moveRight.className = 'small';
  moveRight.textContent = 'R';
  moveRight.title = 'Move right';
  moveRight.addEventListener('click', () => moveCamera(0, MOVE_STEP, 0));
  const moveUp = document.createElement('button');
  moveUp.type = 'button';
  moveUp.className = 'small';
  moveUp.textContent = 'Up';
  moveUp.addEventListener('click', () => moveCamera(0, 0, MOVE_STEP));
  const moveDown = document.createElement('button');
  moveDown.type = 'button';
  moveDown.className = 'small';
  moveDown.textContent = 'Dn';
  moveDown.title = 'Move down';
  moveDown.addEventListener('click', () => moveCamera(0, 0, -MOVE_STEP));
  moveGroup.append(moveFwd, moveBack, moveLeft, moveRight, moveUp, moveDown);
  moveRow.appendChild(moveGroup);
  container.appendChild(moveRow);

  const fitRow = document.createElement('div');
  fitRow.className = 'row';
  const fitBtn = document.createElement('button');
  fitBtn.type = 'button';
  fitBtn.textContent = 'Fit all in view';
  fitBtn.addEventListener('click', fitAll);
  fitRow.appendChild(fitBtn);
  container.appendChild(fitRow);

  const deselectRow = document.createElement('div');
  deselectRow.className = 'row';
  const deselectBtn = document.createElement('button');
  deselectBtn.type = 'button';
  deselectBtn.textContent = 'Deselect all';
  deselectBtn.addEventListener('click', onDeselectAll);
  deselectRow.appendChild(deselectBtn);
  container.appendChild(deselectRow);

  const rotateRow = document.createElement('div');
  rotateRow.className = 'row';
  rotateRow.innerHTML = '<label>Rotate</label>';
  const rotateGroup = document.createElement('div');
  rotateGroup.className = 'btn-group';
  const rotLeft = document.createElement('button');
  rotLeft.type = 'button';
  rotLeft.className = 'small';
  rotLeft.textContent = '←';
  rotLeft.title = 'Rotate left';
  rotLeft.addEventListener('click', () => rotate(ROTATE_STEP, 0));
  const rotRight = document.createElement('button');
  rotRight.type = 'button';
  rotRight.className = 'small';
  rotRight.textContent = '→';
  rotRight.title = 'Rotate right';
  rotRight.addEventListener('click', () => rotate(-ROTATE_STEP, 0));
  const rotUp = document.createElement('button');
  rotUp.type = 'button';
  rotUp.className = 'small';
  rotUp.textContent = '↑';
  rotUp.title = 'Rotate up';
  rotUp.addEventListener('click', () => rotate(0, -ROTATE_STEP));
  const rotDown = document.createElement('button');
  rotDown.type = 'button';
  rotDown.className = 'small';
  rotDown.textContent = '↓';
  rotDown.title = 'Rotate down';
  rotDown.addEventListener('click', () => rotate(0, ROTATE_STEP));
  rotateGroup.append(rotLeft, rotRight, rotUp, rotDown);
  rotateRow.appendChild(rotateGroup);
  container.appendChild(rotateRow);

  const zoomRow = document.createElement('div');
  zoomRow.className = 'row';
  zoomRow.innerHTML = '<label>Zoom</label>';
  const zoomGroup = document.createElement('div');
  zoomGroup.className = 'btn-group';
  const zoomIn = document.createElement('button');
  zoomIn.type = 'button';
  zoomIn.className = 'small';
  zoomIn.textContent = '−';
  zoomIn.title = 'Zoom in';
  zoomIn.addEventListener('click', () => zoom(-ZOOM_STEP));
  const zoomOut = document.createElement('button');
  zoomOut.type = 'button';
  zoomOut.className = 'small';
  zoomOut.textContent = '+';
  zoomOut.title = 'Zoom out';
  zoomOut.addEventListener('click', () => zoom(ZOOM_STEP));
  zoomGroup.append(zoomIn, zoomOut);
  zoomRow.appendChild(zoomGroup);
  container.appendChild(zoomRow);

  const panRow = document.createElement('div');
  panRow.className = 'row';
  panRow.innerHTML = '<label>Pan</label>';
  const panGroup = document.createElement('div');
  panGroup.className = 'btn-group';
  const panLeft = document.createElement('button');
  panLeft.type = 'button';
  panLeft.className = 'small';
  panLeft.textContent = '←';
  panLeft.addEventListener('click', () => pan(PAN_STEP, 0));
  const panRight = document.createElement('button');
  panRight.type = 'button';
  panRight.className = 'small';
  panRight.textContent = '→';
  panRight.addEventListener('click', () => pan(-PAN_STEP, 0));
  const panUp = document.createElement('button');
  panUp.type = 'button';
  panUp.className = 'small';
  panUp.textContent = '↑';
  panUp.addEventListener('click', () => pan(0, -PAN_STEP));
  const panDown = document.createElement('button');
  panDown.type = 'button';
  panDown.className = 'small';
  panDown.textContent = '↓';
  panDown.addEventListener('click', () => pan(0, PAN_STEP));
  panGroup.append(panLeft, panRight, panUp, panDown);
  panRow.appendChild(panGroup);
  container.appendChild(panRow);

  const cameraHelperRow = document.createElement('div');
  cameraHelperRow.className = 'row';
  const cameraHelperBtn = document.createElement('button');
  cameraHelperBtn.type = 'button';
  cameraHelperBtn.textContent = 'Show camera';
  cameraHelperBtn.addEventListener('click', () => {
    cameraHelperOn = !cameraHelperOn;
    setCameraHelperVisible(cameraHelperOn);
    cameraHelperBtn.textContent = cameraHelperOn ? 'Hide camera' : 'Show camera';
  });
  cameraHelperRow.appendChild(cameraHelperBtn);
  container.appendChild(cameraHelperRow);

  const axesRow = document.createElement('div');
  axesRow.className = 'row';
  const axesBtn = document.createElement('button');
  axesBtn.type = 'button';
  setAxesVisible(true);
  axesBtn.textContent = 'Hide axes';
  axesBtn.addEventListener('click', () => {
    axesOn = !axesOn;
    setAxesVisible(axesOn);
    axesBtn.textContent = axesOn ? 'Hide axes' : 'Show axes';
  });
  axesRow.appendChild(axesBtn);
  container.appendChild(axesRow);

  const sphereRow = document.createElement('div');
  sphereRow.className = 'row';
  const sphereBtn = document.createElement('button');
  sphereBtn.type = 'button';
  sphereBtn.textContent = 'Show sphere';
  sphereBtn.addEventListener('click', () => {
    sphereOn = !sphereOn;
    setSphereVisible(sphereOn);
    sphereBtn.textContent = sphereOn ? 'Hide sphere' : 'Show sphere';
  });
  sphereRow.appendChild(sphereBtn);
  container.appendChild(sphereRow);

  const navSection = document.getElementById('nav-section');
  const navHead = document.getElementById('nav-section-head');
  if (navSection && navHead) {
    navHead.addEventListener('click', () => navSection.classList.toggle('collapsed'));
  }

  // Default to a "view all" framing on load.
  fitAll();

  return api;
}
