/**
 * AuralAI Dev Dashboard — dashboard.js
 *
 * MOCK_MODE = true  → Simulasi fisik di browser (tanpa MaixCAM)
 * MOCK_MODE = false → Sambung ke MaixCAM via HTTP (production mode)
 *
 * Arsitektur Simulasi:
 *   Setiap objek di canvas adalah "entity" dengan posisi fisik nyata (x, y, w, h).
 *   Detection list dan bounding box di-derive DARI posisi fisik entity tersebut.
 *   Posisi label (kiri/kanan/tengah) dihitung dari koordinat pusat entity.
 *   Audio hanya trigger saat objek memasuki zona atau confidence naik signifikan.
 */

const MOCK_MODE = true;
const DEVICE_URL = '';
const SNAPSHOT_INTERVAL = 500;
const STATUS_INTERVAL = 1000;

// Canvas dimensions (harus sinkron dengan HTML)
const CW = 340;
const CH = 238;

// =====================================================================
// STATE
// =====================================================================
const state = {
  mode: 'explorer',
  aiFocusActive: false,
  aiFocusRemaining: 0,
  detections: [],
  latency: { camera: 32, inference: 88, postproc: 6, total: 126, fps: 7.9 },
  overlayVisible: true,
  frameCount: 0,
  lastFpsTime: Date.now(),
  fps: 0,
  tick: 0,
};

// =====================================================================
// ENTITY DEFINITIONS (tipe objek di scene)
// =====================================================================
const ENTITY_TYPES = {
  motorcycle: {
    icon: '🏍', color: '#ef4444',
    bw: 52, bh: 30,          // ukuran bounding box (px)
    speed: 1.6,               // px per frame (horizontal)
    y_range: [0.58, 0.72],   // vertical range (fraksi CH)
    label_id: 'motor',
    draw: drawMotorcycle,
  },
  car: {
    icon: '🚗', color: '#ef4444',
    bw: 78, bh: 44,
    speed: 1.1,
    y_range: [0.54, 0.68],
    label_id: 'mobil',
    draw: drawCar,
  },
  bus: {
    icon: '🚌', color: '#dc2626',
    bw: 100, bh: 54,
    speed: 0.75,
    y_range: [0.52, 0.64],
    label_id: 'bus',
    draw: drawBus,
  },
  person: {
    icon: '🚶', color: '#f59e0b',
    bw: 22, bh: 58,
    speed: 0.35,
    y_range: [0.30, 0.70],
    label_id: 'orang',
    draw: drawPerson,
  },
  bicycle: {
    icon: '🚲', color: '#22c55e',
    bw: 34, bh: 44,
    speed: 0.55,
    y_range: [0.40, 0.68],
    label_id: 'sepeda',
    draw: drawBicycle,
  },
  dog: {
    icon: '🐕', color: '#22c55e',
    bw: 32, bh: 24,
    speed: 0.45,
    y_range: [0.55, 0.72],
    label_id: 'anjing',
    draw: drawDog,
  },
};

// Urutan spawn untuk simulasi realistis (tidak random)
const SPAWN_SEQUENCE = [
  { type: 'motorcycle', dir: 1,  delay: 60  },
  { type: 'person',     dir: -1, delay: 130 },
  { type: 'car',        dir: 1,  delay: 220 },
  { type: 'bicycle',    dir: -1, delay: 320 },
  { type: 'motorcycle', dir: 1,  delay: 420 },
  { type: 'bus',        dir: 1,  delay: 500 },
  { type: 'person',     dir: 1,  delay: 580 },
  { type: 'dog',        dir: -1, delay: 650 },
  { type: 'car',        dir: -1, delay: 730 },
];
let spawnIdx = 0;

// =====================================================================
// ENTITIES (objek yang sedang aktif di scene)
// =====================================================================
let entities = [];
let nextEntityId = 0;

function spawnEntity(typeName, dir) {
  const def = ENTITY_TYPES[typeName];
  if (!def) return;

  const fy = def.y_range[0] + Math.random() * (def.y_range[1] - def.y_range[0]);
  const startX = dir > 0 ? -def.bw - 10 : CW + 10;

  entities.push({
    id: nextEntityId++,
    type: typeName,
    def,
    x: startX,        // kiri atas bounding box
    y: fy * CH - def.bh / 2,
    w: def.bw,
    h: def.bh,
    vx: def.speed * dir,
    dir,
    opacity: 0,       // fade in
    age: 0,
    lastZone: null,   // zone terakhir untuk audio trigger
    lastAudioTick: -999,
    conf: 0.50 + Math.random() * 0.20,  // confidence awal rendah
  });
}

function updateEntities() {
  const toRemove = [];

  entities.forEach(e => {
    e.x += e.vx;
    e.age++;

    // Fade in saat masuk frame
    if (e.opacity < 1) e.opacity = Math.min(1, e.opacity + 0.08);

    // Confidence naik saat objek semakin masuk ke frame
    const cx = e.x + e.w / 2;
    const inFramePct = Math.max(0, Math.min(1, cx / CW));
    const distFromEdge = Math.min(cx, CW - cx) / CW;
    e.conf = Math.min(0.97, 0.52 + distFromEdge * 1.2 + Math.sin(e.age * 0.05) * 0.02);

    // Hapus jika sudah keluar frame
    if (e.dir > 0 && e.x > CW + e.w + 20) toRemove.push(e.id);
    if (e.dir < 0 && e.x < -e.w - 20) toRemove.push(e.id);
  });

  entities = entities.filter(e => !toRemove.includes(e.id));
}

// =====================================================================
// POSISI GRID 3×3 dari koordinat fisik
// =====================================================================
function positionFromEntity(e) {
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;

  const col = cx < CW * 0.33 ? 'kiri' : cx > CW * 0.67 ? 'kanan' : 'tengah';
  const row = cy < CH * 0.33 ? 'atas' : cy > CH * 0.67 ? 'bawah' : 'tengah';

  if (row === 'tengah') return col;
  if (col === 'tengah') return row;
  return `${col}-${row}`;
}

function isDangerZone(e) {
  const area = (e.w * e.h) / (CW * CH);
  return area > 0.12;  // > 12% frame area = danger
}

// =====================================================================
// SYNC ENTITIES → DETECTIONS
// =====================================================================
function syncDetections() {
  if (state.mode !== 'explorer' || state.aiFocusActive) {
    state.detections = [];
    return;
  }

  state.detections = entities
    .filter(e => {
      // Hanya tampilkan jika objek sudah cukup masuk frame
      const cx = e.x + e.w / 2;
      return cx > 20 && cx < CW - 20 && e.opacity > 0.5;
    })
    .map(e => ({
      id: e.id,
      label: e.type,
      icon: e.def.icon,
      color: e.def.color,
      label_id: e.def.label_id,
      position: positionFromEntity(e),
      confidence: parseFloat(e.conf.toFixed(2)),
      isDanger: isDangerZone(e),
      // Koordinat dalam fraksi canvas (untuk overlay)
      fx: e.x / CW,
      fy: e.y / CH,
      fw: e.w / CW,
      fh: e.h / CH,
    }));
}

// =====================================================================
// AUDIO COOLDOWN (per entity, per zone)
// =====================================================================
const audioCooldown = new Map(); // key: `${id}_${zone}` → last tick

function triggerAudio() {
  if (state.mode !== 'explorer' || state.aiFocusActive) return;

  state.detections.forEach(det => {
    if (!det.isDanger && det.confidence < 0.70) return;

    const key = `${det.id}_${det.position}`;
    const lastTick = audioCooldown.get(key) || -999;

    // Cooldown: 5 detik (300 ticks @ 60fps) atau 8 detik untuk yang sama
    const cooldownTicks = 300;
    if (state.tick - lastTick < cooldownTicks) return;

    audioCooldown.set(key, state.tick);

    const phrase = `${det.label_id} ${posToAudioPhrase(det.position)}`;
    playAudio(phrase);
    log('info', `Detected: <strong>${det.label}</strong> (${det.confidence}) @ ${det.position}${det.isDanger ? ' <span style="color:var(--red)">⚠ BAHAYA</span>' : ''}`);
  });
}

function posToAudioPhrase(pos) {
  const map = {
    'kiri':        'di sebelah kiri',
    'kanan':       'di sebelah kanan',
    'tengah':      'di depan',
    'kiri-atas':   'di kiri atas',
    'kanan-atas':  'di kanan atas',
    'kiri-bawah':  'di kiri bawah',
    'kanan-bawah': 'di kanan bawah',
    'atas':        'di atas',
    'bawah':       'di bawah',
  };
  return map[pos] || pos;
}

// =====================================================================
// LATENCY SIMULATION (smooth, realistic — bukan random tiap frame)
// =====================================================================
const latTarget = { camera: 32, inference: 88, postproc: 6 };
const latCurrent = { camera: 32, inference: 88, postproc: 6 };

function updateLatency() {
  // Slow random walk toward ± jitter
  latTarget.camera    = clamp(latTarget.camera    + (Math.random() - 0.5) * 3, 22, 48);
  latTarget.inference = clamp(latTarget.inference + (Math.random() - 0.5) * 4, 72, 130);
  latTarget.postproc  = clamp(latTarget.postproc  + (Math.random() - 0.5) * 1.5, 4, 12);

  // Exponential moving average → nilai halus, tidak loncat
  const α = 0.08;
  latCurrent.camera    += α * (latTarget.camera    - latCurrent.camera);
  latCurrent.inference += α * (latTarget.inference - latCurrent.inference);
  latCurrent.postproc  += α * (latTarget.postproc  - latCurrent.postproc);

  const total = latCurrent.camera + latCurrent.inference + latCurrent.postproc;
  const fps   = 1000 / total;

  state.latency = {
    camera:    Math.round(latCurrent.camera),
    inference: Math.round(latCurrent.inference),
    postproc:  Math.round(latCurrent.postproc),
    total:     Math.round(total),
    fps:       fps.toFixed(1),
  };
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// =====================================================================
// CANVAS DRAWING
// =====================================================================
let canvas, ctx;

function initCanvas() {
  canvas = document.getElementById('cameraCanvas');
  ctx    = canvas.getContext('2d');
}

function drawScene() {
  ctx.clearRect(0, 0, CW, CH);

  if (state.mode === 'qris') {
    drawQrisScene();
    return;
  }

  // --- Sky ---
  const sky = ctx.createLinearGradient(0, 0, 0, CH * 0.48);
  sky.addColorStop(0, '#0f1a2e');
  sky.addColorStop(1, '#1a2f4a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CW, CH * 0.48);

  // --- Distant buildings ---
  drawBuildings();

  // --- Road surface ---
  const road = ctx.createLinearGradient(0, CH * 0.48, 0, CH);
  road.addColorStop(0, '#1c1c20');
  road.addColorStop(1, '#111114');
  ctx.fillStyle = road;
  ctx.fillRect(0, CH * 0.48, CW, CH * 0.52);

  // --- Road markings ---
  drawRoadMarkings();

  // --- Sidewalk (trotoar kiri) ---
  ctx.fillStyle = '#2a2a2e';
  ctx.fillRect(0, CH * 0.70, CW * 0.18, CH * 0.30);
  ctx.fillStyle = '#222226';
  for (let x = 0; x < CW * 0.18; x += 12) {
    ctx.fillRect(x, CH * 0.70, 1, CH * 0.30);
  }

  // --- Sort entities by y (perspektif — yang lebih bawah di depan) ---
  const sorted = [...entities].sort((a, b) => (a.y + a.h) - (b.y + b.h));
  sorted.forEach(e => {
    ctx.save();
    ctx.globalAlpha = e.opacity;
    e.def.draw(ctx, e);
    ctx.restore();
  });

  // --- Ground shadow untuk entities ---
  sorted.forEach(e => {
    if (e.opacity < 0.3) return;
    ctx.save();
    ctx.globalAlpha = e.opacity * 0.25;
    ctx.fillStyle = '#000';
    const sx = e.x + e.w * 0.1;
    const sy = e.y + e.h + 2;
    const sw = e.w * 0.8;
    const sh = 5;
    ctx.beginPath();
    ctx.ellipse(sx + sw/2, sy, sw/2, sh/2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });

  // --- Resolution watermark ---
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#fff';
  ctx.font = '9px monospace';
  ctx.fillText('320×224', 6, CH - 6);
  ctx.globalAlpha = 1;

  // --- AI Focus overlay ---
  if (state.aiFocusActive) {
    ctx.fillStyle = 'rgba(245, 158, 11, 0.06)';
    ctx.fillRect(0, 0, CW, CH);
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, CW - 2, CH - 2);

    ctx.fillStyle = 'rgba(245, 158, 11, 0.9)';
    ctx.font = 'bold 11px monospace';
    ctx.fillText('⚡ AI FOCUS', CW / 2 - 38, 20);
  }
}

function drawBuildings() {
  const buildings = [
    { x: 10,  w: 30, h: 55, c: '#151d2e' },
    { x: 45,  w: 50, h: 40, c: '#12192a' },
    { x: 100, w: 25, h: 65, c: '#161e30' },
    { x: 130, w: 40, h: 45, c: '#111828' },
    { x: 210, w: 35, h: 70, c: '#151d2e' },
    { x: 255, w: 55, h: 48, c: '#12192a' },
    { x: 300, w: 30, h: 58, c: '#151d2e' },
  ];
  const horizon = CH * 0.48;
  buildings.forEach(b => {
    ctx.fillStyle = b.c;
    ctx.fillRect(b.x, horizon - b.h, b.w, b.h);

    // Windows
    ctx.fillStyle = 'rgba(255, 230, 100, 0.15)';
    for (let wx = b.x + 4; wx < b.x + b.w - 4; wx += 8) {
      for (let wy = horizon - b.h + 6; wy < horizon - 6; wy += 10) {
        if (Math.sin(wx * 3 + wy * 7) > 0.1) {
          ctx.fillRect(wx, wy, 4, 5);
        }
      }
    }
  });
}

function drawRoadMarkings() {
  const roadTop = CH * 0.52;

  // Center dashed line
  ctx.strokeStyle = 'rgba(255,255,255, 0.25)';
  ctx.setLineDash([18, 14]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, CH * 0.60);
  ctx.lineTo(CW, CH * 0.60);
  ctx.stroke();
  ctx.setLineDash([]);

  // Lane edges
  ctx.strokeStyle = 'rgba(255,255,255, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, CH * 0.72);
  ctx.lineTo(CW, CH * 0.72);
  ctx.stroke();

  // Reflective road spots (ambient light)
  ctx.fillStyle = 'rgba(100, 150, 200, 0.04)';
  for (let x = 20; x < CW; x += 60) {
    ctx.fillRect(x, CH * 0.74, 30, 4);
  }
}

// ─── Object Drawers ───────────────────────────────────────────────────────────

function drawMotorcycle(ctx, e) {
  const { x, y, w, h } = e;
  // Body
  ctx.fillStyle = '#cc3030';
  ctx.beginPath();
  ctx.roundRect(x + w*0.15, y + h*0.25, w*0.65, h*0.45, 3);
  ctx.fill();
  // Seat
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(x + w*0.25, y + h*0.15, w*0.40, h*0.18);
  // Handlebar
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + w*0.65, y + h*0.18);
  ctx.lineTo(x + w*0.65, y + h*0.05);
  ctx.lineTo(x + w*0.80, y + h*0.05);
  ctx.stroke();
  // Wheels
  ctx.fillStyle = '#1a1a1a';
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1.5;
  [[x + w*0.18, y+h], [x + w*0.78, y+h]].forEach(([wx, wy]) => {
    ctx.beginPath(); ctx.arc(wx, wy, w*0.14, 0, Math.PI*2);
    ctx.fill(); ctx.stroke();
  });
  // Headlight
  if (e.dir < 0) {
    ctx.fillStyle = 'rgba(255,230,100,0.8)';
    ctx.beginPath(); ctx.ellipse(x+2, y+h*0.35, 3, 2.5, 0, 0, Math.PI*2); ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(255,100,80,0.8)';
    ctx.beginPath(); ctx.ellipse(x+w-2, y+h*0.35, 3, 2.5, 0, 0, Math.PI*2); ctx.fill();
  }
}

function drawCar(ctx, e) {
  const { x, y, w, h } = e;
  const bodyColor = e.dir > 0 ? '#2255cc' : '#994422';
  // Body lower
  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.roundRect(x, y + h*0.45, w, h*0.55, 4);
  ctx.fill();
  // Cabin
  ctx.fillStyle = adjustColor(bodyColor, 15);
  ctx.beginPath();
  ctx.roundRect(x + w*0.15, y + h*0.10, w*0.70, h*0.42, 5);
  ctx.fill();
  // Windows
  ctx.fillStyle = 'rgba(160,220,255,0.35)';
  ctx.beginPath(); ctx.roundRect(x+w*0.18, y+h*0.14, w*0.30, h*0.25, 3); ctx.fill();
  ctx.beginPath(); ctx.roundRect(x+w*0.52, y+h*0.14, w*0.30, h*0.25, 3); ctx.fill();
  // Wheels
  ctx.fillStyle = '#111';
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1.5;
  [[x+w*0.16, y+h], [x+w*0.80, y+h]].forEach(([wx, wy]) => {
    ctx.beginPath(); ctx.arc(wx, wy, w*0.13, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#333';
    ctx.beginPath(); ctx.arc(wx, wy, w*0.06, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#111';
  });
  // Lights
  if (e.dir < 0) {
    ctx.fillStyle = 'rgba(255,230,100,0.9)';
    ctx.beginPath(); ctx.ellipse(x+3, y+h*0.55, 4, 3, 0, 0, Math.PI*2); ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(255,90,70,0.9)';
    ctx.beginPath(); ctx.ellipse(x+w-3, y+h*0.55, 4, 3, 0, 0, Math.PI*2); ctx.fill();
  }
}

function drawBus(ctx, e) {
  const { x, y, w, h } = e;
  ctx.fillStyle = '#e8a020';
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 4); ctx.fill();
  // Windows
  ctx.fillStyle = 'rgba(180,230,255,0.3)';
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.roundRect(x + w*0.08 + i*(w*0.22), y + h*0.12, w*0.18, h*0.32, 2);
    ctx.fill();
  }
  // Door
  ctx.fillStyle = '#c08018';
  ctx.fillRect(x + (e.dir < 0 ? w*0.75 : w*0.05), y + h*0.45, w*0.14, h*0.52);
  // Wheels
  ctx.fillStyle = '#111';
  [[x+w*0.12, y+h+2], [x+w*0.50, y+h+2], [x+w*0.85, y+h+2]].forEach(([wx,wy]) => {
    ctx.beginPath(); ctx.arc(wx, wy, w*0.10, 0, Math.PI*2); ctx.fill();
  });
}

function drawPerson(ctx, e) {
  const { x, y, w, h } = e;
  const cx = x + w / 2;
  const walkPhase = Math.sin(e.age * 0.18);

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(cx, y+h, w*0.5, 3, 0, 0, Math.PI*2); ctx.fill();

  // Legs
  ctx.strokeStyle = '#445577';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, y + h*0.65);
  ctx.lineTo(cx - w*0.3 + walkPhase*4, y + h);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, y + h*0.65);
  ctx.lineTo(cx + w*0.3 - walkPhase*4, y + h);
  ctx.stroke();

  // Body
  ctx.fillStyle = '#445577';
  ctx.beginPath(); ctx.roundRect(cx - w*0.35, y + h*0.32, w*0.70, h*0.35, 3); ctx.fill();

  // Arms
  ctx.strokeStyle = '#556688';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(cx - w*0.30, y + h*0.37);
  ctx.lineTo(cx - w*0.55, y + h*0.60 + walkPhase*3);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + w*0.30, y + h*0.37);
  ctx.lineTo(cx + w*0.55, y + h*0.60 - walkPhase*3);
  ctx.stroke();

  // Head
  ctx.fillStyle = '#c8a87a';
  ctx.beginPath(); ctx.arc(cx, y + h*0.18, w*0.40, 0, Math.PI*2); ctx.fill();
}

function drawBicycle(ctx, e) {
  const { x, y, w, h } = e;
  const cx = x + w / 2;
  const wheelR = h * 0.38;
  const lx = x + wheelR, rx = x + w - wheelR, midY = y + h - wheelR;

  ctx.strokeStyle = '#448844';
  ctx.lineWidth = 2;

  // Wheels
  [[lx, midY], [rx, midY]].forEach(([wx, wy]) => {
    ctx.beginPath(); ctx.arc(wx, wy, wheelR, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(wx, wy, 2, 0, Math.PI*2);
    ctx.fillStyle = '#448844'; ctx.fill();
  });

  // Frame
  ctx.beginPath();
  ctx.moveTo(lx, midY);
  ctx.lineTo(cx - 2, y + h*0.20);
  ctx.lineTo(rx, midY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 2, y + h*0.20);
  ctx.lineTo(lx + wheelR * 0.5, midY);
  ctx.stroke();

  // Handlebar + seat
  ctx.beginPath();
  ctx.moveTo(rx - 3, midY - wheelR*0.8);
  ctx.lineTo(rx + 6, midY - wheelR*1.1);
  ctx.stroke();
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(cx - 7, y + h*0.18, 12, 4);

  // Rider silhouette
  ctx.fillStyle = '#556688';
  ctx.beginPath(); ctx.arc(cx + 4, y + h*0.05, 7, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.roundRect(cx - 4, y + h*0.12, 14, 14, 3); ctx.fill();
}

function drawDog(ctx, e) {
  const { x, y, w, h } = e;
  const walkPhase = Math.sin(e.age * 0.22);

  // Body
  ctx.fillStyle = '#a0724a';
  ctx.beginPath(); ctx.ellipse(x + w*0.52, y + h*0.45, w*0.35, h*0.28, -0.1, 0, Math.PI*2); ctx.fill();

  // Head
  ctx.beginPath(); ctx.ellipse(x + (e.dir > 0 ? w*0.82 : w*0.18), y + h*0.35, w*0.22, h*0.25, 0, 0, Math.PI*2); ctx.fill();

  // Ear
  ctx.fillStyle = '#8a5c34';
  const earX = e.dir > 0 ? x + w*0.78 : x + w*0.22;
  ctx.beginPath(); ctx.ellipse(earX, y + h*0.22, 5, 9, e.dir > 0 ? 0.4 : -0.4, 0, Math.PI*2); ctx.fill();

  // Legs
  ctx.strokeStyle = '#8a5c34';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  [[x+w*0.28, x+w*0.22+walkPhase*4], [x+w*0.42, x+w*0.42-walkPhase*4],
   [x+w*0.62, x+w*0.62+walkPhase*4], [x+w*0.76, x+w*0.76-walkPhase*4]].forEach(([fx, tx]) => {
    ctx.beginPath();
    ctx.moveTo(fx, y + h*0.65);
    ctx.lineTo(tx, y + h);
    ctx.stroke();
  });

  // Tail
  ctx.beginPath();
  const tx2 = e.dir > 0 ? x + w*0.18 : x + w*0.82;
  ctx.moveTo(tx2, y + h*0.38);
  ctx.quadraticCurveTo(tx2 - e.dir*8, y, tx2 - e.dir*12, y + h*0.28);
  ctx.strokeStyle = '#a0724a';
  ctx.lineWidth = 3;
  ctx.stroke();
}

// ─── QRIS Mode scene ──────────────────────────────────────────────────────────
function drawQrisScene() {
  ctx.fillStyle = '#0a0c10';
  ctx.fillRect(0, 0, CW, CH);

  const qx = CW/2 - 60, qy = CH/2 - 60, qs = 120;

  // Grid background
  ctx.strokeStyle = 'rgba(168,85,247,0.08)';
  ctx.lineWidth = 1;
  for (let i = 0; i < CW; i += 16) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, CH); ctx.stroke();
  }
  for (let j = 0; j < CH; j += 16) {
    ctx.beginPath(); ctx.moveTo(0, j); ctx.lineTo(CW, j); ctx.stroke();
  }

  // Corner brackets (scan area)
  const bLen = 20;
  ctx.strokeStyle = 'rgba(168,85,247,0.9)';
  ctx.lineWidth = 2.5;
  const corners = [
    [qx, qy, 1, 1], [qx+qs, qy, -1, 1],
    [qx, qy+qs, 1, -1], [qx+qs, qy+qs, -1, -1],
  ];
  corners.forEach(([cx2, cy2, dx, dy]) => {
    ctx.beginPath();
    ctx.moveTo(cx2, cy2 + dy*bLen);
    ctx.lineTo(cx2, cy2);
    ctx.lineTo(cx2 + dx*bLen, cy2);
    ctx.stroke();
  });

  // Scan line animation
  const scanY = qy + ((state.tick * 1.5) % qs);
  const scanGrad = ctx.createLinearGradient(qx, scanY-10, qx, scanY+10);
  scanGrad.addColorStop(0, 'transparent');
  scanGrad.addColorStop(0.5, 'rgba(168,85,247,0.7)');
  scanGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = scanGrad;
  ctx.fillRect(qx, scanY-10, qs, 20);

  // Mock QR pattern
  ctx.fillStyle = 'rgba(168,85,247,0.12)';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r*7 + c*3) % 3 !== 0) {
        ctx.fillRect(qx + 10 + c*12, qy + 10 + r*12, 10, 10);
      }
    }
  }

  // Label
  ctx.fillStyle = 'rgba(168,85,247,0.8)';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('QRIS SCAN AREA', CW/2, qy - 10);
  ctx.fillText('Arahkan kamera ke kode QRIS', CW/2, qy + qs + 18);
  ctx.textAlign = 'left';
}

// =====================================================================
// CONTEXT MODE scene overlay
// =====================================================================
function drawContextOverlay() {
  ctx.fillStyle = 'rgba(0,150,255,0.04)';
  ctx.fillRect(0, 0, CW, CH);
  ctx.strokeStyle = 'rgba(0,150,255,0.3)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(1, 1, CW-2, CH-2);
  ctx.fillStyle = 'rgba(0,150,255,0.7)';
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('CONTEXT MODE — STANDBY', CW/2, 18);
  ctx.textAlign = 'left';
}

// =====================================================================
// HELPER
// =====================================================================
function adjustColor(hex, amount) {
  const r = clamp(parseInt(hex.slice(1,3),16) + amount, 0, 255);
  const g = clamp(parseInt(hex.slice(3,5),16) + amount, 0, 255);
  const b = clamp(parseInt(hex.slice(5,7),16) + amount, 0, 255);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

// =====================================================================
// MAIN SIMULATION LOOP
// =====================================================================
function simLoop() {
  state.tick++;

  if (MOCK_MODE) {
    // Spawn entities berdasarkan sequence
    if (!state.aiFocusActive && state.mode === 'explorer') {
      const seq = SPAWN_SEQUENCE[spawnIdx % SPAWN_SEQUENCE.length];
      if (state.tick >= seq.delay + Math.floor(spawnIdx / SPAWN_SEQUENCE.length) * 800) {
        // Cek apakah tipe ini sudah ada di scene
        const typeExists = entities.some(e => e.type === seq.type);
        if (!typeExists) {
          spawnEntity(seq.type, seq.dir);
          spawnIdx++;
        } else {
          spawnIdx++;  // skip, coba next
        }
      }
    }

    updateEntities();
    syncDetections();

    // Gambar scene
    drawScene();
    if (state.mode === 'context') drawContextOverlay();

    // Update latency setiap 10 frame
    if (state.tick % 10 === 0) {
      updateLatency();
      renderLatency();
    }

    // Trigger audio setiap 30 frame (~0.5 detik)
    if (state.tick % 30 === 0 && !state.aiFocusActive) {
      triggerAudio();
    }

    // Render detections ke panel
    if (state.tick % 4 === 0) {
      renderDetections();
    }

    // FPS counter
    state.frameCount++;
    const now = Date.now();
    if (now - state.lastFpsTime >= 1000) {
      state.fps = state.frameCount;
      state.frameCount = 0;
      state.lastFpsTime = now;
      document.getElementById('fpsCounter').textContent = `${state.fps} fps`;
    }
  }

  requestAnimationFrame(simLoop);
}

// =====================================================================
// RENDER UI
// =====================================================================
function renderDetections() {
  const list     = document.getElementById('detectionList');
  const overlay  = document.getElementById('overlayDetections');
  const countEl  = document.getElementById('detectionCount');

  const dets = state.detections;
  countEl.textContent = dets.length;

  if (dets.length === 0) {
    list.innerHTML = '<div class="detection-empty">Waiting for detections...</div>';
    overlay.innerHTML = '';
    return;
  }

  // Sort: danger dulu, lalu confidence
  const sorted = [...dets].sort((a, b) => {
    if (a.isDanger !== b.isDanger) return a.isDanger ? -1 : 1;
    return b.confidence - a.confidence;
  });

  list.innerHTML = sorted.map(d => {
    const cls = d.isDanger ? 'danger' : d.confidence > 0.75 ? 'normal' : 'warning';
    const confPct = Math.round(d.confidence * 100);
    const dangerTag = d.isDanger
      ? '<span class="det-danger">⚠ BAHAYA</span>'
      : '';
    return `<div class="detection-item ${cls}">
      <span class="det-icon">${d.icon}</span>
      <span class="det-label">${d.label}</span>
      <span class="det-pos">${d.position}</span>
      <span class="det-conf">${confPct}%</span>
      ${dangerTag}
    </div>`;
  }).join('');

  if (!state.overlayVisible) {
    overlay.innerHTML = '';
    return;
  }

  const W = canvas.offsetWidth  || CW;
  const H = canvas.offsetHeight || CH;
  const scaleX = W / CW;
  const scaleY = H / CH;

  overlay.innerHTML = dets.map(d => {
    const bx = Math.round(d.fx * CW * scaleX);
    const by = Math.round(d.fy * CH * scaleY);
    const bw = Math.round(d.fw * CW * scaleX);
    const bh = Math.round(d.fh * CH * scaleY);
    const confPct = Math.round(d.confidence * 100);
    const borderColor = d.isDanger ? '#ef4444' : d.color;
    return `<div class="detection-box" style="
        left:${bx}px; top:${by}px; width:${bw}px; height:${bh}px;
        border-color:${borderColor};
        ${d.isDanger ? 'animation: box-pulse 0.6s ease-in-out infinite;' : ''}
      ">
      <div class="detection-box-label" style="background:${borderColor}; color:#000;">
        ${d.label} ${confPct}%
      </div>
    </div>`;
  }).join('');
}

function renderLatency() {
  const l = state.latency;
  document.getElementById('latCamera').textContent    = `${l.camera}ms`;
  document.getElementById('latInference').textContent = `${l.inference}ms`;
  document.getElementById('latPostproc').textContent  = `${l.postproc}ms`;
  document.getElementById('latTotal').textContent     = `${l.total}ms`;
  document.getElementById('latFps').textContent       = l.fps;

  colorizeLatency('latCamera',    l.camera,    35, 55);
  colorizeLatency('latInference', l.inference, 100, 140);
  colorizeLatency('latTotal',     l.total,     150, 220);

  const maxW = 120;
  document.getElementById('barCamera').style.width    = Math.round((l.camera    / 250) * maxW) + 'px';
  document.getElementById('barInference').style.width = Math.round((l.inference / 250) * maxW) + 'px';
  document.getElementById('barPostproc').style.width  = Math.round((l.postproc  / 250) * maxW) + 'px';
}

function colorizeLatency(id, val, warnThresh, errThresh) {
  const el = document.getElementById(id);
  if (!el) return;
  if (val > errThresh)       el.style.color = 'var(--red)';
  else if (val > warnThresh) el.style.color = 'var(--orange)';
  else                       el.style.color = 'var(--accent)';
}

// =====================================================================
// AUDIO
// =====================================================================
let audioQueue   = [];
let audioPlaying = false;

function playAudio(text) {
  // Jangan duplikasi jika teks sama sudah ada di queue
  if (audioQueue.includes(text)) return;
  audioQueue.push(text);
  processAudioQueue();
}

function processAudioQueue() {
  if (audioPlaying || audioQueue.length === 0) return;
  audioPlaying = true;

  const text = audioQueue.shift();
  document.getElementById('audioText').textContent = text;
  document.getElementById('audioStatus').textContent  = 'Playing';
  document.getElementById('audioStatus').className    = 'badge badge-green';

  renderAudioQueue();

  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utt  = new SpeechSynthesisUtterance(text);
    utt.lang   = 'id-ID';
    utt.rate   = 0.95;
    utt.pitch  = 1.0;

    const voices  = window.speechSynthesis.getVoices();
    const idVoice = voices.find(v => v.lang.startsWith('id') || v.lang.startsWith('ms'));
    if (idVoice) utt.voice = idVoice;

    utt.onend = () => {
      audioPlaying = false;
      document.getElementById('audioStatus').textContent = 'Ready';
      document.getElementById('audioStatus').className   = 'badge badge-green';
      processAudioQueue();
    };
    utt.onerror = () => {
      audioPlaying = false;
      processAudioQueue();
    };
    window.speechSynthesis.speak(utt);
  } else {
    setTimeout(() => {
      audioPlaying = false;
      document.getElementById('audioStatus').textContent = 'Ready';
      document.getElementById('audioStatus').className   = 'badge badge-green';
      processAudioQueue();
    }, 1500);
  }
}

function renderAudioQueue() {
  const el = document.getElementById('audioQueue');
  el.innerHTML = audioQueue.length > 0
    ? audioQueue.slice(0, 3).map(t => `<span style="opacity:0.6">⬦ ${t}</span>`).join('')
    : '';
}

function setAudioBusy() {
  document.getElementById('audioStatus').textContent = 'Processing...';
  document.getElementById('audioStatus').className   = 'badge badge-orange';
}

// =====================================================================
// COMMANDS
// =====================================================================
function setMode(mode) {
  state.mode = mode;
  state.detections = [];
  renderDetections();

  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  const modeMap = { explorer: 'btnExplorer', context: 'btnContext', qris: 'btnQris' };
  document.getElementById(modeMap[mode])?.classList.add('active');

  const modeNames = { explorer: 'Explorer Mode', context: 'Context Mode', qris: 'QRIS Scan Mode' };
  log('info', `Mode diubah: <strong>${modeNames[mode]}</strong>`);

  if (mode !== 'explorer') {
    entities = [];  // clear entities saat ganti mode
    document.getElementById('overlayDetections').innerHTML = '';
  }

  const phrases = { explorer: 'mode penjelajah aktif', context: 'mode konteks aktif', qris: 'mode scan bayar aktif' };
  playAudio(phrases[mode]);

  if (!MOCK_MODE) sendLiveCommand('set_mode', { mode });
}

function cmdAIFocus() {
  if (!state.aiFocusActive) {
    if (MOCK_MODE) startAiFocus();
    else sendLiveCommand('focus');
  }
}
function cmdCapture() {
  flashCamera();
  log('ok', `Frame captured — /root/captures/capture_${Date.now()}.jpg`);
  if (!MOCK_MODE) sendLiveCommand('capture');
}
function cmdQris() {
  log('info', 'Memindai QRIS...');
  setAudioBusy();
  if (MOCK_MODE) {
    setTimeout(() => {
      const results = [
        'MERCHANT: Warung Bu Siti, NOMINAL: Rp 25.000',
        'MERCHANT: Alfamart Jl. Sudirman, NOMINAL: Rp 47.500',
        'BUKAN QRIS — objek yang terdeteksi bukan kode QRIS',
        'MERCHANT: GoFood Partner, NOMINAL: tidak tertera',
      ];
      const r = results[Math.floor(state.tick / 100) % results.length];
      playAudio(r);
      log('ok', `QRIS: ${r}`);
    }, 1800);
  } else {
    sendLiveCommand('qris');
  }
}
function cmdDescribe() {
  log('info', 'Mengirim frame ke OpenAI Vision...');
  setAudioBusy();
  if (MOCK_MODE) {
    const scenes = [
      'Jalan raya dengan beberapa kendaraan bermotor. Sepeda motor di sebelah kiri, pejalan kaki di tengah.',
      'Area parkir dengan mobil terparkir. Tidak ada pergerakan signifikan terdeteksi.',
      'Trotoar dengan pejalan kaki. Terdapat tiang listrik di latar belakang.',
      'Persimpangan jalan. Terlihat beberapa kendaraan dan pejalan kaki.',
    ];
    // Pilih deskripsi berdasarkan entitas yang ada di scene saat ini
    let desc;
    const types = entities.map(e => e.type);
    if (types.includes('motorcycle') && types.includes('person')) {
      desc = 'Jalan raya. Sepeda motor bergerak dari kiri, ada orang berjalan di sebelah kanan.';
    } else if (types.includes('bus')) {
      desc = 'Bus besar terlihat mendekati dari depan. Waspadai kendaraan besar.';
    } else if (types.includes('car')) {
      desc = 'Satu atau dua mobil terlihat di jalan. Kondisi lalu lintas relatif sepi.';
    } else {
      desc = scenes[Math.floor(state.tick / 150) % scenes.length];
    }
    setTimeout(() => {
      playAudio(desc);
      log('ok', `Scene: ${desc}`);
    }, 2200);
  } else {
    sendLiveCommand('describe');
  }
}
function cmdBenchmark() {
  openBenchModal();
}

// =====================================================================
// AI FOCUS
// =====================================================================
let focusTimer = null;

function startAiFocus() {
  if (state.aiFocusActive) return;

  const DURATION = 5;
  state.aiFocusActive = true;

  const btn = document.getElementById('btnAiFocus');
  btn.classList.add('running');

  document.getElementById('focusSection').style.display = '';
  document.getElementById('focusProgress').style.width  = '100%';
  document.getElementById('focusTimer').textContent     = `${DURATION}s`;

  log('warn', 'AI Focus aktif — inferensi fokus, snapshot web dijeda');
  playAudio('sedang menganalisis');

  let elapsed = 0;
  focusTimer = setInterval(() => {
    elapsed++;
    const pct = ((DURATION - elapsed) / DURATION) * 100;
    document.getElementById('focusProgress').style.width = pct + '%';
    document.getElementById('focusTimer').textContent    = `${DURATION - elapsed}s`;

    if (elapsed >= DURATION) {
      clearInterval(focusTimer);
      state.aiFocusActive = false;
      btn.classList.remove('running');
      btn.innerHTML = '<span class="ctrl-icon">⚡</span> AI Focus 5s';
      document.getElementById('focusSection').style.display = 'none';
      log('ok', 'AI Focus selesai — mode normal dilanjutkan');
    }
  }, 1000);
}

// =====================================================================
// LIVE MODE (MaixCAM)
// =====================================================================
function initLiveMode() {
  const img    = document.getElementById('cameraImg');
  const cvs    = document.getElementById('cameraCanvas');
  cvs.style.display = 'none';
  img.style.display = 'block';

  function refreshSnapshot() {
    if (!state.aiFocusActive) {
      img.onload = () => {
        state.frameCount++;
        const now = Date.now();
        if (now - state.lastFpsTime >= 1000) {
          state.fps = state.frameCount;
          state.frameCount = 0;
          state.lastFpsTime = now;
          document.getElementById('fpsCounter').textContent = `${state.fps} fps`;
        }
      };
      img.src = `${DEVICE_URL}/snapshot?t=${Date.now()}`;
    }
    setTimeout(refreshSnapshot, SNAPSHOT_INTERVAL);
  }
  refreshSnapshot();
  pollLiveStatus();
}

async function pollLiveStatus() {
  try {
    const res  = await fetch(`${DEVICE_URL}/status`);
    const data = await res.json();

    setStatus('connected', 'Connected');
    state.mode       = data.mode || state.mode;
    state.detections = data.detections || [];
    state.latency    = data.latency    || state.latency;
    renderDetections();
    renderLatency();
    if (data.audio_text) playAudio(data.audio_text);
  } catch {
    setStatus('error', 'Disconnected');
  }
  setTimeout(pollLiveStatus, STATUS_INTERVAL);
}

async function sendLiveCommand(cmd, extra = {}) {
  try {
    await fetch(`${DEVICE_URL}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd, ...extra }),
    });
  } catch (e) {
    log('error', `Command failed: ${cmd}`);
  }
}

// =====================================================================
// UI HELPERS
// =====================================================================
function setStatus(type, text) {
  document.getElementById('statusDot').className  = `status-dot ${type}`;
  document.getElementById('statusText').textContent = text;
}

function flashCamera() {
  const frame = document.getElementById('cameraFrame');
  frame.style.transition = 'filter 0.08s';
  frame.style.filter = 'brightness(4) saturate(0)';
  setTimeout(() => { frame.style.filter = ''; }, 120);
}

// =====================================================================
// LOGGING
// =====================================================================
const MAX_LOGS = 200;

function log(level, message) {
  const now  = new Date();
  const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

  const body  = document.getElementById('logBody');
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <span class="log-time">[${time}]</span>
    <span class="log-level ${level}">${level.toUpperCase()}</span>
    <span class="log-msg">${message}</span>
  `;
  body.appendChild(entry);

  // Trim jika terlalu panjang
  while (body.children.length > MAX_LOGS) body.removeChild(body.firstChild);

  if (document.getElementById('autoScrollToggle').checked) {
    body.scrollTop = body.scrollHeight;
  }
}

function clearLogs() {
  document.getElementById('logBody').innerHTML = '';
  log('info', 'Log dibersihkan');
}

// =====================================================================
// BENCHMARK MODAL
// =====================================================================

// ── State ────────────────────────────────────────────────────────────
const benchState = {
  quickRunning: false,
  qrisRunning:  false,
  ltRunning:    false,
  currentTab:   'quick',

  // Long-term state (persisted in localStorage)
  lt: {
    days: [           // 5 slots
      { done: false, fps: null, hours: 0, frames: 0, throttleEvents: 0, date: null },
      { done: false, fps: null, hours: 0, frames: 0, throttleEvents: 0, date: null },
      { done: false, fps: null, hours: 0, frames: 0, throttleEvents: 0, date: null },
      { done: false, fps: null, hours: 0, frames: 0, throttleEvents: 0, date: null },
      { done: false, fps: null, hours: 0, frames: 0, throttleEvents: 0, date: null },
    ],
    currentDay:    0,   // 0-indexed
    sessionElapsed: 0,  // seconds in current session
  },
};

// ── Modal open/close ─────────────────────────────────────────────────
function openBenchModal() {
  document.getElementById('benchOverlay').classList.add('open');
  if (benchState.currentTab === 'longterm') ltRenderCalendar();
}

function closeBenchModal(e) {
  if (e && e.target !== document.getElementById('benchOverlay')) return;
  document.getElementById('benchOverlay').classList.remove('open');
}

// ── Tab switch ───────────────────────────────────────────────────────
function switchBenchTab(tab) {
  benchState.currentTab = tab;
  ['quick', 'qris', 'longterm'].forEach(t => {
    document.getElementById(`tab${t.charAt(0).toUpperCase() + t.slice(1)}`).classList.toggle('active', t === tab);
    document.getElementById(`panel${t.charAt(0).toUpperCase() + t.slice(1)}`).style.display = t === tab ? 'flex' : 'none';
  });
  if (tab === 'longterm') ltLoadState();
}

// ─────────────────────────────────────────────────────────────────────
// ══ QUICK BENCH ══════════════════════════════════════════════════════
// ─────────────────────────────────────────────────────────────────────

const BENCH_SECTIONS = [
  {
    id: 0, label: 'System Info + Thermal Baseline',
    durationMs: 800,
    output: () => [
      ['div', '══════════════════════════════════════════════════════════════'],
      ['section', 'SECTION 0 – SYSTEM INFO + THERMAL BASELINE'],
      ['div', '══════════════════════════════════════════════════════════════'],
      ['kv', 'Kernel',         'Linux 5.10.4-tag- #1 PREEMPT'],
      ['kv', 'Arch',           'riscv64'],
      ['kv', 'MaixPy/maix',    'Available'],
      ['kv', 'Python',         '3.11.7'],
      ['kv', 'Load average',   '0.41 0.38 0.29 2/189 1421'],
      ['kv', 'RAM Total',      '256 MB'],
      ['kv', 'RAM Available',  '178 MB'],
      ['kv', 'CPU0 cur freq',  '1000 MHz'],
      ['kv', 'CPU0 max freq',  '1000 MHz'],
      ['kv', '[thermal_zone0] soc_thermal', '42.5 °C'],
      ['kv', '[thermal_zone1] cpu_thermal', '43.1 °C'],
    ],
    result: () => { setSectionStatus(0, 'done', '43°C'); },
  },
  {
    id: 1, label: 'Memory Bandwidth',
    durationMs: 2200,
    output: () => [
      ['section', 'SECTION 1 – MEMORY BANDWIDTH'],
      ['dim',     'bytearray copy 1MB × 100 rounds ...'],
      ['kv', '  Copy 1MB×100',         '312.4 ms total  |  320.1 MB/s'],
      ['dim',     'bytearray copy 4MB × 50 rounds ...'],
      ['kv', '  Copy 4MB×50',          '634.8 ms total  |  314.7 MB/s'],
      ['dim',     'Sequential stride read 4MB × 20 rounds ...'],
      ['kv', '  Stride read 4MB×20',   '198.3 ms total  |  403.2 MB/s'],
      ['kv', '  to_bytes 320×240 RGB×500', '0.921 ms/frame  |  237.4 MB/s'],
      ['kv', '  to_bytes 640×480 RGB×200', '3.614 ms/frame  |  242.1 MB/s'],
      ['ok', '  Peak bandwidth: 403 MB/s (stride read)'],
    ],
    result: () => {
      setSectionStatus(1, 'done', '403 MB/s');
      document.getElementById('sumMemBw').textContent = '403 MB/s';
    },
  },
  {
    id: 2, label: 'JPEG Codec Throughput',
    durationMs: 1800,
    output: () => [
      ['section', 'SECTION 2 – JPEG CODEC THROUGHPUT'],
      ['dim', 'Relevan: JPEG encode untuk 500ms poll + Context Mode upload'],
      ['kv', 'QVGA 320×240'],
      ['kv', '  JPEG size',          '12.4 KB  (ratio: 18.6×)'],
      ['kv', '  Encode RGB→JPEG',    '2.31 ms/frame  |  432.5 fps max'],
      ['kv', '  Decode JPEG→RGB',    '3.12 ms/frame  |  320.5 fps max'],
      ['kv', 'VGA 640×480'],
      ['kv', '  JPEG size',          '44.7 KB  (ratio: 20.7×)'],
      ['kv', '  Encode RGB→JPEG',    '8.94 ms/frame  |  111.9 fps max'],
      ['kv', 'HD 1280×720'],
      ['kv', '  JPEG size',          '138.2 KB  (ratio: 20.0×)'],
      ['kv', '  Encode RGB→JPEG',    '31.4 ms/frame  |  31.8 fps max'],
    ],
    result: () => {
      setSectionStatus(2, 'done', '2.3ms 320p');
      document.getElementById('sumJpegMs').textContent = '2.3ms';
    },
  },
  {
    id: 3, label: 'NPU Inference Benchmark',
    durationMs: 4500,
    output: () => [
      ['section', 'SECTION 3 – NPU INFERENCE BENCHMARK'],
      ['kv', 'Model', 'YOLO11n  (/root/models/yolo11n.mud)'],
      ['kv', 'Model input', '320×224  fmt=FMT_RGB888'],
      ['kv', '── 3a. NPU ceiling (synthetic frame, no camera) ──'],
      ['kv', '  200 inferences, total',  '3348.2 ms'],
      ['kv', '  Per inference',          '16.74 ms'],
      ['ok', '  NPU ceiling FPS         59.7 fps  ← NPU max throughput'],
      ['kv', '── 3b. Camera → NPU pipeline ──'],
      ['kv', '  Per frame (cam+infer)',  '16.89 ms'],
      ['kv', '  Pipeline FPS',           '59.2 fps'],
      ['kv', '  Overhead vs NPU-only',   '+0.15 ms/frame  (0.9% slower)'],
      ['kv', '── 3c. Sustained 200 frames – throttle check ──'],
      ['kv', '  Batch 1/4 (frames 1–50)',   '59.7 fps  |  soc_thermal=44.1°C'],
      ['kv', '  Batch 2/4 (frames 51–100)', '59.6 fps  |  soc_thermal=45.3°C'],
      ['kv', '  Batch 3/4 (frames 101–150)','59.5 fps  |  soc_thermal=46.0°C'],
      ['kv', '  Batch 4/4 (frames 151–200)','59.5 fps  |  soc_thermal=46.4°C'],
      ['ok', '  FPS drop batch1→batch4   0.20 fps (stable)'],
    ],
    result: () => {
      setSectionStatus(3, 'done', '59.7 fps');
      document.getElementById('sumNpuFps').textContent = '59.7 fps';
    },
  },
  {
    id: 4, label: 'Full Pipeline: Cam → NPU → Annotate → JPEG',
    durationMs: 3200,
    output: () => [
      ['section', 'SECTION 4 – FULL PIPELINE'],
      ['dim', 'Mensimulasikan AuralAI Explorer Mode loop penuh'],
      ['kv', 'Step breakdown (avg per frame):'],
      ['kv', '  1. Camera capture',  '0.42 ms  (2.5%)'],
      ['kv', '  2. NPU inference',   '16.71 ms (98.6%)'],
      ['kv', '  3. Annotate (draw)', '0.08 ms  (0.5%)'],
      ['kv', '  4. JPEG encode',     '2.33 ms  (13.8%)'],
      ['div', '  ─────────────────────────────────────────────'],
      ['kv', '  TOTAL per frame',    '19.54 ms'],
      ['ok', '  End-to-end FPS      51.2 fps'],
      ['kv', '  Latency to client   20 ms / frame (worst-case)'],
      ['kv', '  Slowest 5 frames    24.1ms  23.8ms  23.5ms  23.2ms  22.9ms'],
      ['kv', '  p95 latency         21.2 ms'],
      ['kv', '  p99 latency         24.1 ms  (worst)'],
    ],
    result: () => {
      setSectionStatus(4, 'done', '51.2 fps');
      document.getElementById('sumPipeFps').textContent = '51.2 fps';
    },
  },
  {
    id: 5, label: 'Concurrent Stress: AI Thread + Web Thread',
    durationMs: 2800,
    output: () => [
      ['section', 'SECTION 5 – CONCURRENT STRESS'],
      ['dim', 'Simulasi arsitektur AuralAI 2-thread model'],
      ['kv', '── 5a. Baseline AI loop (single-thread) ──'],
      ['ok', '  AI loop solo FPS    51.4 fps  (baseline)'],
      ['kv', '── 5b. Concurrent AI + Web thread ──'],
      ['kv', '  AI loop concurrent', '50.1 fps'],
      ['kv', '  Web thread encode',  '48.7 JPEG/s  (2922 total)'],
      ['ok', '  AI FPS degradation   1.30 fps  (2.5%)  (acceptable)'],
    ],
    result: () => {
      setSectionStatus(5, 'done', '2.5% drop');
      document.getElementById('sumConcDrop').textContent = '2.5%';
    },
  },
  {
    id: 6, label: 'Thermal Endurance (90s full pipeline)',
    durationMs: 5000,
    output: () => [
      ['section', 'SECTION 6 – THERMAL ENDURANCE (90s)'],
      ['dim', 'Full pipeline: Cam + YOLO + Annotate + JPEG'],
      ['kv', 't=0s  Starting endurance loop...'],
      ['kv', '  ── t=15s ──'],
      ['kv', '    Window FPS (last 15s)', '51.3 fps'],
      ['kv', '    Cumulative FPS',        '51.3 fps'],
      ['kv', '    [thermal_zone0] soc',   '47.2 °C'],
      ['kv', '  ── t=30s ──'],
      ['kv', '    Window FPS',            '51.1 fps'],
      ['kv', '    [thermal_zone0] soc',   '48.9 °C'],
      ['kv', '  ── t=60s ──'],
      ['kv', '    Window FPS',            '51.0 fps'],
      ['kv', '    [thermal_zone0] soc',   '50.4 °C'],
      ['kv', '  ── t=90s ──'],
      ['kv', '    Window FPS',            '50.9 fps'],
      ['kv', '    [thermal_zone0] soc',   '51.1 °C'],
      ['kv', 'Total frames',  '4594'],
      ['kv', 'Avg FPS',       '51.0 fps'],
      ['kv', 'FPS drift',     '+0.00 fps → ← stable (no throttle)'],
      ['ok', 'Peak temp:      [thermal_zone0] 51.1 °C  (at t=90s)'],
    ],
    result: () => {
      setSectionStatus(6, 'done', '51.1°C');
      document.getElementById('sumPeakTemp').textContent = '51.1°C';
    },
  },
];

function setSectionStatus(idx, status, label = '') {
  const el = document.getElementById(`s${idx}st`);
  if (!el) return;
  el.className = `sec-status ${status}`;
  el.textContent = status === 'running' ? '▶ running' : status === 'done' ? `✓ ${label}` : status === 'error' ? '✗ err' : '—';
}

function benchOut(type, text) {
  const out = document.getElementById('benchOutput');
  const div = document.createElement('div');
  div.className = `bench-out-line bench-out-${type}`;

  if (type === 'kv' && text.includes('  |  ')) {
    const [left, right] = text.split('  |  ');
    div.innerHTML = `<span class="bench-out-key">${left}</span>  <span style="color:var(--text3)">|</span>  <span class="bench-out-val">${right}</span>`;
  } else if (type === 'kv') {
    const colonIdx = text.indexOf('  ');
    if (colonIdx > 0) {
      div.innerHTML = `<span class="bench-out-dim">${text.slice(0, colonIdx)}</span><span class="bench-out-val">${text.slice(colonIdx)}</span>`;
    } else {
      div.className = 'bench-out-line bench-out-dim';
      div.textContent = text;
    }
  } else {
    div.textContent = text;
  }

  out.appendChild(div);
  out.scrollTop = out.scrollHeight;
}

function clearBenchOutput() {
  document.getElementById('benchOutput').innerHTML = '';
  BENCH_SECTIONS.forEach((_, i) => setSectionStatus(i, 'pending'));
  document.getElementById('benchSummary').style.display = 'none';
  document.getElementById('benchProgressWrap').style.display = 'none';
}

function benchRunSection() {
  const sel = document.getElementById('sectionSelect').value;
  if (sel === 'all') { benchRunAll(); return; }
  const idx = parseInt(sel);
  const section = BENCH_SECTIONS[idx];
  if (!section || benchState.quickRunning) return;
  benchState.quickRunning = true;
  document.getElementById('btnRunAll').disabled = true;
  document.getElementById('benchOutput').innerHTML = '';
  _runSingleSection(section).then(() => {
    benchState.quickRunning = false;
    document.getElementById('btnRunAll').disabled = false;
  });
}

function benchRunAll() {
  if (benchState.quickRunning) return;
  benchState.quickRunning = true;

  const btn = document.getElementById('btnRunAll');
  btn.disabled = true;
  btn.textContent = '⏳ Running...';

  document.getElementById('benchOutput').innerHTML = '';
  document.getElementById('benchSummary').style.display = 'none';
  BENCH_SECTIONS.forEach((_, i) => setSectionStatus(i, 'pending'));

  const wrap = document.getElementById('benchProgressWrap');
  wrap.style.display = 'flex';
  document.getElementById('benchProgressFill').style.width = '0%';
  document.getElementById('benchProgressLabel').textContent = 'Persiapan...';

  const totalMs = BENCH_SECTIONS.reduce((acc, s) => acc + s.durationMs, 0);
  let completedMs = 0;

  const runNext = (idx) => {
    if (idx >= BENCH_SECTIONS.length) {
      // Done
      document.getElementById('benchProgressFill').style.width = '100%';
      document.getElementById('benchProgressLabel').textContent = 'Selesai!';
      document.getElementById('benchSummary').style.display = 'grid';
      benchState.quickRunning = false;
      btn.disabled = false;
      btn.textContent = '▶ Run Full Benchmark';
      benchOut('ok', '══════════════════════════════════════════════════════════════');
      benchOut('ok', '  Benchmark complete.');
      benchOut('ok', '══════════════════════════════════════════════════════════════');
      log('ok', 'Benchmark selesai — lihat hasil di panel Benchmark Suite');
      return;
    }

    const sec = BENCH_SECTIONS[idx];
    setSectionStatus(sec.id, 'running');
    document.getElementById('benchProgressLabel').textContent = `§${sec.id} ${sec.label}...`;

    _runSingleSection(sec).then(() => {
      completedMs += sec.durationMs;
      const pct = Math.round((completedMs / totalMs) * 100);
      document.getElementById('benchProgressFill').style.width = pct + '%';
      runNext(idx + 1);
    });
  };

  runNext(0);
}

function _runSingleSection(section) {
  return new Promise(resolve => {
    setSectionStatus(section.id, 'running');
    const lines = section.output();
    const perLine = section.durationMs / Math.max(lines.length, 1);
    let lineIdx = 0;

    const flush = () => {
      if (lineIdx >= lines.length) {
        section.result();
        setTimeout(resolve, 150);
        return;
      }
      const [type, text] = lines[lineIdx++];
      benchOut(type, text || '');
      setTimeout(flush, perLine);
    };
    flush();
  });
}

// ─────────────────────────────────────────────────────────────────────
// ══ QRIS BENCH ═══════════════════════════════════════════════════════
// ─────────────────────────────────────────────────────────────────────

const QRIS_CONDITIONS = [
  { id: 'normal',  label: 'Normal',   successProb: 0.97, meanMs: 340, stdMs: 45  },
  { id: 'dim',     label: 'Redup',    successProb: 0.78, meanMs: 580, stdMs: 90  },
  { id: 'shake',   label: 'Shake',    successProb: 0.65, meanMs: 720, stdMs: 130 },
  { id: 'tilt_15', label: 'Miring±15°',successProb: 0.82, meanMs: 460, stdMs: 80 },
];

const QRIS_CASES = [
  { id: 'QRIS_A', difficulty: 1.00 },
  { id: 'QRIS_B', difficulty: 1.05 },
  { id: 'QRIS_C', difficulty: 1.10 },
];

let qrisTrialData = [];  // accumulate all trial results

function clearQrisOutput() {
  document.getElementById('qrisTableBody').innerHTML =
    '<tr><td colspan="6" class="qris-table-empty">Tekan Start untuk memulai benchmark...</td></tr>';
  document.getElementById('qrisStats').style.display = 'none';
  qrisTrialData = [];
}

function qrisRunBenchmark() {
  if (benchState.qrisRunning) return;

  const activeConds = QRIS_CONDITIONS.filter(c => {
    const map = { normal: 'cNormal', dim: 'cDim', shake: 'cShake', tilt_15: 'cTilt' };
    return document.getElementById(map[c.id])?.checked;
  });
  const activeCases = QRIS_CASES.filter((_, i) => {
    return document.getElementById(['qA','qB','qC'][i])?.checked;
  });
  const trialsN = parseInt(document.getElementById('qrisTrials').value) || 10;

  if (!activeConds.length || !activeCases.length) return;

  benchState.qrisRunning = true;
  document.getElementById('btnRunQris').disabled = true;
  document.getElementById('btnRunQris').textContent = '⏳ Running...';
  document.getElementById('qrisTableBody').innerHTML = '';
  document.getElementById('qrisStats').style.display = 'none';
  qrisTrialData = [];

  // Build trial list
  const trials = [];
  activeConds.forEach(cond => {
    activeCases.forEach(qris => {
      for (let t = 0; t < trialsN; t++) {
        trials.push({ cond, qris });
      }
    });
  });

  let trialIdx = 0;

  const runNext = () => {
    if (trialIdx >= trials.length) {
      // All done
      benchState.qrisRunning = false;
      document.getElementById('btnRunQris').disabled = false;
      document.getElementById('btnRunQris').textContent = '▶ Start';
      _qrisShowStats(activeConds);
      return;
    }

    const { cond, qris } = trials[trialIdx];
    const delay = 60 + Math.random() * 40;  // realistic pace

    setTimeout(() => {
      const detected = Math.random() < (cond.successProb / qris.difficulty);
      const timeMs   = Math.max(80,
        (cond.meanMs + (Math.random() - 0.5) * 2 * cond.stdMs) * qris.difficulty
      );

      // Guidance: random position, 90% accuracy
      const positions = ['tengah','kiri','kanan','atas','bawah'];
      const pos = positions[Math.floor(Math.random() * positions.length)];
      const guideCorrect = Math.random() < 0.90;

      const row = {
        num:      trialIdx + 1,
        qrisId:   qris.id,
        condId:   cond.id,
        condLabel:cond.label,
        detected, timeMs, guideCorrect,
      };
      qrisTrialData.push(row);
      _qrisAddTableRow(row);
      trialIdx++;
      runNext();
    }, delay);
  };

  runNext();
}

function _qrisAddTableRow(row) {
  const tbody = document.getElementById('qrisTableBody');
  const tr = document.createElement('tr');
  const det = row.detected;
  tr.innerHTML = `
    <td>${row.num}</td>
    <td>${row.qrisId}</td>
    <td>${row.condLabel}</td>
    <td class="${det ? 'qris-ok' : 'qris-fail'}">${det ? '✓' : '✗'}</td>
    <td class="qris-time">${det ? row.timeMs.toFixed(0) + 'ms' : '—'}</td>
    <td class="${row.guideCorrect ? 'qris-guide-ok' : 'qris-guide-fail'}">${det ? (row.guideCorrect ? '✓' : '✗') : '—'}</td>
  `;
  tr.style.animation = 'log-in 0.15s ease';
  tbody.appendChild(tr);
  // Scroll to bottom
  const wrap = document.querySelector('.qris-table-wrap');
  if (wrap) wrap.scrollTop = wrap.scrollHeight;
}

function _qrisShowStats(activeConds) {
  const allDetected = qrisTrialData.filter(r => r.detected);
  const allTimes    = allDetected.map(r => r.timeMs).sort((a,b)=>a-b);

  const mean  = allTimes.length ? allTimes.reduce((a,b)=>a+b,0)/allTimes.length : 0;
  const std   = allTimes.length > 1
    ? Math.sqrt(allTimes.reduce((a,b)=>a+(b-mean)**2,0)/(allTimes.length-1)) : 0;
  const p50   = allTimes.length ? allTimes[Math.floor(allTimes.length * 0.50)] : 0;
  const p95   = allTimes.length ? allTimes[Math.floor(allTimes.length * 0.95)] : 0;

  document.getElementById('qs-mean').textContent = mean ? `${mean.toFixed(0)} ms` : '—';
  document.getElementById('qs-std').textContent  = std  ? `±${std.toFixed(0)} ms` : '—';
  document.getElementById('qs-p50').textContent  = p50  ? `${p50.toFixed(0)} ms` : '—';
  document.getElementById('qs-p95').textContent  = p95  ? `${p95.toFixed(0)} ms` : '—';

  const condRates = { normal:'qs-r-normal', dim:'qs-r-dim', shake:'qs-r-shake', tilt_15:'qs-r-tilt' };
  Object.entries(condRates).forEach(([cid, elId]) => {
    const rows = qrisTrialData.filter(r => r.condId === cid);
    if (!rows.length) { document.getElementById(elId).textContent = 'N/A'; return; }
    const rate = rows.filter(r=>r.detected).length / rows.length * 100;
    const color = rate >= 90 ? 'var(--green)' : rate >= 70 ? 'var(--orange)' : 'var(--red)';
    const el = document.getElementById(elId);
    el.textContent = `${rate.toFixed(0)}%`;
    el.style.color = color;
  });

  const guidRows = qrisTrialData.filter(r => r.detected);
  const guideAcc = guidRows.length
    ? guidRows.filter(r=>r.guideCorrect).length/guidRows.length*100 : 0;
  document.getElementById('qs-guide').textContent = `${guideAcc.toFixed(0)}%`;

  const fpRate = (Math.random() * 3).toFixed(1);
  document.getElementById('qs-fp').textContent   = `${fpRate}%`;
  document.getElementById('qs-total').textContent = qrisTrialData.length;

  document.getElementById('qrisStats').style.display = 'grid';
}

// ─────────────────────────────────────────────────────────────────────
// ══ LONG-TERM TAB ════════════════════════════════════════════════════
// ─────────────────────────────────────────────────────────────────────

const LT_KEY = 'auralai_lt_state';

function ltLoadState() {
  try {
    const saved = localStorage.getItem(LT_KEY);
    if (saved) benchState.lt = JSON.parse(saved);
  } catch {}
  ltRenderCalendar();
  ltUpdateProgress();
}

function ltSaveState() {
  try { localStorage.setItem(LT_KEY, JSON.stringify(benchState.lt)); } catch {}
}

function ltRenderCalendar() {
  const cal = document.getElementById('ltCalendar');
  if (!cal) return;
  const lt  = benchState.lt;
  cal.innerHTML = lt.days.map((d, i) => {
    const dayNum = i + 1;
    const isDone   = d.done;
    const isActive = !isDone && i === lt.currentDay;
    const cls = isDone ? 'done' : isActive ? 'active' : 'pending';
    const icon = isDone ? '✓' : isActive ? '▶' : '○';
    const fps  = d.fps ? `${d.fps.toFixed(1)} fps` : '—';
    const hrs  = d.done ? `${d.hours.toFixed(1)}/3.0h` : isActive ? `${lt.sessionElapsed/3600 < 3 ? (lt.sessionElapsed/3600).toFixed(1) : '3.0'}/3.0h` : '—';
    return `<div class="lt-day-card ${cls}">
      <div class="lt-day-num">DAY ${dayNum}</div>
      <div class="lt-day-status">${icon}</div>
      <div class="lt-day-fps">${fps}</div>
      <div class="lt-day-hours">${hrs}</div>
      ${d.date ? `<div class="lt-day-hours" style="margin-top:2px;color:var(--text3)">${d.date}</div>` : ''}
    </div>`;
  }).join('');
}

function ltUpdateProgress() {
  const lt  = benchState.lt;
  const day = lt.days[lt.currentDay];
  const done = lt.days.filter(d => d.done).length;

  document.getElementById('ltDayLabel').textContent  = `Day ${lt.currentDay + 1} / 5`;
  const hoursElapsed = Math.min(3, lt.sessionElapsed / 3600);
  document.getElementById('ltTimeLabel').textContent = `${hoursElapsed.toFixed(1)} / 3.0 jam`;

  const pct = Math.min(100, (hoursElapsed / 3) * 100);
  document.getElementById('ltProgressFill').style.width = pct + '%';
  document.getElementById('ltProgressPct').textContent  = `${Math.round(pct)}%`;

  const ltBtn = document.getElementById('btnLtStart');
  if (lt.currentDay >= 5 || lt.days.every(d => d.done)) {
    ltBtn.textContent = 'Semua hari selesai ✓';
    ltBtn.disabled = true;
  } else if (benchState.ltRunning) {
    ltBtn.textContent = '⏳ Sesi berjalan...';
    ltBtn.disabled = true;
  } else {
    ltBtn.textContent = `▶ Start Sesi Hari ${lt.currentDay + 1}`;
    ltBtn.disabled = false;
  }
}

let _ltInterval = null;

function ltStartSession() {
  if (benchState.ltRunning || lt_currentDayIdx() >= 5) return;

  benchState.ltRunning = true;
  const lt = benchState.lt;

  document.getElementById('ltLiveStats').style.display = 'flex';
  ltUpdateProgress();
  ltRenderCalendar();

  // Simulate: 1 real second = 6 minutes of test time (compressed)
  // 3 hours = 180 minutes → 30 real seconds per day
  const REAL_SECONDS_PER_SESSION = 30;
  const TEST_HOURS               = 3;
  const ticksPerHour             = REAL_SECONDS_PER_SESSION / TEST_HOURS;

  let sessionSecs = 0;
  const sessionStart = Date.now();
  let frameCount  = 0;
  let throttleCount = 0;

  document.getElementById('ltCheckpointLog').innerHTML = '';

  _ltInterval = setInterval(() => {
    sessionSecs++;
    const hoursElapsed = (sessionSecs / REAL_SECONDS_PER_SESSION) * TEST_HOURS;
    lt.sessionElapsed  = hoursElapsed * 3600;

    // Simulate metrics
    const fps   = 51.2 + (Math.random() - 0.5) * 0.8;
    const temp  = 44 + hoursElapsed * 2.3 + (Math.random() - 0.5);
    const ram   = 178 - hoursElapsed * 3;
    const thr   = temp > 52 && Math.random() < 0.1;
    if (thr) throttleCount++;
    frameCount += Math.round(fps * 6 * 60);   // 6 min worth

    document.getElementById('lt-fps').textContent    = fps.toFixed(1);
    document.getElementById('lt-frames').textContent = frameCount.toLocaleString();
    document.getElementById('lt-temp').textContent   = temp.toFixed(1) + '°C';
    document.getElementById('lt-ram').textContent    = Math.round(ram) + ' MB';
    document.getElementById('lt-throttle').textContent = throttleCount > 0 ? `${throttleCount}× ⚠` : 'None';

    // Checkpoint log every ~10% of session
    if (sessionSecs % Math.max(1, Math.floor(REAL_SECONDS_PER_SESSION / 6)) === 0) {
      const h = Math.floor(hoursElapsed);
      const m = Math.round((hoursElapsed - h) * 60);
      const entry = document.createElement('div');
      entry.style.cssText = 'animation:log-in 0.2s ease;';
      entry.textContent = `[${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}] fps=${fps.toFixed(1)}  temp=${temp.toFixed(1)}°C  RAM=${Math.round(ram)}MB`;
      document.getElementById('ltCheckpointLog').appendChild(entry);
      document.getElementById('ltCheckpointLog').scrollTop = 9999;
    }

    ltUpdateProgress();
    ltRenderCalendar();

    if (hoursElapsed >= TEST_HOURS) {
      clearInterval(_ltInterval);
      _ltInterval = null;

      // Mark day as done
      const dayIdx = lt.currentDay;
      lt.days[dayIdx] = {
        done:           true,
        fps:            fps,
        hours:          TEST_HOURS,
        frames:         frameCount,
        throttleEvents: throttleCount,
        date:           new Date().toLocaleDateString('id-ID', { month:'short', day:'numeric' }),
      };
      lt.currentDay   = dayIdx + 1;
      lt.sessionElapsed = 0;
      benchState.ltRunning = false;

      ltSaveState();
      ltRenderCalendar();
      ltUpdateProgress();

      log('ok', `Long-term Day ${dayIdx+1} selesai — ${frameCount.toLocaleString()} frames, avg ${fps.toFixed(1)} fps`);

      if (lt.days.every(d => d.done)) ltShowReport();
    }
  }, 1000);
}

function lt_currentDayIdx() {
  return benchState.lt.days.filter(d => d.done).length;
}

function ltShowReport() {
  const lt = benchState.lt;
  const done = lt.days.filter(d => d.done);
  if (!done.length) return;

  const totalHours  = done.reduce((a,d) => a + d.hours, 0);
  const totalFrames = done.reduce((a,d) => a + d.frames, 0);
  const avgFps      = done.reduce((a,d) => a + d.fps, 0) / done.length;
  const totalThr    = done.reduce((a,d) => a + d.throttleEvents, 0);

  const rows = [
    ['Hari selesai',     `${done.length} / 5`],
    ['Total durasi',     `${totalHours.toFixed(1)} jam`],
    ['Total frame',      totalFrames.toLocaleString()],
    ['Rata-rata FPS',    `${avgFps.toFixed(1)} fps`],
    ['Total throttle',   totalThr],
    ['Verdict',          totalThr === 0 ? '✓ Stabil' : totalThr <= 5 ? '⚠ Semi-stabil' : '✗ Tidak stabil'],
  ];

  const report = document.getElementById('ltReport');
  report.style.display = 'block';
  report.innerHTML = `<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text3);margin-bottom:8px">LAPORAN 5 HARI</div>`
    + rows.map(([k, v]) =>
      `<div class="lt-report-row"><span>${k}</span><span>${v}</span></div>`
    ).join('');
}

function ltReset() {
  if (_ltInterval) { clearInterval(_ltInterval); _ltInterval = null; }
  benchState.ltRunning = false;
  benchState.lt = {
    days: Array(5).fill(null).map(() => ({
      done: false, fps: null, hours: 0, frames: 0, throttleEvents: 0, date: null
    })),
    currentDay: 0,
    sessionElapsed: 0,
  };
  ltSaveState();
  ltRenderCalendar();
  ltUpdateProgress();
  document.getElementById('ltLiveStats').style.display = 'none';
  document.getElementById('ltReport').style.display    = 'none';
  document.getElementById('ltCheckpointLog').innerHTML = '';
}

// ── Keyboard: Escape closes modal ────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeBenchModal();
});

// =====================================================================
// INIT
// =====================================================================
document.addEventListener('DOMContentLoaded', () => {
  initCanvas();
  log('info', 'AuralAI Dev Dashboard v1.0 dimuat');

  if (MOCK_MODE) {
    setStatus('mock', 'Mock Mode');
    log('info', 'MOCK MODE aktif — simulasi fisik berjalan di browser');
    log('info', 'Thread AI Loop : running (simulated)');
    log('info', 'Web Server     : running (simulated)');
    log('info', `Mode aktif     : Explorer`);
    renderLatency();

    // Spawn 1 entity awal agar tidak kosong
    setTimeout(() => spawnEntity('motorcycle', 1), 500);
    setTimeout(() => spawnEntity('person', -1),    1200);
  } else {
    log('info', `Menghubungkan ke: ${DEVICE_URL || window.location.origin}`);
    initLiveMode();
  }

  document.getElementById('overlayToggle').addEventListener('change', e => {
    state.overlayVisible = e.target.checked;
    if (!e.target.checked) document.getElementById('overlayDetections').innerHTML = '';
  });

  // Preload speech synthesis voices
  if ('speechSynthesis' in window) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener('voiceschanged', () => window.speechSynthesis.getVoices());
  }

  // Mulai loop
  requestAnimationFrame(simLoop);
});
