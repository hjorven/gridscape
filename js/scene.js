// 3D skyline renderer (Three.js). One InstancedMesh = one draw call for all ~371 days.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const CELL = 1;          // spacing between day centers
const BOX = 0.84;        // footprint of one building
const MAX_H = 9;         // height of the busiest day
const MIN_H = 0.12;      // height of a day with zero contributions

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

export function createSkyline(container, { onHover } = {}) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const lowPower = coarse || (navigator.hardwareConcurrency || 4) <= 4;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true, // needed to export PNGs
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1.75 : 2));
  renderer.shadowMap.enabled = !lowPower;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x223344, 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(-18, 40, 26);
  sun.castShadow = renderer.shadowMap.enabled;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 20, bottom: -20, near: 1, far: 120 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xffffff, 0.6);
  rim.position.set(25, 15, -30);
  scene.add(rim);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 12;
  controls.maxDistance = 160;
  controls.enablePan = !coarse;
  controls.autoRotate = !reducedMotion;
  controls.autoRotateSpeed = 0.55;

  const group = new THREE.Group();
  scene.add(group);

  let mesh = null;
  let plate = null;
  let label = null;
  let lastLabel = null;
  let lastPortrait = null;
  let cells = [];
  let targets = [];
  let palette = null;
  let size = { w: 1, d: 7 };
  let animStart = 0;
  let animating = false;
  let hovered = -1;
  let visible = true;
  const tmpMatrix = new THREE.Matrix4();
  const tmpColor = new THREE.Color();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function disposeGroup() {
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
    group.clear();
    mesh = plate = label = null;
  }

  function heightFor(count, max) {
    if (!count || !max) return MIN_H;
    return MIN_H + 0.25 + Math.pow(count / max, 0.55) * MAX_H;
  }

  function makeLabelTexture(text, pal) {
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = pal.base;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = pal.text;
    ctx.globalAlpha = 0.85;
    ctx.font = '600 52px ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(text.left, 24, canvas.height / 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = pal.muted;
    ctx.fillText(text.right, canvas.width - 24, canvas.height / 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return tex;
  }

  function applyPaletteToScene() {
    scene.background = new THREE.Color(palette.bg);
    scene.fog = new THREE.Fog(palette.bg, 70, 190);
    container.parentElement?.style.setProperty('--stage-bg', palette.bg);
  }

  function setData({ cells: nextCells, weeks, max, labelText }, pal) {
    disposeGroup();
    cells = nextCells;
    palette = pal;
    lastLabel = labelText;
    applyPaletteToScene();

    const w = Math.max(weeks, 1) * CELL;
    const d = 7 * CELL;
    size = { w, d };
    const x0 = -w / 2 + CELL / 2;
    const z0 = -d / 2 + CELL / 2;

    // Base plate with a front margin for the label
    const margin = 1.4;
    const front = 2.6;
    const plateGeo = new THREE.BoxGeometry(w + margin * 2, 0.8, d + margin + front);
    plateGeo.translate(0, -0.4, (front - margin) / 2);
    plate = new THREE.Mesh(plateGeo, new THREE.MeshStandardMaterial({ color: pal.base, roughness: 0.9, metalness: 0 }));
    plate.receiveShadow = true;
    group.add(plate);

    // Label lying flat on the front margin
    const labelW = w + margin * 2 - 1;
    const labelH = labelW * (96 / 2048);
    label = new THREE.Mesh(
      new THREE.PlaneGeometry(labelW, labelH),
      new THREE.MeshBasicMaterial({ map: makeLabelTexture(labelText, pal), transparent: false })
    );
    label.rotation.x = -Math.PI / 2;
    label.position.set(0, 0.005, d / 2 + front / 2 + 0.1);
    group.add(label);

    // Buildings
    const geo = new THREE.BoxGeometry(BOX, 1, BOX);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0 });
    mesh = new THREE.InstancedMesh(geo, mat, cells.length);
    mesh.castShadow = renderer.shadowMap.enabled;
    mesh.receiveShadow = renderer.shadowMap.enabled;
    targets = cells.map((c) => heightFor(c.count, max));
    cells.forEach((c, i) => {
      mesh.setColorAt(i, tmpColor.set(pal.levels[Math.min(4, Math.max(0, c.level))]));
    });
    mesh.instanceColor.needsUpdate = true;
    mesh.userData.x0 = x0;
    mesh.userData.z0 = z0;
    group.add(mesh);

    animStart = performance.now();
    animating = true;
    writeMatrices(reducedMotion ? 1e9 : 0);
    mesh.computeBoundingSphere();
    hovered = -1;
    resetCamera();
  }

  function writeMatrices(elapsed) {
    if (!mesh) return;
    let done = true;
    const { x0, z0 } = mesh.userData;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const delay = c.week * 14 + c.dow * 10; // wave from left to right
      const p = Math.min(1, Math.max(0, (elapsed - delay) / 700));
      if (p < 1) done = false;
      const ease = 1 - Math.pow(1 - p, 3);
      const h = Math.max(0.001, targets[i] * ease);
      tmpMatrix.makeScale(1, h, 1);
      tmpMatrix.setPosition(x0 + c.week * CELL, 0, z0 + c.dow * CELL);
      mesh.setMatrixAt(i, tmpMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (done) {
      animating = false;
      mesh.computeBoundingSphere();
    }
  }

  function setPalette(pal) {
    palette = pal;
    if (!mesh) return;
    applyPaletteToScene();
    plate.material.color.set(pal.base);
    if (lastLabel) setLabel(lastLabel);
    cells.forEach((c, i) => mesh.setColorAt(i, tmpColor.set(pal.levels[c.level] || pal.levels[0])));
    mesh.instanceColor.needsUpdate = true;
    hovered = -1;
  }

  function setLabel(labelText) {
    lastLabel = labelText;
    if (!label || !palette) return;
    label.material.map.dispose();
    label.material.map = makeLabelTexture(labelText, palette);
    label.material.needsUpdate = true;
  }

  function resetCamera() {
    const { w, d } = size;
    const rect = container.getBoundingClientRect();
    const aspect = Math.max(0.3, rect.width / Math.max(1, rect.height));
    const radius = Math.sqrt((w / 2) ** 2 + (d / 2 + 1.5) ** 2 + (MAX_H / 2) ** 2);
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const fov = Math.min(vfov, hfov);
    // Portrait screens look down the long axis so the city recedes into depth.
    const dir = (aspect < 1 ? new THREE.Vector3(1, 0.85, 0.75) : new THREE.Vector3(0.3, 0.62, 1)).normalize();
    const target = new THREE.Vector3(0, MAX_H * 0.15, 0.6);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();

    // Binary search the camera distance so all corners of the city fit on screen.
    const halfW = w / 2 + 1.4;
    const corners = [];
    for (const x of [-halfW, halfW]) for (const y of [0, MAX_H * 0.7]) for (const z of [-d / 2 - 1.4, d / 2 + 2.6]) {
      corners.push(new THREE.Vector3(x, y, z));
    }
    const fits = (dist) => {
      camera.position.copy(target).addScaledVector(dir, dist);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      return corners.every((c) => {
        const p = c.clone().project(camera);
        return Math.abs(p.x) <= 0.92 && Math.abs(p.y) <= 0.86 && p.z < 1;
      });
    };
    let lo = 5;
    let hi = Math.max(40, (radius / Math.sin(fov / 2)) * 2);
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid; else lo = mid;
    }
    camera.position.copy(target).addScaledVector(dir, hi);
    controls.target.copy(target);
    controls.maxDistance = Math.max(60, hi * 2.2);
    controls.update();
  }

  function resize() {
    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    const portrait = rect.width < rect.height;
    if (mesh && portrait !== lastPortrait) resetCamera();
    lastPortrait = portrait;
  }

  function pick(clientX, clientY) {
    if (!mesh || animating) return -1;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(mesh, false)[0];
    return hit ? hit.instanceId : -1;
  }

  function highlight(id) {
    if (id === hovered || !mesh) return;
    if (hovered >= 0) mesh.setColorAt(hovered, tmpColor.set(palette.levels[cells[hovered].level] || palette.levels[0]));
    if (id >= 0) mesh.setColorAt(id, tmpColor.set(palette.levels[cells[id].level] || palette.levels[0]).offsetHSL(0, 0, 0.18));
    mesh.instanceColor.needsUpdate = true;
    hovered = id;
  }

  function report(id, clientX, clientY) {
    highlight(id);
    const rect = container.getBoundingClientRect();
    onHover?.(id >= 0 ? cells[id] : null, clientX - rect.left, clientY - rect.top);
  }

  // Mouse hover
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || e.buttons) return;
    report(pick(e.clientX, e.clientY), e.clientX, e.clientY);
  });
  renderer.domElement.addEventListener('pointerleave', () => report(-1, 0, 0));
  // Tap / click selection (ignore drags)
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    report(pick(e.clientX, e.clientY), e.clientX, e.clientY);
  });
  controls.addEventListener('start', () => {
    if (hovered >= 0) report(-1, 0, 0);
  });

  const ro = new ResizeObserver(() => resize());
  ro.observe(container);
  resize();

  // Pause rendering when the stage is off-screen or the tab is hidden (saves battery on phones).
  const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
  io.observe(container);

  renderer.setAnimationLoop((now) => {
    if (!visible || document.hidden) return;
    if (animating) writeMatrices(now - animStart);
    controls.update();
    renderer.render(scene, camera);
  });

  return {
    setData,
    setPalette,
    setLabel,
    resetCamera,
    resize,
    setAutoRotate(on) { controls.autoRotate = on; },
    get autoRotate() { return controls.autoRotate; },
    /** Finishes the grow-in animation, renders a frame and returns the canvas. */
    snapshot() {
      if (animating) writeMatrices(1e9);
      highlight(-1);
      renderer.render(scene, camera);
      return renderer.domElement;
    },
    dispose() {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      io.disconnect();
      controls.dispose();
      disposeGroup();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
