// Three.js ile 2.5D çizim. Oyun mantığı 2D kalır; burada yalnızca görüntü üretilir.
// Arayüz eski 2D Renderer ile aynıdır: draw(game, time), padLeft/padTop, worldToScreen, screenToWorld, overlayCtx.
// Oyun koordinatı (px, y aşağı) → dünya (1 birim = 1 karo, y yukarı, oyun düzlemi z = 0).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const U = 1 / T;
const wx = x => x * U;
const wy = y => -y * U;
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

const PALETTE = {
  skyTop: '#151436',
  skyBottom: '#3a2b6b',
  fog: 0x1f1c44,
  block: '#454b9a',
  blockCap: '#8b93ff',
  backPanel: '#34317a',
  door: '#e8b04e',
  exit: '#69db7c',
  key: '#ffcf3b',
};

const MAX_SPARKS = 500;
const MAX_CONFETTI = 260;
const MAX_FLOW = 240;

function canvasTexture(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Top dokusu: yuvarlandığı görülsün diye açık bir kuşak ve birkaç benek
function ballTexture(color) {
  return canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = color;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.fillRect(0, h * 0.44, w, h * 0.12);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.arc((i + 0.5) * w / 6, i % 2 ? h * 0.28 : h * 0.72, 7, 0, Math.PI * 2);
      g.fill();
    }
  });
}

class Renderer3D {
  constructor(canvas, overlay) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.overlayCtx = overlay.getContext('2d');
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;

    this.padLeft = 0;
    this.padTop = 70;
    this.padBottom = 30;   // telefonda alttaki tuş şeridi kadar
    this.tilt = 11;        // kameranın yukarıdan bakış açısı (derece); telefonda tam karşıdan
    this.game = null;
    this.lastTime = 0;
    this.fxT = -1;
    this.camPos = null;
    this.frameTimes = [];

    this.scene = new THREE.Scene();
    this.scene.background = canvasTexture(4, 256, (g, w, h) => {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, PALETTE.skyTop);
      grad.addColorStop(1, PALETTE.skyBottom);
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    });
    this.scene.fog = new THREE.Fog(PALETTE.fog, 34, 90);
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 300);

    this.setupLights();
    this.setupShared();
    this.setupStars();
    this.setupPools();

    this.levelGroup = new THREE.Group();
    this.scene.add(this.levelGroup);
    this.players = [];   // oyuncu sırasına göre 3D nesneler

    this.composer = new EffectComposer(this.gl);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.45, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    let saved = null;
    try { saved = localStorage.getItem('quality'); } catch (e) { /* yoksay */ }
    // Telefonda varsayılan Orta (ısınma ve pil); oyuncu seçtiyse onun seçimi
    const phone = typeof Touch !== 'undefined' && Touch.enabled;
    this.setQuality(['low', 'medium', 'high'].includes(saved) ? saved : phone ? 'medium' : 'high', false);

    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  // ---------- Kurulum ----------

  setupLights() {
    this.scene.add(new THREE.HemisphereLight(0xc9d0ff, 0x2f2758, 1.35));
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
    // Hafif arka ışık: topların kenarı parlasın
    const rim = new THREE.DirectionalLight(0x8fb6ff, 0.6);
    rim.position.set(-10, 6, -12);
    this.scene.add(rim);
  }

  setupShared() {
    const std = (color, extra) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.75, metalness: 0.0 }, extra));
    this.geo = {
      block: new RoundedBoxGeometry(1, 1, 1, 3, 0.09),
      cap: new RoundedBoxGeometry(1, 0.16, 1.04, 2, 0.06),   // tam bir karo genişliği: komşularıyla çakışıp titremesin
      door: new RoundedBoxGeometry(0.8, 1, 0.7, 2, 0.06),
      bar: new THREE.CylinderGeometry(0.045, 0.045, 1, 10),
      gatePanel: new THREE.BoxGeometry(0.82, 1, 0.08),
      buttonBase: new THREE.CylinderGeometry(0.44, 0.48, 0.08, 28),
      buttonCap: new THREE.CylinderGeometry(0.34, 0.36, 0.16, 28),
      crate: new RoundedBoxGeometry(2, 2, 0.95, 2, 0.06),
      ball: new THREE.SphereGeometry(1, 40, 28),
      eye: new THREE.SphereGeometry(1, 16, 12),
      ring: new THREE.RingGeometry(0.965, 1, 72),
      halo: new THREE.TorusGeometry(1, 0.05, 10, 48),
      spark: new THREE.IcosahedronGeometry(1, 0),
      confetti: new THREE.PlaneGeometry(1, 0.55),
      plank: new RoundedBoxGeometry(1.0, 0.18, 0.86, 2, 0.05),
      leverBase: new RoundedBoxGeometry(0.72, 0.2, 0.5, 2, 0.06),
      leverStick: new THREE.CylinderGeometry(0.05, 0.05, 0.72, 10),
      knob: new THREE.SphereGeometry(0.15, 18, 14),
      springBase: new RoundedBoxGeometry(0.82, 0.08, 0.6, 2, 0.03),
      coil: new THREE.TorusGeometry(0.26, 0.035, 8, 24),
      springPad: new RoundedBoxGeometry(0.8, 0.1, 0.62, 2, 0.04),
      rail: new THREE.BoxGeometry(0.06, 1, 0.06),
      railH: new THREE.BoxGeometry(1, 0.05, 0.05),
      stopPost: new RoundedBoxGeometry(0.16, 0.5, 0.3, 2, 0.04),
      metalCrate: new RoundedBoxGeometry(0.95, 0.95, 0.9, 2, 0.08),
      nutHead: new THREE.CylinderGeometry(0.17, 0.17, 0.09, 6),
      nutShaft: new THREE.CylinderGeometry(0.06, 0.06, 0.22, 10),
      rivet: new THREE.SphereGeometry(0.045, 8, 6),
      signBar: new THREE.BoxGeometry(0.42, 0.11, 0.06),
      poleField: new THREE.BoxGeometry(0.9, 1, 0.5),
    };
    this.mat = {
      block: std(PALETTE.block, { roughness: 0.82 }),
      cap: std(PALETTE.blockCap, { roughness: 0.6, emissive: '#3b3f9a', emissiveIntensity: 0.25 }),
      backPanel: std(PALETTE.backPanel, { roughness: 1, map: this.gridTexture(), emissive: '#1d1a4a', emissiveIntensity: 0.6 }),
      door: std(PALETTE.door, { roughness: 0.32, metalness: 0.55 }),
      keyhole: new THREE.MeshStandardMaterial({ color: '#3b2408', roughness: 0.9 }),
      buttonBase: std('#262849', { roughness: 0.6 }),
      crate: std('#ffffff', { roughness: 0.85, map: this.crateTexture() }),
      // Parlama (bloom) olmadan da yeşil kalsın: ışık saçma çok güçlü olursa renk beyaza kaçar
      exitFrame: std('#40c057', { emissive: '#2fb344', emissiveIntensity: 0.9, roughness: 0.4 }),
      exitInside: new THREE.MeshBasicMaterial({ color: '#0b0c20' }),
      key: std(PALETTE.key, { roughness: 0.25, metalness: 0.85, emissive: '#ff9d00', emissiveIntensity: 0.35 }),
      eyeWhite: std('#ffffff', { roughness: 0.3 }),
      pupil: std('#15142c', { roughness: 0.2 }),
      plank: std('#c27a4a', { roughness: 0.55, metalness: 0.35, emissive: '#5a2d14', emissiveIntensity: 0.25 }),
      metal: std('#8c90c8', { roughness: 0.35, metalness: 0.7 }),
      lift: std('#9a9ee0', { roughness: 0.45, metalness: 0.3, emissive: '#3b3f9a', emissiveIntensity: 0.35 }),
      rail: std('#6d71b8', { roughness: 0.5, metalness: 0.5 }),
      springPad: std('#ffa94d', { roughness: 0.4, emissive: '#ff922b', emissiveIntensity: 0.25 }),
      metalCrate: std('#9ea3c7', { roughness: 0.3, metalness: 0.8 }),
      nut: std('#eef0ff', { roughness: 0.25, metalness: 0.7, emissive: '#b9bdf5', emissiveIntensity: 0.8 }),
      sign: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
    };
    this.ballMats = PLAYER_COLORS.map(c => new THREE.MeshPhysicalMaterial({
      map: ballTexture(c), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15,
    }));
  }

  gridTexture() {
    const tex = canvasTexture(64, 64, (g, w, h) => {
      g.fillStyle = '#c9c7e8';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.roundRect(4, 4, w - 8, h - 8, 10);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.beginPath();
      g.arc(w * 0.5, h * 0.5, 3, 0, Math.PI * 2);
      g.fill();
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  crateTexture() {
    return canvasTexture(128, 128, (g, w, h) => {
      g.fillStyle = '#b8794a';
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,0.12)';
      for (let y = 0; y < h; y += 21) g.fillRect(0, y, w, 2);
      g.strokeStyle = '#6e4527';
      g.lineWidth = 12;
      g.strokeRect(6, 6, w - 12, h - 12);
      g.lineWidth = 10;
      g.beginPath();
      g.moveTo(12, 12); g.lineTo(w - 12, h - 12);
      g.moveTo(w - 12, 12); g.lineTo(12, h - 12);
      g.stroke();
    });
  }

  setupStars() {
    const n = 260, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 160;
      pos[i * 3 + 1] = (Math.random() - 0.3) * 90;
      pos[i * 3 + 2] = -30 - Math.random() * 40;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.25, transparent: true, opacity: 0.7, fog: false }));
    this.scene.add(this.stars);

    // Uzakta ay ve hâlesi
    const moon = new THREE.Mesh(new THREE.SphereGeometry(4, 32, 24), new THREE.MeshBasicMaterial({ color: '#fff3d6', fog: false }));
    moon.position.set(0, 0, -60);   // konumu bölüme göre updateBackdrop'ta
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: canvasTexture(128, 128, (g, w) => {
        const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
        r.addColorStop(0, 'rgba(255,236,200,0.55)');
        r.addColorStop(1, 'rgba(255,236,200,0)');
        g.fillStyle = r;
        g.fillRect(0, 0, w, w);
      }), transparent: true, depthWrite: false, fog: false,
    }));
    halo.scale.set(13, 13, 1);
    halo.material.opacity = 0.7;
    this.moon = moon;
    this.moonHalo = halo;
    this.backdrop = new THREE.Group();
    this.backdrop.add(halo, moon);

    // Dağ silüetleri: iki katman, uzaktaki daha soluk
    const hills = (z, color, height, seed) => {
      const shape = new THREE.Shape();
      shape.moveTo(-120, -40);
      for (let x = -120; x <= 120; x += 6) {
        const y = height * (0.55 + 0.25 * Math.sin(x * 0.045 + seed) + 0.2 * Math.sin(x * 0.11 + seed * 2));
        shape.lineTo(x, y - 20);
      }
      shape.lineTo(120, -40);
      const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color, fog: false }));
      m.position.z = z;
      this.backdrop.add(m);
    };
    hills(-70, '#2b2560', 16, 1.3);
    hills(-45, '#211c4c', 11, 4.1);
    this.scene.add(this.backdrop);

    // Bölümün içinde yavaşça süzülen ışık zerrecikleri
    const mn = 70, mpos = new Float32Array(mn * 3);
    this.motes = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({
      color: '#c9c3ff', size: 0.09, transparent: true, opacity: 0.65, depthWrite: false, toneMapped: false,
    }));
    this.motes.geometry.setAttribute('position', new THREE.BufferAttribute(mpos, 3));
    this.moteSeed = Array.from({ length: mn }, () => [Math.random(), Math.random(), Math.random() * 6.28, 0.2 + Math.random() * 0.5]);
    this.scene.add(this.motes);
  }

  updateBackdrop(game, t) {
    // Arka plan kameranın gerisinde kalsın diye bölümün merkezine göre konumlanır
    this.backdrop.position.set(game.cols / 2, -game.rows / 2, 0);
    // Ay: bölümün sağ üst köşesinin gerisinde, uzakta
    this.moon.position.set(game.cols * 0.9, game.rows * 1.1 + 6, -60);
    this.moonHalo.position.copy(this.moon.position);
    this.stars.position.set(game.cols / 2, -game.rows / 2, 0);
    const pos = this.motes.geometry.attributes.position;
    this.moteSeed.forEach(([u, v, ph, sp], i) => {
      pos.setXYZ(i,
        u * game.cols + Math.sin(t * sp + ph) * 0.6,
        -((v * game.rows + t * sp * 0.25) % game.rows),
        -0.3 + 0.5 * Math.sin(ph));
    });
    pos.needsUpdate = true;
  }

  // Parçacık havuzları: kıvılcım/toz, konfeti ve mıknatıs akış noktaları
  setupPools() {
    const pool = (geo, mat, max) => {
      const m = new THREE.InstancedMesh(geo, mat, max);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
      m.frustumCulled = false;
      m.count = 0;
      this.scene.add(m);
      return m;
    };
    const glow = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.95 });
    this.sparkMesh = pool(this.geo.spark, glow, MAX_SPARKS);
    this.confettiMesh = pool(this.geo.confetti, new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.6 }), MAX_CONFETTI);
    this.flowMesh = pool(this.geo.spark, glow, MAX_FLOW);
    this.sparks = [];
    this.confetti = [];
    this.tmpObj = new THREE.Object3D();
    this.tmpColor = new THREE.Color();
  }

  // ---------- Kalite ----------

  setQuality(q, persist = true) {
    this.quality = q;
    // Düşük: gölge ve parlama yok · Orta: gölge var, parlama yok · Yüksek: hepsi, keskin çözünürlük
    const shadows = q !== 'low';
    this.gl.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    this.gl.setPixelRatio(Math.min(devicePixelRatio || 1, { low: 1, medium: 1.5, high: 2 }[q]));
    this.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    if (persist) { try { localStorage.setItem('quality', q); } catch (e) { /* yoksay */ } }
    this.frameTimes = [];
    this.resize();
  }

  // Kare süresi uzun süre yüksek kalırsa kaliteyi kendiliğinden düşür
  watchPerformance(dt) {
    if (this.quality === 'low') return;
    // Sekme arka plandayken tarayıcı kareleri yavaşlatır; bunlar bilgisayarın yavaşlığı değildir
    if (document.visibilityState !== 'visible' || dt >= 0.09) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 180) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes = [];
    if (avg > 0.026) { this.autoLowered = true; this.setQuality(this.quality === 'high' ? 'medium' : 'low', false); }
  }

  resize() {
    this.w = innerWidth;
    this.h = innerHeight;
    this.gl.setSize(this.w, this.h, false);
    this.composer.setSize(this.w, this.h);
    this.composer.setPixelRatio(this.gl.getPixelRatio());
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.overlay.width = this.w * dpr;
    this.overlay.height = this.h * dpr;
    this.overlayDpr = dpr;
  }

  // ---------- Koordinat dönüşümleri (editör ve yazılar için) ----------

  worldToScreen(x, y, z = 0) {
    const v = new THREE.Vector3(wx(x), wy(y), z).project(this.camera);
    return { x: (v.x + 1) / 2 * this.w, y: (1 - v.y) / 2 * this.h };
  }

  screenToWorld(sx, sy) {
    const ndc = new THREE.Vector2(sx / this.w * 2 - 1, -(sy / this.h) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.plane, hit)) return { x: -1e9, y: -1e9 };
    return { x: hit.x * T, y: -hit.y * T };
  }

  // ---------- Bölüm sahnesi ----------

  buildLevel(game) {
    // Editörde her çizimde yeniden kurulur: paylaşılan geometri/malzeme dışındakileri bırak
    const sharedGeo = new Set(Object.values(this.geo)), sharedMat = new Set(Object.values(this.mat));
    for (const child of [...this.levelGroup.children]) {
      this.levelGroup.remove(child);
      child.traverse(o => {
        if (o.isInstancedMesh) o.dispose();
        if (o.geometry && !sharedGeo.has(o.geometry)) o.geometry.dispose();
        if (o.material && !sharedMat.has(o.material)) {
          if (o.material.map && o.material.map !== this.mat.backPanel.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
    }
    for (const o of this.players) if (o) o.lastX = null;
    this.game = game;
    this.levelKey = game.def;
    this.fxT = game.t;
    const W = game.cols, H = game.rows;

    // Arka panel: oda duvarı
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(W, H), this.mat.backPanel.clone());
    panel.material.map = this.mat.backPanel.map.clone();
    panel.material.map.repeat.set(W, H);
    panel.material.map.needsUpdate = true;
    panel.position.set(W / 2, -H / 2, -0.5);
    panel.receiveShadow = true;
    this.levelGroup.add(panel);

    // Duvar blokları ve üst kapakları
    const cells = [], caps = [];
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        if (!game.grid[r][c]) continue;
        if ('PN'.includes(game.def.map[r][c])) continue;   // sabit mıknatıslar ayrıca çizilir
        cells.push([c, r]);
        if (r > 0 && !game.grid[r - 1][c]) caps.push([c, r]);
      }
    }
    const inst = (geo, mat, list, place) => {
      const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
      m.count = list.length;
      list.forEach(([c, r], i) => { place(this.tmpObj, c, r); this.tmpObj.updateMatrix(); m.setMatrixAt(i, this.tmpObj.matrix); });
      m.castShadow = true;
      m.receiveShadow = true;
      this.levelGroup.add(m);
      return m;
    };
    this.tmpObj.rotation.set(0, 0, 0);
    this.tmpObj.scale.set(1, 1, 1);
    const blocks = inst(this.geo.block, this.mat.block, cells, (o, c, r) => o.position.set(c + 0.5, -r - 0.5, 0));
    cells.forEach(([c, r], i) => {
      const k = 0.92 + 0.12 * ((Math.sin(c * 12.9898 + r * 78.233) * 43758.5453) % 1 + 1) % 1;   // karo başına sabit rastgele
      blocks.setColorAt(i, this.tmpColor.setRGB(k, k, k * 1.03));
    });
    if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true;
    // Kenar şeridi bloğun üst yüzeyinden biraz yukarıda: aynı düzlemde iki yüzey titreşir (z-fighting)
    inst(this.geo.cap, this.mat.cap, caps, (o, c, r) => o.position.set(c + 0.5, -r - 0.05, 0));

    // Kilitli kapılar
    this.doorObjs = game.doors.map(d => {
      const g = new THREE.Group();
      const mid = d.cells.slice().sort((a, b) => a.r - b.r)[Math.floor(d.cells.length / 2)];
      for (const q of d.cells) {
        const m = new THREE.Mesh(this.geo.door, this.mat.door);
        m.position.set(q.c + 0.5, -q.r - 0.5, 0);
        m.castShadow = m.receiveShadow = true;
        g.add(m);
      }
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.1, 16), this.mat.keyhole);
      hole.rotation.x = Math.PI / 2;
      hole.position.set(mid.c + 0.5, -mid.r - 0.42, 0.36);
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.1), this.mat.keyhole);
      slot.position.set(mid.c + 0.5, -mid.r - 0.58, 0.36);
      g.add(hole, slot);
      this.levelGroup.add(g);
      return { d, g, vis: d.open ? 0 : 1 };
    });

    // Düğmeye bağlı kapaklar
    this.gateObjs = game.gates.map(gate => {
      const col = CHANNEL_COLORS[gate.channel];
      const barMat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.6, roughness: 0.3 });
      const panelMat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.3, transparent: true, opacity: 0.22, roughness: 0.2 });
      const cellsObj = gate.cells.map(q => {
        const g = new THREE.Group();
        g.position.set(q.c + 0.5, -q.r - 1, 0);   // hücrenin tabanı: kapanırken aşağı doğru büzülür
        const p = new THREE.Mesh(this.geo.gatePanel, panelMat);
        p.position.y = 0.5;
        g.add(p);
        // Ters kapak yatay çubuklu: kanalı açılınca kapanır
        for (const d of [-0.26, 0, 0.26]) {
          const b = new THREE.Mesh(this.geo.bar, barMat);
          if (gate.inverse) { b.rotation.z = Math.PI / 2; b.scale.y = 0.8; b.position.set(0, 0.5 + d, 0); }
          else b.position.set(d, 0.5, 0);
          b.castShadow = true;
          g.add(b);
        }
        this.levelGroup.add(g);
        return g;
      });
      return { gate, cells: cellsObj, vis: gate.open ? 0 : 1 };
    });

    // Düğmeler
    this.buttonObjs = game.buttons.map(b => {
      const col = CHANNEL_COLORS[b.channel];
      const g = new THREE.Group();
      g.position.set(wx(b.x + b.w / 2), wy(b.y + b.h), 0);
      const base = new THREE.Mesh(this.geo.buttonBase, this.mat.buttonBase);
      base.position.y = 0.04;
      const capMat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.2, roughness: 0.35 });
      const cap = new THREE.Mesh(this.geo.buttonCap, capMat);
      cap.castShadow = true;
      g.add(base, cap);
      this.levelGroup.add(g);
      return { b, cap, capMat, press: b.pressed ? 1 : 0 };
    });

    // Tek yönlü platformlar: karonun üst kenarında ince paslı tahta
    const planks = [];
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (game.oneway[r][c]) planks.push([c, r]);
    if (planks.length) inst(this.geo.plank, this.mat.plank, planks, (o, c, r) => o.position.set(c + 0.5, -r - 0.09, 0));

    // Şalterler: kanal renginde topuzlu kol; açıkken sağa, kapalıyken sola yatar
    this.leverObjs = game.levers.map(l => {
      const col = CHANNEL_COLORS[l.channel];
      const g = new THREE.Group();
      g.position.set(wx(l.x + T / 2), wy(l.y + T), 0);
      const base = new THREE.Mesh(this.geo.leverBase, this.mat.metal);
      base.position.y = 0.1;
      base.castShadow = base.receiveShadow = true;
      const arm = new THREE.Group();
      arm.position.y = 0.18;
      const stick = new THREE.Mesh(this.geo.leverStick, this.mat.metal);
      stick.position.y = 0.36;
      const knobMat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.4, roughness: 0.3 });
      const knob = new THREE.Mesh(this.geo.knob, knobMat);
      knob.position.y = 0.74;
      stick.castShadow = knob.castShadow = true;
      arm.add(stick, knob);
      g.add(base, arm);
      this.levelGroup.add(g);
      const on = !!game.switches[l.channel];
      return { l, arm, knobMat, angle: on ? -0.6 : 0.6 };
    });

    // Asansörler: kanal renginde şeritli platform ve iki yanında raylar
    this.liftObjs = game.lifts.map(L => {
      const w = wx(L.w), col = CHANNEL_COLORS[L.channel];
      const g = new THREE.Group();
      const body = new THREE.Mesh(new RoundedBoxGeometry(w, 1, 0.9, 2, 0.08), this.mat.lift);
      body.castShadow = body.receiveShadow = true;
      const stripMat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.2, roughness: 0.3 });
      const strip = new THREE.Mesh(new THREE.BoxGeometry(w - 0.16, 0.08, 0.04), stripMat);
      strip.position.set(0, 0.36, 0.46);
      g.add(body, strip);
      this.levelGroup.add(g);
      // Raylar: en üst noktadan dinlenme yerinin altına kadar
      const top = wy(L.topY), bottom = wy(L.oy + L.h), len = top - bottom;
      for (const sx of [-1, 1]) {
        const rail = new THREE.Mesh(this.geo.rail, this.mat.rail);
        rail.scale.y = len;
        rail.position.set(wx(L.x + L.w / 2) + sx * (w / 2 + 0.05), bottom + len / 2, -0.38);
        this.levelGroup.add(rail);
      }
      return { L, g, stripMat };
    });

    // Sabit mıknatıslar: kutup renginde blok, önünde + / − işareti; oyuncuyu etkilerken parlar
    this.fixedObjs = game.fixed.map(f => {
      const col = POLE_COLORS[f.pol];
      const mat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.25, roughness: 0.45, metalness: 0.3 });
      const g = new THREE.Group();
      g.position.set(f.c + 0.5, -f.r - 0.5, 0);
      const block = new THREE.Mesh(this.geo.block, mat);
      block.castShadow = block.receiveShadow = true;
      const h = new THREE.Mesh(this.geo.signBar, this.mat.sign);
      h.position.z = 0.5;
      g.add(block, h);
      if (f.pol > 0) { const v = new THREE.Mesh(this.geo.signBar, this.mat.sign); v.rotation.z = Math.PI / 2; v.position.z = 0.5; g.add(v); }
      this.levelGroup.add(g);
      return { f, mat, glow: 0 };
    });

    // Kutup kapıları: kutup renginde yarı saydam alan; yalnızca aynı kutuptaki geçer
    this.poleObjs = [];
    for (const [key, pol] of game.poleCells) {
      const r = Math.floor(key / W), c = key % W, col = POLE_COLORS[pol];
      const mat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.9, transparent: true, opacity: 0.4, roughness: 0.2, depthWrite: false });
      const m = new THREE.Mesh(this.geo.poleField, mat);
      m.position.set(c + 0.5, -r - 0.5, 0);
      const sign = new THREE.Mesh(this.geo.signBar, mat.clone());
      sign.material.opacity = 0.75;
      sign.scale.setScalar(0.7);
      sign.position.set(c + 0.5, -r - 0.5, 0.27);
      this.levelGroup.add(m, sign);
      if (pol > 0) { const v = sign.clone(); v.rotation.z = Math.PI / 2; this.levelGroup.add(v); }
      this.poleObjs.push({ mat });
    }

    // Vidalar: dönen gümüş cıvata
    this.screwObjs = game.screws.map(sc => {
      const g = new THREE.Group();
      const head = new THREE.Mesh(this.geo.nutHead, this.mat.nut);
      const shaft = new THREE.Mesh(this.geo.nutShaft, this.mat.nut);
      shaft.position.y = -0.15;
      head.castShadow = true;
      g.add(head, shaft);
      g.position.set(wx(sc.x + sc.w / 2), wy(sc.y + sc.h / 2), 0.1);
      g.scale.setScalar(1.7);
      this.levelGroup.add(g);
      return { sc, g };
    });

    // Gezgin platformlar: ince metal platform, altında gidip geldiği ray ve uçlarda durdurucular
    this.moverObjs = game.movers.map(M => {
      const w = wx(M.w);
      const body = new THREE.Mesh(new RoundedBoxGeometry(w, wx(M.h), 0.86, 2, 0.05), this.mat.lift);
      body.castShadow = body.receiveShadow = true;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(w - 0.12, 0.05, 0.03), this.mat.springPad);
      stripe.position.set(0, 0, 0.44);
      const g = new THREE.Group();
      g.add(body, stripe);
      this.levelGroup.add(g);
      const rail = new THREE.Mesh(this.geo.railH, this.mat.rail);
      const x0 = wx(M.minX), x1 = wx(M.maxX + M.w);
      rail.scale.x = x1 - x0;
      rail.position.set((x0 + x1) / 2, wy(M.y + M.h / 2), -0.36);
      this.levelGroup.add(rail);
      return { M, g };
    });
    const stops = [];
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (game.def.map[r][c] === ':') stops.push([c, r]);
    if (stops.length) inst(this.geo.stopPost, this.mat.springPad, stops, (o, c, r) => o.position.set(c + 0.5, -r - 0.25, -0.2));

    // Yaylar: taban, yay halkaları ve turuncu pedal
    this.springObjs = game.springs.map(sp => {
      const g = new THREE.Group();
      g.position.set(wx(sp.x + sp.w / 2), wy(sp.y + sp.h), 0);
      const base = new THREE.Mesh(this.geo.springBase, this.mat.metal);
      base.position.y = 0.04;
      const coils = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const c = new THREE.Mesh(this.geo.coil, this.mat.metal);
        c.rotation.x = Math.PI / 2;
        c.position.y = 0.1 + i * 0.09;
        coils.add(c);
      }
      const pad = new THREE.Mesh(this.geo.springPad, this.mat.springPad);
      pad.castShadow = base.receiveShadow = true;
      g.add(base, coils, pad);
      this.levelGroup.add(g);
      return { sp, coils, pad };
    });

    // Çıkış kapısı
    this.exitObj = null;
    if (game.exit) {
      const e = game.exit, w = wx(e.w), h = e.h * U;
      const g = new THREE.Group();
      g.position.set(wx(e.x + e.w / 2), wy(e.y + e.h), 0);
      const r = w / 2 - 0.06;
      const pillarH = h - r - 0.06;
      for (const sx of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, pillarH, 0.32), this.mat.exitFrame);
        p.position.set(sx * r, pillarH / 2, 0);
        g.add(p);
      }
      const arch = new THREE.Mesh(new THREE.TorusGeometry(r, 0.07, 12, 32, Math.PI), this.mat.exitFrame);
      arch.position.y = pillarH;
      g.add(arch);
      const inside = new THREE.Mesh(new THREE.PlaneGeometry(2 * r, pillarH), this.mat.exitInside);
      inside.position.set(0, pillarH / 2, -0.1);
      const top = new THREE.Mesh(new THREE.CircleGeometry(r, 32, 0, Math.PI), this.mat.exitInside);
      top.position.set(0, pillarH, -0.1);
      g.add(inside, top);
      const glow = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: PALETTE.exit, transparent: true, opacity: 0.25, toneMapped: false, depthWrite: false }));
      glow.rotation.x = -Math.PI / 2;
      glow.scale.set(w * 0.9, w * 0.45, 1);
      glow.position.y = 0.02;
      g.add(glow);
      const light = new THREE.PointLight(PALETTE.exit, 2.5, 5, 1.5);
      light.position.set(0, h * 0.5, 0.8);
      g.add(light);
      this.levelGroup.add(g);
      this.exitObj = { g, glow, light };
    }

    // Ağır kutular ve anahtarlar (konumları her karede güncellenir)
    this.boxObjs = game.boxes.map(b => {
      if (!b.metal) {
        const m = new THREE.Mesh(this.geo.crate, this.mat.crate);
        m.castShadow = m.receiveShadow = true;
        this.levelGroup.add(m);
        return m;
      }
      // Metal sandık: perçinli parlak kutu
      const g = new THREE.Group();
      const body = new THREE.Mesh(this.geo.metalCrate, this.mat.metalCrate);
      body.castShadow = body.receiveShadow = true;
      g.add(body);
      for (const [x, y] of [[-0.36, -0.36], [0.36, -0.36], [-0.36, 0.36], [0.36, 0.36]]) {
        const rv = new THREE.Mesh(this.geo.rivet, this.mat.rail);
        rv.position.set(x, y, 0.46);
        g.add(rv);
      }
      g.scale.setScalar(PHYS.crateSize / T);
      this.levelGroup.add(g);
      return g;
    });
    this.keyObjs = game.keys.map(k => {
      const g = new THREE.Group();
      if (k.compass) {
        // Pusula parçası: kırmızı uçlu, parlayan iğne parçası
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.42, 4), new THREE.MeshStandardMaterial({ color: '#ff6b6b', emissive: '#ff6b6b', emissiveIntensity: 1.2, roughness: 0.3, metalness: 0.4 }));
        tip.position.y = 0.21;
        const tail = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.42, 4), new THREE.MeshStandardMaterial({ color: '#f1f3ff', emissive: '#b9bce0', emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.4 }));
        tail.rotation.z = Math.PI;
        tail.position.y = -0.21;
        const hub = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), this.mat.key);
        const light = new THREE.PointLight('#ff8787', 1.6, 3, 1.5);
        g.add(tip, tail, hub, light);
        g.rotation.z = -0.5;
        g.scale.setScalar(1.6);
        this.levelGroup.add(g);
        return g;
      }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.045, 10, 24), this.mat.key);
      ring.position.x = -0.12;
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.07), this.mat.key);
      shaft.position.x = 0.12;
      const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.06), this.mat.key);
      t1.position.set(0.2, -0.08, 0);
      const t2 = t1.clone();
      t2.position.x = 0.3;
      for (const m of [ring, shaft, t1, t2]) m.castShadow = true;
      g.add(ring, shaft, t1, t2);
      g.scale.setScalar(1.7);
      this.levelGroup.add(g);
      return g;
    });

    // Gölge kamerası bölümü kapsasın
    const s = this.sun.shadow.camera, half = Math.max(W, H) / 2 + 3;
    s.left = -half; s.right = half; s.top = half; s.bottom = -half;
    s.near = 1; s.far = 80;
    s.updateProjectionMatrix();
    this.sun.position.set(W / 2 - 8, -H / 2 + 14, 22);
    this.sun.target.position.set(W / 2, -H / 2, 0);
  }

  // ---------- Oyuncular ----------

  playerObj(i) {
    if (this.players[i]) return this.players[i];
    const r = PHYS.playerSize / 2 * U;
    const root = new THREE.Group();     // topun tabanı
    const body = new THREE.Group();     // esneme/basılma
    root.add(body);
    const ball = new THREE.Mesh(this.geo.ball, this.ballMats[i % this.ballMats.length]);
    ball.scale.setScalar(r);
    ball.position.y = r;
    ball.castShadow = true;
    body.add(ball);
    // Yüz dönmez: gözler topun önünde ayrı bir grupta
    const face = new THREE.Group();
    face.position.set(0, r * 1.15, r * 0.9);
    body.add(face);
    const eyes = [-1, 1].map(side => {
      const white = new THREE.Mesh(this.geo.eye, this.mat.eyeWhite);
      white.scale.set(r * 0.24, r * 0.3, r * 0.16);
      white.position.x = side * r * 0.33;
      const pupil = new THREE.Mesh(this.geo.eye, this.mat.pupil);
      pupil.scale.set(r * 0.12, r * 0.14, r * 0.08);
      pupil.position.z = 0.75;   // göz beyazının yerel biriminde: ön yüzeyine yakın
      white.add(pupil);
      pupil.scale.divide(white.scale);   // göz beyazının ölçeğinden bağımsız
      face.add(white);
      return { white, pupil };
    });
    const halo = new THREE.Mesh(this.geo.halo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true }));
    halo.scale.setScalar(r * 1.35);
    halo.position.y = r;
    halo.visible = false;
    body.add(halo);
    const waves = [0, 1, 2].map(() => {
      const m = new THREE.Mesh(this.geo.ring, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false;
      this.scene.add(m);
      return m;
    });
    this.scene.add(root);
    const o = { root, body, ball, face, eyes, halo, waves, r, roll: 0, lastX: null, blinkT: Math.random() * 3 };
    this.players[i] = o;
    return o;
  }

  updatePlayers(game, t, dt) {
    const n = game.players.length;
    for (let i = 0; i < this.players.length; i++) {
      if (i >= n) { this.players[i].root.visible = false; for (const w of this.players[i].waves) w.visible = false; }
    }
    const inside = game.players.filter(p => p.inExit);
    game.players.forEach((p, i) => {
      const o = this.playerObj(i);
      o.root.visible = true;
      o.root.scale.setScalar(1);
      for (const w of o.waves) w.visible = false;
      if (p.inExit) {
        // Kapıya girenler kemerin içinde küçülüp mutlu gözlerle zıplar (bölüm bitince daha coşkulu)
        o.lastX = null;
        o.halo.visible = false;
        if (!game.exit) { o.root.visible = false; return; }
        const k = inside.indexOf(p), e = game.exit;
        const hop = Math.abs(Math.sin(t * (game.done ? 9 : 4) + k * 1.3)) * (game.done ? 0.45 : 0.12);
        o.root.position.set(wx(e.x + e.w / 2) + (k % 2 ? 0.3 : -0.3), wy(e.y + e.h) + Math.floor(k / 2) * 0.55 + hop, -0.05);
        o.root.scale.setScalar(0.72);
        o.body.scale.set(1, 1, 1);
        for (const eye of o.eyes) { eye.white.scale.y = o.r * 0.3 * 0.25; eye.pupil.position.set(0, 0.4, 0.75); }
        o.face.position.x = 0;
        return;
      }
      const cx = wx(p.x + p.w / 2), by = wy(p.y + p.h);
      o.root.position.set(cx, by, 0);
      // Yuvarlanma: x'teki değişim kadar döner (yerelde de online'da da çalışır)
      if (o.lastX !== null) o.roll -= (cx - o.lastX) / o.r;
      o.lastX = cx;
      o.ball.rotation.z = o.roll;
      const s = p.squash || 0;
      o.body.scale.set(1 + s, 1 - s, 1 + s * 0.5);
      // Gözler: bakış yönü, kırpma, ifade
      const surprised = (p.magT || 0) > 0 && Math.abs(p.vy) > 450 && !p.magnetOn;
      o.blinkT -= dt;
      if (o.blinkT < -0.12) o.blinkT = 2 + Math.random() * 3;
      const blink = o.blinkT < 0;
      const look = (p.facing || 1) * o.r * 0.07;
      for (const e of o.eyes) {
        const open = blink ? 0.12 : p.magnetOn ? 0.55 : surprised ? 1.3 : 1;
        e.white.scale.y = o.r * 0.3 * open;
        e.pupil.position.x = look / e.white.scale.x;
        e.pupil.position.y = (surprised ? 0.15 : -Math.max(-0.3, Math.min(0.3, p.vy / 1500)));
      }
      o.face.position.x = (p.facing || 1) * o.r * 0.08;
      // Mıknatıs: topun etrafında halka ve yayılan dalgalar
      const pole = POLE_COLORS[p.pol];
      o.halo.visible = !!(game.magnet && p.magnetOn);
      if (o.halo.visible) {
        o.halo.material.color.set(pole);
        o.halo.rotation.z = t * 2;
        const R = PHYS.magnetRange * U;
        o.waves.forEach((w, k) => {
          const f = (t * 0.9 + k / 3) % 1;
          w.visible = true;
          w.material.color.set(pole);
          w.material.opacity = 0.45 * (1 - f);
          w.scale.setScalar(0.5 + f * (R - 0.5));
          w.position.set(cx, by + o.r, 0.56);   // blokların ön yüzünün önünde
        });
      }
    });
  }

  // Mıknatısın etkilediklerine doğru akan ışık noktaları: iterken dışa, çekerken içe
  updateFlow(game, t) {
    let n = 0;
    for (const p of game.players) {
      if (!p.magnetOn || p.inExit || !p.affects) continue;
      const hx = wx(p.x + p.w / 2), hy = wy(p.y + p.h / 2);
      this.tmpColor.set(POLE_COLORS[p.pol]);
      for (const a of p.affects) {
        const ox = wx(a.o.x + a.o.w / 2), oy = wy(a.o.y + a.o.h / 2);
        for (let k = 0; k < 7 && n < MAX_FLOW; k++) {
          let f = (t * 1.4 + k / 7) % 1;
          if (!a.repel) f = 1 - f;
          this.tmpObj.position.set(hx + (ox - hx) * f, hy + (oy - hy) * f, 0.3);
          this.tmpObj.scale.setScalar(0.05 + 0.04 * Math.sin(f * Math.PI));
          this.tmpObj.rotation.set(0, 0, 0);
          this.tmpObj.updateMatrix();
          this.flowMesh.setMatrixAt(n, this.tmpObj.matrix);
          this.flowMesh.setColorAt(n, this.tmpColor);
          n++;
        }
      }
    }
    this.flowMesh.count = n;
    this.flowMesh.instanceMatrix.needsUpdate = true;
    if (this.flowMesh.instanceColor) this.flowMesh.instanceColor.needsUpdate = true;
  }

  // ---------- Parçacıklar ----------

  burst(x, y, count, color, opts = {}) {
    for (let i = 0; i < count && this.sparks.length < MAX_SPARKS; i++) {
      const a = opts.up ? Math.PI / 2 + (Math.random() - 0.5) * 1.6 : Math.random() * Math.PI * 2;
      const sp = (opts.speed || 3) * (0.4 + Math.random() * 0.8);
      this.sparks.push({
        x, y, z: (Math.random() - 0.5) * 0.5,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: (Math.random() - 0.5) * sp * 0.4,
        g: opts.gravity ?? 6, life: 0, max: (opts.life || 0.6) * (0.6 + Math.random() * 0.6),
        size: (opts.size || 0.07) * (0.6 + Math.random() * 0.8), color: new THREE.Color(color),
      });
    }
  }

  confettiBurst(x, y) {
    const colors = PLAYER_COLORS.concat(['#ffffff', '#b197fc']);
    for (let i = 0; i < 160 && this.confetti.length < MAX_CONFETTI; i++) {
      const a = Math.PI / 2 + (Math.random() - 0.5) * 2.2, sp = 5 + Math.random() * 6;
      this.confetti.push({
        x, y, z: (Math.random() - 0.5) * 1.5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: (Math.random() - 0.5) * 3,
        rx: Math.random() * 6, ry: Math.random() * 6, spin: (Math.random() - 0.5) * 14,
        life: 0, max: 2.2 + Math.random() * 1.2, color: new THREE.Color(colors[i % colors.length]),
      });
    }
  }

  spawnEffects(game) {
    for (const e of game.effects) {
      if (e.t <= this.fxT) continue;
      const x = wx(e.x), y = wy(e.y);
      switch (e.type) {
        case 'jump': this.burst(x, y, 7, '#e8e6ff', { speed: 1.8, gravity: 2, life: 0.35, size: 0.06 }); break;
        case 'land': this.burst(x, y, 9, '#d8d4ff', { speed: 2.2, gravity: 2, life: 0.35, size: 0.06 }); break;
        case 'pickup': this.burst(x, y, 16, PALETTE.key, { speed: 3, gravity: 1, life: 0.6 }); break;
        case 'unlock': this.burst(x, y, 40, PALETTE.key, { speed: 5, gravity: 3, life: 0.9, size: 0.09 }); break;
        case 'lever': this.burst(x, y, 14, e.color || '#fff', { speed: 2.4, gravity: 1, life: 0.45, up: true }); break;
        case 'screw': this.burst(x, y, 16, '#e3e6fb', { speed: 3, gravity: 0, life: 0.5 }); break;
        case 'spring': this.burst(x, y, 12, '#ffc078', { speed: 2.6, gravity: 2, life: 0.4, up: true }); break;
        case 'click': this.burst(x, y, 12, e.color || '#fff', { speed: 2.5, gravity: 1, life: 0.45, up: true }); break;
        case 'swap': this.burst(x, y, 18, e.color || '#fff', { speed: 3, gravity: 0, life: 0.4 }); break;
        case 'enter': this.burst(x, y, 20, PALETTE.exit, { speed: 2.5, gravity: -2, life: 0.8, up: true }); break;
        case 'respawn': this.burst(x, y, 18, e.color || '#fff', { speed: 2.5, gravity: 0, life: 0.6 }); break;
        case 'win': this.confettiBurst(x, y); this.burst(x, y, 50, PALETTE.exit, { speed: 6, gravity: 2, life: 1.2, size: 0.1 }); break;
      }
    }
    if (game.effects.length) this.fxT = Math.max(this.fxT, ...game.effects.map(e => e.t));
  }

  updateParticles(dt) {
    let n = 0;
    this.sparks = this.sparks.filter(p => (p.life += dt) < p.max);
    for (const p of this.sparks) {
      p.vy -= p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const k = 1 - p.life / p.max;
      this.tmpObj.position.set(p.x, p.y, p.z);
      this.tmpObj.rotation.set(p.life * 4, p.life * 3, 0);
      this.tmpObj.scale.setScalar(p.size * k);
      this.tmpObj.updateMatrix();
      this.sparkMesh.setMatrixAt(n, this.tmpObj.matrix);
      this.sparkMesh.setColorAt(n, p.color);
      n++;
    }
    this.sparkMesh.count = n;
    this.sparkMesh.instanceMatrix.needsUpdate = true;
    if (this.sparkMesh.instanceColor) this.sparkMesh.instanceColor.needsUpdate = true;

    n = 0;
    this.confetti = this.confetti.filter(p => (p.life += dt) < p.max);
    for (const p of this.confetti) {
      p.vy -= 9 * dt;
      p.vx *= 1 - dt * 0.8; p.vy *= 1 - dt * 0.4;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rx += p.spin * dt; p.ry += p.spin * 0.7 * dt;
      this.tmpObj.position.set(p.x, p.y, p.z);
      this.tmpObj.rotation.set(p.rx, p.ry, p.rx * 0.5);
      this.tmpObj.scale.setScalar(0.16 * Math.min(1, (p.max - p.life) * 2));
      this.tmpObj.updateMatrix();
      this.confettiMesh.setMatrixAt(n, this.tmpObj.matrix);
      this.confettiMesh.setColorAt(n, p.color);
      n++;
    }
    this.confettiMesh.count = n;
    this.confettiMesh.instanceMatrix.needsUpdate = true;
    if (this.confettiMesh.instanceColor) this.confettiMesh.instanceColor.needsUpdate = true;
  }

  // ---------- Kamera ----------

  // Bütün bölümü HUD/editör/tuş paylarının dışında kalan alana sığdırır; hafif yukarıdan bakar
  updateCamera(game, t, dt) {
    const W = game.cols, H = game.rows;
    const padTop = this.padTop ?? 70, padLeft = this.padLeft || 0, pad = 30, padBottom = this.padBottom ?? pad;
    const aw = Math.max(100, this.w - padLeft - pad * 2), ah = Math.max(100, this.h - padTop - padBottom);
    // Görünür alanın merkezini tuvalin merkezine göre kaydır
    const offX = -(padLeft + (this.w - padLeft) / 2 - this.w / 2);
    const offY = -(padTop + (this.h - padTop - padBottom) / 2 - this.h / 2);
    this.camera.setViewOffset(this.w, this.h, offX, offY, this.w, this.h);
    const ppu = Math.min(aw / W, ah / (H * (this.tilt === 0 ? 1.02 : 1.08)), 1.6 * T);   // birim başına piksel (eğiklik için biraz pay)
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const dist = this.h / (2 * Math.tan(fov / 2) * ppu);
    const tilt = THREE.MathUtils.degToRad(this.tilt ?? 11);
    const cx = W / 2 + Math.sin(t * 0.21) * 0.12, cy = -H / 2 + Math.sin(t * 0.17) * 0.08;
    const target = new THREE.Vector3(cx, cy + dist * Math.sin(tilt), dist * Math.cos(tilt));
    if (!this.camPos || this.camPos.distanceTo(target) > 40) this.camPos = target.clone();
    else this.camPos.lerp(target, Math.min(1, dt * 4));
    this.camera.position.copy(this.camPos);
    // Sis kameranın uzaklığına göre: bölüm her pencere boyutunda net kalır, yalnızca arkası sislenir
    this.scene.fog.near = dist + 8;
    this.scene.fog.far = dist + 70;
    this.camera.lookAt(this.camPos.x, this.camPos.y - dist * Math.sin(tilt), 0);
    this.camera.updateMatrixWorld();
  }

  // ---------- Ana çizim ----------

  draw(game, time) {
    const dt = Math.min(0.1, Math.max(0, time - (this.lastTime || time)));
    this.lastTime = time;
    if (!game) return;
    if (game !== this.game || game.def !== this.levelKey || !this.doorObjs) this.buildLevel(game);
    const t = time;

    // Kapılar gömülür, kapaklar zemine iner, düğmeler çöker
    for (const o of this.doorObjs) {
      o.vis += ((o.d.open ? 0 : 1) - o.vis) * Math.min(1, dt * 5);
      o.g.visible = o.vis > 0.02;
      o.g.position.y = -(1 - o.vis) * o.d.cells.length;   // bloğun içine gömülür
    }
    for (const o of this.gateObjs) {
      o.vis += ((o.gate.open ? 0 : 1) - o.vis) * Math.min(1, dt * 9);
      for (const g of o.cells) g.scale.y = Math.max(0.04, o.vis);
    }
    for (const o of this.buttonObjs) {
      o.press += ((o.b.pressed ? 1 : 0) - o.press) * Math.min(1, dt * 14);
      o.cap.position.y = 0.16 - o.press * 0.09;
      o.capMat.emissiveIntensity = 0.2 + o.press * 1.6;
    }
    for (const o of this.leverObjs) {
      const target = game.switches[o.l.channel] ? -0.6 : 0.6;
      o.angle += (target - o.angle) * Math.min(1, dt * 12);
      o.arm.rotation.z = o.angle;
      o.knobMat.emissiveIntensity = game.switches[o.l.channel] ? 1.4 : 0.35;
    }
    for (const o of this.liftObjs) {
      o.g.position.set(wx(o.L.x + o.L.w / 2), wy(o.L.y + o.L.h / 2), 0);
      o.stripMat.emissiveIntensity = game.channelOn(o.L.channel) ? 1.8 : 0.5;
    }
    for (const o of this.fixedObjs) {
      const on = game.players.some(p => p.fixedOn && p.fixedOn.includes(o.f));
      o.glow += ((on ? 1 : 0) - o.glow) * Math.min(1, dt * 8);
      o.mat.emissiveIntensity = 0.25 + o.glow * (0.9 + 0.3 * Math.sin(t * 10));
    }
    for (const o of this.poleObjs) o.mat.opacity = 0.4 + 0.08 * Math.sin(t * 3);
    this.screwObjs.forEach((o, i) => {
      o.g.visible = !o.sc.got;
      o.g.rotation.set(0.5, t * 2.4 + i, 0.35);
      o.g.position.y = wy(o.sc.y + o.sc.h / 2) + Math.sin(t * 2.5 + i) * 0.05;
    });
    for (const o of this.moverObjs) o.g.position.set(wx(o.M.x + o.M.w / 2), wy(o.M.y + o.M.h / 2), 0);
    for (const o of this.springObjs) {
      // Fırlatınca önce basılır, sonra sönen bir sekmeyle açılır
      const since = game.t - o.sp.t;
      const k = since >= 0 && since < 0.6 ? Math.exp(-since * 7) * Math.cos(since * 26) : 0;
      const h = Math.max(0.35, 1 + k * 0.9);
      o.coils.scale.y = h;
      o.pad.position.y = 0.1 + 0.27 * h + 0.06;
    }
    game.boxes.forEach((b, i) => {
      const m = this.boxObjs[i];
      if (m) m.position.set(wx(b.x + b.w / 2), wy(b.y + b.h / 2), 0);
    });
    game.keys.forEach((k, i) => {
      const g = this.keyObjs[i];
      if (!g) return;
      g.visible = !k.used;
      g.position.set(wx(k.x + k.w / 2), wy(k.y + k.h / 2) + (k.holder ? 0 : Math.sin(t * 3 + i) * 0.04), 0.1);
      g.rotation.y = t * 2.2;
      if (k.compass) g.rotation.z = -0.5 + Math.sin(t * 5) * 0.15;   // iğne titrer
    });
    if (this.exitObj) {
      const pulse = 0.8 + 0.2 * Math.sin(t * 3);
      this.exitObj.glow.material.opacity = 0.22 * pulse;
      this.exitObj.light.intensity = 2.2 * pulse;
    }

    this.updatePlayers(game, t, dt);
    this.updateFlow(game, t);
    this.spawnEffects(game);
    this.updateParticles(dt);
    this.stars.material.opacity = 0.55 + 0.15 * Math.sin(t * 0.7);
    this.updateBackdrop(game, t);
    this.updateCamera(game, t, dt);

    if (this.quality === 'high') this.composer.render(dt);
    else this.gl.render(this.scene, this.camera);
    this.watchPerformance(dt);
    this.drawLabels(game);
  }

  // ---------- Yazı katmanı: adlar, kutup rozetleri, kapı sayacı, kutu noktaları ----------

  drawLabels(game) {
    const ctx = this.overlayCtx, d = this.overlayDpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    const a = this.worldToScreen(0, 0), b = this.worldToScreen(T, 0);
    const ppu = Math.hypot(b.x - a.x, b.y - a.y);   // ekranda bir karo kaç piksel
    const fs = Math.max(11, Math.min(17, ppu * 0.36));
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';

    if (game.exit && game.players.length && !game.isDemo) {
      const e = game.exit, inside = game.players.filter(p => p.inExit).length;
      const s = this.worldToScreen(e.x + e.w / 2, e.y - 4, 0.3);
      ctx.font = `800 ${fs + 1}px ${FONT_STACK}`;
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(15,14,40,0.85)';
      ctx.strokeText(`${inside}/${game.players.length}`, s.x, s.y);
      ctx.fillStyle = '#fff';
      ctx.fillText(`${inside}/${game.players.length}`, s.x, s.y);
    }

    for (const box of game.boxes) {
      if (box.metal) continue;   // metal sandığı tek kişi iter
      const n = game.boxNeed, gap = ppu * 0.42, s = this.worldToScreen(box.x + box.w / 2, box.y - 10, 0.5);
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        ctx.arc(s.x + (i - (n - 1) / 2) * gap, s.y, ppu * 0.14, 0, Math.PI * 2);
        ctx.fillStyle = i < box.pushers ? '#fff' : 'rgba(255,255,255,0.18)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    game.players.forEach((p, i) => {
      if (p.inExit || p.noLabel) return;
      const col = PLAYER_COLORS[i % PLAYER_COLORS.length];
      const top = this.worldToScreen(p.x + p.w / 2, p.y - 6, 0.4);
      let ly = top.y;
      if (p.isMe) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(top.x - 6, ly - 8); ctx.lineTo(top.x + 6, ly - 8); ctx.lineTo(top.x, ly - 1);
        ctx.fill();
        ly -= 11;
      }
      const label = p.name || `${i + 1}P`;
      ctx.font = `800 ${fs}px ${FONT_STACK}`;
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(15,14,40,0.85)';
      ctx.strokeText(label, top.x, ly);
      ctx.fillStyle = col;
      ctx.fillText(label, top.x, ly);
      if (game.magnet) {
        const bp = this.worldToScreen(p.x + p.w - 1, p.y + 3, 0.5);
        const rad = Math.max(7, ppu * 0.2);
        ctx.beginPath();
        ctx.arc(bp.x, bp.y, rad, 0, Math.PI * 2);
        ctx.fillStyle = POLE_COLORS[p.pol];
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#15142c';
        ctx.stroke();
        ctx.fillStyle = '#15142c';
        ctx.font = `900 ${rad * 1.6}px ${FONT_STACK}`;
        ctx.textBaseline = 'middle';
        ctx.fillText(p.pol > 0 ? '+' : '−', bp.x, bp.y + 1);
      }
    });
  }
}

const FONT_STACK = '"Fredoka", system-ui, -apple-system, "Segoe UI", sans-serif';

window.Renderer3D = Renderer3D;
