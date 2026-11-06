// 3D skyline renderer (Three.js), styled after the original GitHub Skyline:
// buildings on a dark, bevelled plinth with the username and year raised on the front slope.
// Supports one or two cities (compare mode), a night mode, video capture and STL export.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const CELL = 1;          // spacing between day centers
const BOX = 0.84;        // footprint of one building
const MAX_H = 9;         // height of the busiest day
const MIN_H = 0.12;      // height of a day with zero contributions
const GAP = 2.2;         // gap between two cities in compare mode
const MARGIN = 1.1;      // plinth margin around the buildings
const FRONT = 1.5;       // extra plinth depth in front (month labels)
const PLINTH_H = 1.7;    // plinth height
const SLOPE = 1.1;       // horizontal run of the slanted plinth sides
const FONT_URL = new URL('../assets/fonts/dejavu-sans-bold.typeface.json', import.meta.url).href;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

let fontPromise = null;
function loadFont() {
  if (!fontPromise) {
    fontPromise = Promise.all([
      import('three/addons/loaders/FontLoader.js'),
      import('three/addons/geometries/TextGeometry.js'),
      fetch(FONT_URL).then((r) => { if (!r.ok) throw new Error('font'); return r.json(); }),
    ]).then(([{ Font }, { TextGeometry }, json]) => ({ font: new Font(json), TextGeometry }))
      .catch((err) => { fontPromise = null; throw err; });
  }
  return fontPromise;
}

/** Box whose bottom face is wider than the top: the bevelled plinth. Top face sits at y = 0. */
function plinthGeometry(w, h, d, slope) {
  const g = new THREE.BoxGeometry(w, h, d);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < 0) {
      pos.setX(i, pos.getX(i) + Math.sign(pos.getX(i)) * slope);
      pos.setZ(i, pos.getZ(i) + Math.sign(pos.getZ(i)) * slope);
    }
  }
  g.translate(0, -h / 2, 0);
  g.computeVertexNormals();
  return g;
}

function heightFor(count, max) {
  if (!count || !max) return MIN_H;
  return MIN_H + 0.25 + Math.pow(count / max, 0.55) * MAX_H;
}

export function createSkyline(container, { onHover } = {}) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const lowPower = coarse || (navigator.hardwareConcurrency || 4) <= 4;
  const basePixelRatio = Math.min(window.devicePixelRatio || 1, lowPower ? 1.75 : 2);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(basePixelRatio);
  renderer.shadowMap.enabled = !lowPower;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 600);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x223344, 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(-18, 40, 26);
  sun.castShadow = renderer.shadowMap.enabled;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 26, bottom: -26, near: 1, far: 140 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xffffff, 0.6);
  rim.position.set(25, 15, -30);
  scene.add(rim);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 10;
  controls.maxDistance = 180;
  controls.enablePan = !coarse;
  controls.autoRotate = !reducedMotion;
  controls.autoRotateSpeed = 0.55;

  const group = new THREE.Group();
  scene.add(group);

  // Glow uniform shared by all building materials (night mode)
  const glow = { value: 0 };
  const buildingMaterial = () => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0 });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uGlow = glow;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n  totalEmissiveRadiance += vColor.rgb * uGlow;\n#endif');
    };
    return m;
  };

  let cities = [];        // [{ mesh, cells, targets, palette, z0 }]
  let plinth = null;
  let theme = null;
  let night = false;
  let layout = { w: 10, d: 7, zMin: -4, zMax: 4 };
  let lastData = null;
  let lastPortrait = null;
  let animStart = 0;
  let animating = false;
  let hovered = null;     // { city, id }
  let visible = true;
  let capturing = false;
  let dataVersion = 0;
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
    cities = [];
    plinth = null;
  }

  function applyTheme() {
    if (!theme) return;
    const bg = night ? '#010409' : theme.bg;
    scene.background = new THREE.Color(bg);
    scene.fog = new THREE.Fog(bg, 80, 220);
    container.parentElement?.style.setProperty('--stage-bg', bg);
    hemi.intensity = night ? 0.25 : 1.6;
    sun.intensity = night ? 0.35 : 2.4;
    rim.intensity = night ? 0.25 : 0.6;
    glow.value = night ? 0.9 : 0;
    if (plinth) plinth.material.color.set(night ? '#0d1117' : theme.plinth);
    group.traverse((o) => { if (o.userData.isText) o.material.color.set(night ? '#8b949e' : theme.textColor); });
  }

  function monthsTexture(cells, weeks, pal) {
    const pxPerWeek = 40;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(64, weeks * pxPerWeek);
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = pal.textColor;
    ctx.font = '600 30px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif';
    ctx.textBaseline = 'middle';
    let last = -1;
    for (const c of cells) {
      if (c.dow !== 0 && c !== cells[0]) continue;
      const m = Number(c.date.slice(5, 7)) - 1;
      if (m !== last && Number(c.date.slice(8, 10)) <= 7 && c.week <= weeks - 2) {
        ctx.fillText(MONTHS[m], c.week * pxPerWeek + 4, 32);
        last = m;
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return tex;
  }

  async function addText(version, left, right) {
    let lib;
    try {
      lib = await loadFont();
    } catch {
      return; // the skyline works without engraved text
    }
    if (version !== dataVersion) return;
    const { font, TextGeometry } = lib;
    const L = Math.hypot(SLOPE, PLINTH_H);
    const tilt = -Math.asin(SLOPE / L);
    const size = 0.78;
    const zFront = layout.zMax;
    const make = (str, align) => {
      const geo = new TextGeometry(str, { font, size, depth: 0.14, curveSegments: 4, bevelEnabled: false });
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      const dx = align === 'left' ? -bb.min.x : -bb.max.x;
      geo.translate(dx, -(bb.min.y + bb.max.y) / 2, 0);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: night ? '#8b949e' : theme.textColor, roughness: 0.6 }));
      mesh.userData.isText = true;
      mesh.rotation.x = tilt;
      // Centre of the front slope, nudged out along its normal
      const nx = SLOPE / L;
      const nz = PLINTH_H / L;
      const halfW = layout.w / 2 + MARGIN + SLOPE / 2;
      mesh.position.set(align === 'left' ? -halfW + 1.4 : halfW - 1.4, -PLINTH_H / 2 + nx * 0.01, zFront + SLOPE / 2 + nz * 0.01);
      mesh.castShadow = false;
      group.add(mesh);
    };
    make(left, 'left');
    if (right) make(right, 'right');
  }

  /**
   * data: { cities: [{ cells, weeks, palette }], max, text: { left, right } }
   * th:   { bg, plinth, textColor }
   */
  function setData(data, th) {
    disposeGroup();
    dataVersion++;
    lastData = data;
    theme = th;
    const n = data.cities.length;
    const weeks = Math.max(1, ...data.cities.map((c) => c.weeks));
    const w = weeks * CELL;
    const d = n * 7 * CELL + (n - 1) * GAP;
    layout = { w, d, zMin: -d / 2 - MARGIN, zMax: d / 2 + FRONT };

    // Plinth
    const pw = w + MARGIN * 2;
    const pd = d + MARGIN + FRONT;
    const geo = plinthGeometry(pw, PLINTH_H, pd, SLOPE);
    geo.translate(0, 0, (FRONT - MARGIN) / 2);
    plinth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: th.plinth, roughness: 0.85, metalness: 0.05 }));
    plinth.receiveShadow = renderer.shadowMap.enabled;
    plinth.castShadow = renderer.shadowMap.enabled;
    group.add(plinth);

    // Soft shadow on the "floor"
    if (renderer.shadowMap.enabled) {
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(pw * 3, pd * 4), new THREE.ShadowMaterial({ opacity: 0.25 }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -PLINTH_H - 0.01;
      floor.receiveShadow = true;
      group.add(floor);
    }

    // Buildings, one instanced mesh per city
    const x0 = -w / 2 + CELL / 2;
    data.cities.forEach((city, i) => {
      const z0 = -d / 2 + CELL / 2 + i * (7 * CELL + GAP);
      const box = new THREE.BoxGeometry(BOX, 1, BOX);
      box.translate(0, 0.5, 0);
      const mesh = new THREE.InstancedMesh(box, buildingMaterial(), city.cells.length);
      mesh.castShadow = renderer.shadowMap.enabled;
      mesh.receiveShadow = renderer.shadowMap.enabled;
      city.cells.forEach((c, j) => mesh.setColorAt(j, tmpColor.set(city.palette.levels[c.level] || city.palette.levels[0])));
      mesh.instanceColor.needsUpdate = true;
      mesh.userData.cityIndex = i;
      group.add(mesh);
      cities.push({ mesh, cells: city.cells, palette: city.palette, targets: city.cells.map((c) => heightFor(c.count, data.max)), x0, z0 });
    });

    // Month labels on the front strip (first city only)
    const first = data.cities[0];
    const months = new THREE.Mesh(
      new THREE.PlaneGeometry(weeks * CELL, 1.6 * CELL),
      new THREE.MeshBasicMaterial({ map: monthsTexture(first.cells, weeks, th), transparent: true, depthWrite: false })
    );
    months.rotation.x = -Math.PI / 2;
    months.position.set(0, 0.01, d / 2 + FRONT / 2 + 0.05);
    group.add(months);

    addText(dataVersion, data.text.left, data.text.right);
    applyTheme();

    animStart = performance.now();
    animating = true;
    writeMatrices(reducedMotion ? 1e9 : 0);
    hovered = null;
    resetCamera();
  }

  function writeMatrices(elapsed) {
    let done = true;
    for (const city of cities) {
      for (let i = 0; i < city.cells.length; i++) {
        const c = city.cells[i];
        const delay = c.week * 14 + c.dow * 10;
        const p = Math.min(1, Math.max(0, (elapsed - delay) / 700));
        if (p < 1) done = false;
        const ease = 1 - Math.pow(1 - p, 3);
        tmpMatrix.makeScale(1, Math.max(0.001, city.targets[i] * ease), 1);
        tmpMatrix.setPosition(city.x0 + c.week * CELL, 0, city.z0 + c.dow * CELL);
        city.mesh.setMatrixAt(i, tmpMatrix);
      }
      city.mesh.instanceMatrix.needsUpdate = true;
    }
    if (done) {
      animating = false;
      for (const city of cities) city.mesh.computeBoundingSphere();
    }
  }

  function setTheme(th) {
    theme = th;
    if (!lastData) return;
    // Text and month colours depend on the theme, so rebuild.
    setData(lastData, th);
  }

  function setCityPalettes(palettes) {
    cities.forEach((city, i) => {
      city.palette = palettes[i] || city.palette;
      city.cells.forEach((c, j) => city.mesh.setColorAt(j, tmpColor.set(city.palette.levels[c.level] || city.palette.levels[0])));
      city.mesh.instanceColor.needsUpdate = true;
    });
  }

  function fitCamera(aspect) {
    const { w, zMin, zMax } = layout;
    const vfov = THREE.MathUtils.degToRad(camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const fov = Math.min(vfov, hfov);
    const dir = (aspect < 1 ? new THREE.Vector3(1, 1.15, 0.7) : new THREE.Vector3(0.3, 0.62, 1)).normalize();
    const target = new THREE.Vector3(0, MAX_H * 0.12, (zMin + zMax) / 2 + 0.4);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    const halfW = w / 2 + MARGIN + SLOPE;
    const corners = [];
    for (const x of [-halfW, halfW]) for (const y of [-PLINTH_H, MAX_H * 0.7]) for (const z of [zMin - SLOPE, zMax + SLOPE]) {
      corners.push(new THREE.Vector3(x, y, z));
    }
    const fits = (dist) => {
      camera.position.copy(target).addScaledVector(dir, dist);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      return corners.every((c) => {
        const p = c.clone().project(camera);
        return Math.abs(p.x) <= 0.95 && Math.abs(p.y) <= (aspect < 1 ? 0.95 : 0.86) && p.z < 1;
      });
    };
    const radius = Math.hypot(halfW, (zMax - zMin) / 2, MAX_H / 2);
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

  function resetCamera() {
    const rect = container.getBoundingClientRect();
    fitCamera(Math.max(0.3, rect.width / Math.max(1, rect.height)));
  }

  function resize() {
    if (capturing) return;
    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    const portrait = rect.width < rect.height;
    if (cities.length && portrait !== lastPortrait) resetCamera();
    lastPortrait = portrait;
  }

  function pick(clientX, clientY) {
    if (!cities.length || animating) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(cities.map((c) => c.mesh), false)[0];
    return hit ? { city: hit.object.userData.cityIndex, id: hit.instanceId } : null;
  }

  function colorOf(cityIdx, id) {
    const city = cities[cityIdx];
    return city.palette.levels[city.cells[id].level] || city.palette.levels[0];
  }

  function highlight(h) {
    if (hovered && h && hovered.city === h.city && hovered.id === h.id) return;
    if (hovered && cities[hovered.city]) {
      cities[hovered.city].mesh.setColorAt(hovered.id, tmpColor.set(colorOf(hovered.city, hovered.id)));
      cities[hovered.city].mesh.instanceColor.needsUpdate = true;
    }
    if (h) {
      cities[h.city].mesh.setColorAt(h.id, tmpColor.set(colorOf(h.city, h.id)).offsetHSL(0, 0, 0.18));
      cities[h.city].mesh.instanceColor.needsUpdate = true;
    }
    hovered = h;
  }

  function report(h, clientX, clientY) {
    highlight(h);
    const rect = container.getBoundingClientRect();
    onHover?.(h ? { cell: cities[h.city].cells[h.id], city: h.city } : null, clientX - rect.left, clientY - rect.top);
  }

  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || e.buttons) return;
    report(pick(e.clientX, e.clientY), e.clientX, e.clientY);
  });
  renderer.domElement.addEventListener('pointerleave', () => report(null, 0, 0));
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    report(pick(e.clientX, e.clientY), e.clientX, e.clientY);
  });
  controls.addEventListener('start', () => { if (hovered) report(null, 0, 0); });

  const ro = new ResizeObserver(() => resize());
  ro.observe(container);
  resize();

  const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
  io.observe(container);

  renderer.setAnimationLoop((now) => {
    if (capturing || !visible || document.hidden) return;
    if (animating) writeMatrices(now - animStart);
    controls.update();
    renderer.render(scene, camera);
  });

  /* ---------------- capture (video / GIF / images in other aspect ratios) ---------------- */
  let saved = null;

  function beginCapture(width, height) {
    if (capturing) return;
    capturing = true;
    if (animating) writeMatrices(1e9);
    highlight(null);
    saved = { pos: camera.position.clone(), target: controls.target.clone(), aspect: camera.aspect };
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    fitCamera(width / height);
    saved.orbit = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  }

  /** Renders one frame rotated by `turn` (0..1 = full circle) and returns the canvas. */
  function captureFrame(turn) {
    const s = saved.orbit.clone();
    s.theta += turn * Math.PI * 2;
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s));
    camera.lookAt(controls.target);
    renderer.render(scene, camera);
    return renderer.domElement;
  }

  function endCapture() {
    if (!capturing) return;
    renderer.setPixelRatio(basePixelRatio);
    capturing = false;
    const rect = container.getBoundingClientRect();
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = saved.aspect;
    camera.updateProjectionMatrix();
    camera.position.copy(saved.pos);
    controls.target.copy(saved.target);
    controls.update();
    saved = null;
  }

  /* ---------------- printable model for STL export ---------------- */
  async function buildPrintable() {
    if (!lastData) return null;
    const out = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial();
    const unit = new THREE.BoxGeometry(BOX, 1, BOX);
    unit.translate(0, 0.5, 0);
    for (const city of cities) {
      city.cells.forEach((c, i) => {
        const h = Math.max(0.35, city.targets[i]);
        const m = new THREE.Mesh(unit, mat);
        m.scale.set(1, h, 1);
        m.position.set(city.x0 + c.week * CELL, -0.01, city.z0 + c.dow * CELL);
        out.add(m);
      });
    }
    out.add(new THREE.Mesh(plinth.geometry, mat));
    group.traverse((o) => {
      if (o.userData.isText) {
        const t = new THREE.Mesh(o.geometry, mat);
        t.position.copy(o.position);
        t.rotation.copy(o.rotation);
        out.add(t);
      }
    });
    // Z-up and millimetres (one day = 2.5 mm)
    const root = new THREE.Group();
    out.rotation.x = Math.PI / 2;
    out.scale.setScalar(2.5);
    root.add(out);
    root.updateMatrixWorld(true);
    return root;
  }

  return {
    setData,
    setTheme,
    setCityPalettes,
    resetCamera,
    resize,
    setNight(on) { night = on; applyTheme(); },
    get night() { return night; },
    setAutoRotate(on) { controls.autoRotate = on; },
    get autoRotate() { return controls.autoRotate; },
    /** Finishes the grow-in animation, renders a frame and returns the canvas. */
    snapshot() {
      if (animating) writeMatrices(1e9);
      highlight(null);
      renderer.render(scene, camera);
      return renderer.domElement;
    },
    beginCapture,
    captureFrame,
    endCapture,
    buildPrintable,
    fontReady: () => loadFont().then(() => true, () => false),
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
