/**
 * AuralAI Dev Dashboard — dashboard.js
 *
 * MOCK_MODE = true  → Simulasi penuh di browser (tanpa MaixCAM)
 * MOCK_MODE = false → Sambung ke MaixCAM via HTTP (production mode)
 *
 * Untuk integrasi ke MaixCAM:
 *   1. Set MOCK_MODE = false
 *   2. Set DEVICE_URL ke IP MaixCAM (contoh: http://192.168.1.100:8080)
 *   3. Pastikan CORS header diset di web_server.py MaixCAM
 */

const MOCK_MODE = true;
const DEVICE_URL = '';         // Kosong = same-origin (MaixCAM serve langsung)
const SNAPSHOT_INTERVAL = 500; // ms
const STATUS_INTERVAL = 1000;
const LOG_INTERVAL = 2000;

// =====================================================================
// STATE
// =====================================================================
let state = {
  mode: 'explorer',
  connected: false,
  aiFocusActive: false,
  aiFocusRemaining: 0,
  detections: [],
  latency: { camera: 0, inference: 0, postproc: 0, total: 0, fps: 0 },
  logs: [],
  overlayVisible: true,
  frameCount: 0,
  lastFpsTime: Date.now(),
  fps: 0,
};

// =====================================================================
// MOCK DATA
// =====================================================================
const MOCK_OBJECTS = [
  { label: 'motorcycle', icon: '🏍', color: '#ef4444' },
  { label: 'person',     icon: '🚶', color: '#f59e0b' },
  { label: 'car',        icon: '🚗', color: '#ef4444' },
  { label: 'bicycle',    icon: '🚲', color: '#22c55e' },
  { label: 'bus',        icon: '🚌', color: '#ef4444' },
  { label: 'dog',        icon: '🐕', color: '#22c55e' },
  { label: 'cat',        icon: '🐈', color: '#22c55e' },
  { label: 'bottle',     icon: '🍾', color: '#0096ff' },
  { label: 'bag',        icon: '👜', color: '#a855f7' },
];

const MOCK_POSITIONS = [
  'kiri', 'kanan', 'tengah', 'kiri-atas', 'kanan-atas',
  'bawah', 'kiri-bawah', 'kanan-bawah', 'tengah-atas'
];

const MOCK_SCENE_DESCRIPTIONS = [
  'Jalan raya dengan beberapa kendaraan bermotor. Terlihat sepeda motor di sebelah kiri dan pejalan kaki di tengah.',
  'Area parkir dengan mobil-mobil yang terparkir. Tidak ada pergerakan signifikan terdeteksi.',
  'Trotoar dengan pejalan kaki. Terdapat tiang listrik dan pohon di latar belakang.',
  'Persimpangan jalan. Terlihat traffic light dan beberapa kendaraan menunggu.',
];

const MOCK_QRIS_RESULTS = [
  'MERCHANT: Warung Bu Siti, NOMINAL: Rp 25.000',
  'MERCHANT: Alfamart Jl. Sudirman, NOMINAL: Rp 47.500',
  'BUKAN QRIS — Objek yang terdeteksi bukan kode QRIS.',
  'MERCHANT: GoFood Partner, NOMINAL: tidak tertera',
];

// =====================================================================
// INIT
// =====================================================================
document.addEventListener('DOMContentLoaded', () => {
  log('info', 'AuralAI Dev Dashboard dimuat');

  if (MOCK_MODE) {
    log('info', 'Mode MOCK aktif — data disimulasikan di browser');
    initMockMode();
  } else {
    log('info', `Menghubungkan ke device: ${DEVICE_URL || window.location.origin}`);
    initLiveMode();
  }

  document.getElementById('overlayToggle').addEventListener('change', (e) => {
    state.overlayVisible = e.target.checked;
    document.getElementById('overlayDetections').style.display = e.target.checked ? '' : 'none';
  });
});

// =====================================================================
// MOCK MODE
// =====================================================================
function initMockMode() {
  setStatus('mock', 'Mock Mode');
  log('ok', 'Simulasi dimulai');
  log('info', 'Thread AI Loop: running (simulated)');
  log('info', 'Web Server: running (simulated)');
  log('info', `Mode aktif: ${state.mode}`);

  startMockCamera();
  setInterval(mockGenerateDetections, 2000);
  setInterval(mockUpdateLatency, 3000);
  mockUpdateLatency();
}

// --- Mock Camera (canvas simulation) ---
let mockAnimFrame = 0;
function startMockCamera() {
  const canvas = document.getElementById('cameraCanvas');
  const ctx = canvas.getContext('2d');

  function drawFrame() {
    mockAnimFrame++;
    const t = mockAnimFrame * 0.02;

    // Background gradient simulating scene
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, `hsl(${200 + Math.sin(t * 0.3) * 20}, 30%, 15%)`);
    grad.addColorStop(0.6, `hsl(${210 + Math.cos(t * 0.2) * 15}, 20%, 8%)`);
    grad.addColorStop(1, '#050810');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Road
    ctx.fillStyle = `rgba(30, 30, 35, ${0.8 + Math.sin(t) * 0.1})`;
    ctx.fillRect(0, canvas.height * 0.45, canvas.width, canvas.height * 0.55);

    // Road lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.setLineDash([20, 15]);
    ctx.lineWidth = 2;
    const lineOffset = (mockAnimFrame * 2) % 35;
    for (let x = -35 + lineOffset; x < canvas.width; x += 35) {
      ctx.beginPath();
      ctx.moveTo(x, canvas.height * 0.62);
      ctx.lineTo(x + 20, canvas.height * 0.62);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Moving objects (mock vehicles)
    drawMockVehicle(ctx, t, 0);
    drawMockVehicle(ctx, t + 1.5, 1);

    // Noise overlay
    for (let i = 0; i < 20; i++) {
      const nx = Math.random() * canvas.width;
      const ny = Math.random() * canvas.height;
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`;
      ctx.fillRect(nx, ny, 1, 1);
    }

    // Resolution watermark
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '9px monospace';
    ctx.fillText('320×224', 6, canvas.height - 6);

    // FPS counter
    state.frameCount++;
    const now = Date.now();
    if (now - state.lastFpsTime >= 1000) {
      state.fps = state.frameCount;
      state.frameCount = 0;
      state.lastFpsTime = now;
      document.getElementById('fpsCounter').textContent = `${state.fps} fps`;
    }

    requestAnimationFrame(drawFrame);
  }
  drawFrame();
}

function drawMockVehicle(ctx, t, idx) {
  const speed = 0.4 + idx * 0.2;
  const x = ((t * speed * 80 + idx * 160) % (320 + 60)) - 30;
  const y = 120 + idx * 25;
  const w = 45 + idx * 10;
  const h = 22 + idx * 5;

  ctx.fillStyle = `rgba(${idx === 0 ? '220,80,60' : '60,120,220'}, 0.9)`;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 4);
  ctx.fill();

  // Wheels
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.ellipse(x + 8, y + h, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x + w - 8, y + h, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
}

// --- Mock Detections ---
function mockGenerateDetections() {
  if (state.aiFocusActive) return;

  const count = Math.floor(Math.random() * 3) + 1;
  const newDets = [];

  for (let i = 0; i < count; i++) {
    const obj = MOCK_OBJECTS[Math.floor(Math.random() * MOCK_OBJECTS.length)];
    const pos = MOCK_POSITIONS[Math.floor(Math.random() * MOCK_POSITIONS.length)];
    const conf = (0.5 + Math.random() * 0.45).toFixed(2);
    const area = Math.random();
    const isDanger = area > 0.85;

    newDets.push({
      label: obj.label,
      icon: obj.icon,
      color: obj.color,
      position: pos,
      confidence: parseFloat(conf),
      isDanger,
      x: Math.random() * 0.7,
      y: Math.random() * 0.6 + 0.1,
      w: 0.1 + Math.random() * 0.3,
      h: 0.1 + Math.random() * 0.25,
    });
  }

  state.detections = newDets;
  renderDetections();

  // Trigger audio for highest confidence
  const top = newDets.sort((a, b) => b.confidence - a.confidence)[0];
  if (top) {
    const phrase = buildAudioPhrase(top);
    playMockAudio(phrase);
    log('info', `Detected: <strong>${top.label}</strong> (${top.confidence}) @ ${top.position}${top.isDanger ? ' ⚠ DANGER' : ''}`);
  }
}

function buildAudioPhrase(det) {
  const posMap = {
    'kiri': 'di sebelah kiri', 'kanan': 'di sebelah kanan', 'tengah': 'di depan',
    'kiri-atas': 'di kiri atas', 'kanan-atas': 'di kanan atas',
    'bawah': 'di bawah', 'kiri-bawah': 'di kiri bawah', 'kanan-bawah': 'di kanan bawah',
    'tengah-atas': 'di atas tengah',
  };
  const labelMap = {
    'motorcycle': 'motor', 'person': 'orang', 'car': 'mobil',
    'bicycle': 'sepeda', 'bus': 'bus', 'truck': 'truk',
    'dog': 'anjing', 'cat': 'kucing', 'bottle': 'botol', 'bag': 'tas',
  };
  const label = labelMap[det.label] || det.label;
  const pos = posMap[det.position] || det.position;
  return `${label} ${pos}`;
}

// --- Mock Latency ---
function mockUpdateLatency() {
  const cam = 25 + Math.floor(Math.random() * 20);
  const infer = 75 + Math.floor(Math.random() * 40);
  const post = 4 + Math.floor(Math.random() * 8);
  const total = cam + infer + post;
  const fps = (1000 / total).toFixed(1);

  state.latency = { camera: cam, inference: infer, postproc: post, total, fps };
  renderLatency();
}

// =====================================================================
// LIVE MODE (MaixCAM integration)
// =====================================================================
function initLiveMode() {
  pollStatus();
  pollSnapshot();
  pollLogs();
}

function pollSnapshot() {
  const img = document.getElementById('cameraImg');
  const canvas = document.getElementById('cameraCanvas');

  canvas.style.display = 'none';
  img.style.display = 'block';

  function refresh() {
    if (!state.aiFocusActive) {
      const url = `${DEVICE_URL}/snapshot?t=${Date.now()}`;
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
      img.src = url;
    }
    setTimeout(refresh, SNAPSHOT_INTERVAL);
  }
  refresh();
}

async function pollStatus() {
  try {
    const res = await fetch(`${DEVICE_URL}/status`);
    const data = await res.json();

    setStatus('connected', 'Connected');
    state.mode = data.mode || state.mode;
    state.detections = data.detections || [];
    state.latency = data.latency || state.latency;
    renderDetections();
    renderLatency();

    if (data.audio_text) playMockAudio(data.audio_text);
  } catch (e) {
    setStatus('error', 'Disconnected');
  }
  setTimeout(pollStatus, STATUS_INTERVAL);
}

async function pollLogs() {
  try {
    const res = await fetch(`${DEVICE_URL}/logs`);
    const data = await res.json();
    if (data.logs) {
      data.logs.forEach(entry => log(entry.level || 'info', entry.message));
    }
  } catch (_) {}
  setTimeout(pollLogs, LOG_INTERVAL);
}

// =====================================================================
// COMMANDS
// =====================================================================
async function sendCommand(cmd, extra = {}) {
  const body = { cmd, ...extra };
  if (MOCK_MODE) {
    handleMockCommand(cmd, extra);
    return;
  }
  try {
    const res = await fetch(`${DEVICE_URL}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (e) {
    log('error', `Command failed: ${cmd} — ${e.message}`);
  }
}

function handleMockCommand(cmd, extra) {
  switch (cmd) {
    case 'focus':
      startAiFocus();
      break;
    case 'capture':
      log('ok', 'Frame captured — disimpan ke /root/captures/capture_' + Date.now() + '.jpg');
      flashCamera();
      break;
    case 'qris':
      log('info', 'Memindai QRIS...');
      setAudioBusy();
      setTimeout(() => {
        const result = MOCK_QRIS_RESULTS[Math.floor(Math.random() * MOCK_QRIS_RESULTS.length)];
        playMockAudio(result);
        log('ok', `QRIS: ${result}`);
      }, 1500);
      break;
    case 'describe':
      log('info', 'Mengirim frame ke OpenAI Vision API...');
      setAudioBusy();
      setTimeout(() => {
        const desc = MOCK_SCENE_DESCRIPTIONS[Math.floor(Math.random() * MOCK_SCENE_DESCRIPTIONS.length)];
        playMockAudio(desc);
        log('ok', `Scene: ${desc}`);
      }, 2000);
      break;
    case 'benchmark':
      runMockBenchmark();
      break;
  }
}

function cmdAIFocus() {
  if (!state.aiFocusActive) sendCommand('focus');
}

function cmdCapture() { sendCommand('capture'); }
function cmdQris() { sendCommand('qris'); }
function cmdDescribe() { sendCommand('describe'); }
function cmdBenchmark() { sendCommand('benchmark'); }

function setMode(mode) {
  state.mode = mode;
  state.detections = [];
  renderDetections();

  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  const modeMap = { explorer: 'btnExplorer', context: 'btnContext', qris: 'btnQris' };
  document.getElementById(modeMap[mode])?.classList.add('active');

  const modeNames = { explorer: 'Explorer Mode', context: 'Context Mode', qris: 'Scan QRIS Mode' };
  log('info', `Mode diubah: <strong>${modeNames[mode]}</strong>`);

  if (MOCK_MODE) {
    const phrases = {
      explorer: 'mode penjelajah aktif',
      context: 'mode konteks aktif',
      qris: 'mode scan bayar aktif',
    };
    playMockAudio(phrases[mode]);
  } else {
    sendCommand('set_mode', { mode });
  }
}

// =====================================================================
// AI FOCUS
// =====================================================================
let focusInterval = null;

function startAiFocus() {
  if (state.aiFocusActive) return;

  const DURATION = 5;
  state.aiFocusActive = true;
  state.aiFocusRemaining = DURATION;

  const btn = document.getElementById('btnAiFocus');
  btn.classList.add('running');
  btn.textContent = '⚡ AI Focus 5s';

  document.getElementById('focusSection').style.display = '';
  document.getElementById('focusProgress').style.width = '100%';

  log('warn', 'AI Focus aktif — web snapshot dijeda selama 5 detik');
  playMockAudio('sedang menganalisis');

  let elapsed = 0;
  focusInterval = setInterval(() => {
    elapsed++;
    state.aiFocusRemaining = DURATION - elapsed;
    const pct = ((DURATION - elapsed) / DURATION) * 100;
    document.getElementById('focusProgress').style.width = pct + '%';
    document.getElementById('focusTimer').textContent = `${state.aiFocusRemaining}s`;
    btn.querySelector ? null : null;

    if (elapsed >= DURATION) {
      clearInterval(focusInterval);
      state.aiFocusActive = false;
      btn.classList.remove('running');
      btn.innerHTML = '<span class="ctrl-icon">⚡</span> AI Focus 5s';
      document.getElementById('focusSection').style.display = 'none';
      log('ok', 'AI Focus selesai — snapshot dilanjutkan');
    }
  }, 1000);
}

// =====================================================================
// MOCK BENCHMARK
// =====================================================================
function runMockBenchmark() {
  log('info', 'Menjalankan benchmark semua subsistem...');
  setTimeout(() => {
    const cam = 28 + Math.floor(Math.random() * 10);
    const pre = 6 + Math.floor(Math.random() * 5);
    const infer = 82 + Math.floor(Math.random() * 30);
    const post = 5 + Math.floor(Math.random() * 5);
    const aq = 1 + Math.floor(Math.random() * 3);
    const total = cam + pre + infer + post + aq;
    const fps = (1000 / total).toFixed(1);

    log('ok', `Benchmark selesai:`);
    log('info', `  Camera capture: <strong>${cam}ms</strong>`);
    log('info', `  Preprocessing:  <strong>${pre}ms</strong>`);
    log('info', `  Inference:      <strong>${infer}ms</strong>`);
    log('info', `  Postprocessing: <strong>${post}ms</strong>`);
    log('info', `  Audio queue:    <strong>${aq}ms</strong>`);
    log('ok', `  Total pipeline: <strong>${total}ms</strong> | FPS Est: <strong>${fps}</strong>`);

    state.latency = { camera: cam, inference: infer, postproc: post, total, fps };
    renderLatency();
  }, 1200);
}

// =====================================================================
// AUDIO SIMULATION
// =====================================================================
let audioQueue = [];
let audioPlaying = false;

function playMockAudio(text) {
  audioQueue.push(text);
  processAudioQueue();
}

function setAudioBusy() {
  document.getElementById('audioStatus').textContent = 'Processing...';
  document.getElementById('audioStatus').className = 'badge badge-orange';
}

function processAudioQueue() {
  if (audioPlaying || audioQueue.length === 0) return;
  audioPlaying = true;

  const text = audioQueue.shift();
  document.getElementById('audioText').textContent = text;
  document.getElementById('audioStatus').textContent = 'Playing';
  document.getElementById('audioStatus').className = 'badge badge-green';

  renderAudioQueue();

  if ('speechSynthesis' in window) {
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'id-ID';
    utt.rate = 0.95;

    const voices = window.speechSynthesis.getVoices();
    const idVoice = voices.find(v => v.lang.startsWith('id') || v.lang.startsWith('ms'));
    if (idVoice) utt.voice = idVoice;

    utt.onend = () => {
      audioPlaying = false;
      document.getElementById('audioStatus').textContent = 'Ready';
      document.getElementById('audioStatus').className = 'badge badge-green';
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
      document.getElementById('audioStatus').className = 'badge badge-green';
      processAudioQueue();
    }, 1500);
  }
}

function renderAudioQueue() {
  const el = document.getElementById('audioQueue');
  if (audioQueue.length > 0) {
    el.innerHTML = audioQueue.slice(0, 3).map(t =>
      `<span style="opacity:0.6">⬦ ${t}</span>`
    ).join('');
  } else {
    el.innerHTML = '';
  }
}

// =====================================================================
// RENDER
// =====================================================================
function renderDetections() {
  const list = document.getElementById('detectionList');
  const overlay = document.getElementById('overlayDetections');
  const countBadge = document.getElementById('detectionCount');

  countBadge.textContent = state.detections.length;

  if (state.detections.length === 0) {
    list.innerHTML = '<div class="detection-empty">Waiting for detections...</div>';
    overlay.innerHTML = '';
    return;
  }

  list.innerHTML = state.detections.map(d => {
    const cls = d.isDanger ? 'danger' : d.confidence > 0.7 ? 'normal' : 'warning';
    const dangerTag = d.isDanger ? '<span class="det-danger">⚠ DANGER</span>' : '';
    return `<div class="detection-item ${cls}">
      <span class="det-icon">${d.icon}</span>
      <span class="det-label">${d.label}</span>
      <span class="det-pos">${d.position}</span>
      <span class="det-conf">${d.confidence}</span>
      ${dangerTag}
    </div>`;
  }).join('');

  if (state.overlayVisible) {
    const canvas = document.getElementById('cameraCanvas');
    const W = canvas.offsetWidth || 340;
    const H = canvas.offsetHeight || 238;

    overlay.innerHTML = state.detections.map(d => {
      const x = (d.x * W).toFixed(0);
      const y = (d.y * H).toFixed(0);
      const w = (d.w * W).toFixed(0);
      const h = (d.h * H).toFixed(0);
      return `<div class="detection-box" style="
        left:${x}px; top:${y}px; width:${w}px; height:${h}px;
        border-color:${d.color};
      ">
        <div class="detection-box-label" style="background:${d.color}; color:#000;">
          ${d.label} ${d.confidence}
        </div>
      </div>`;
    }).join('');
  }
}

function renderLatency() {
  const l = state.latency;
  document.getElementById('latCamera').textContent = `${l.camera}ms`;
  document.getElementById('latInference').textContent = `${l.inference}ms`;
  document.getElementById('latPostproc').textContent = `${l.postproc}ms`;
  document.getElementById('latTotal').textContent = `${l.total}ms`;
  document.getElementById('latFps').textContent = l.fps;

  colorizeLatency('latCamera', l.camera, 40, 80);
  colorizeLatency('latInference', l.inference, 100, 150);
  colorizeLatency('latTotal', l.total, 150, 250);

  const maxTotal = 300;
  const camW = Math.min((l.camera / maxTotal) * 100, 40);
  const infW = Math.min((l.inference / maxTotal) * 100, 50);
  const postW = Math.min((l.postproc / maxTotal) * 100, 10);

  document.getElementById('barCamera').style.width = camW + 'px';
  document.getElementById('barInference').style.width = infW + 'px';
  document.getElementById('barPostproc').style.width = postW + 'px';
}

function colorizeLatency(id, val, warnThresh, errThresh) {
  const el = document.getElementById(id);
  if (val > errThresh) el.style.color = 'var(--red)';
  else if (val > warnThresh) el.style.color = 'var(--orange)';
  else el.style.color = 'var(--accent)';
}

// =====================================================================
// STATUS
// =====================================================================
function setStatus(type, text) {
  document.getElementById('statusDot').className = `status-dot ${type}`;
  document.getElementById('statusText').textContent = text;
}

// =====================================================================
// LOGGING
// =====================================================================
const LOG_LEVELS = { info: 'info', warn: 'warn', error: 'error', ok: 'ok' };
const MAX_LOGS = 200;

function log(level, message) {
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

  state.logs.push({ time, level, message });
  if (state.logs.length > MAX_LOGS) state.logs.shift();

  const body = document.getElementById('logBody');
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <span class="log-time">[${time}]</span>
    <span class="log-level ${level}">${level.toUpperCase()}</span>
    <span class="log-msg">${message}</span>
  `;
  body.appendChild(entry);

  if (document.getElementById('autoScrollToggle').checked) {
    body.scrollTop = body.scrollHeight;
  }
}

function clearLogs() {
  state.logs = [];
  document.getElementById('logBody').innerHTML = '';
  log('info', 'Log dibersihkan');
}

// =====================================================================
// UTILS
// =====================================================================
function flashCamera() {
  const frame = document.getElementById('cameraFrame');
  frame.style.transition = 'filter 0.1s';
  frame.style.filter = 'brightness(3)';
  setTimeout(() => { frame.style.filter = ''; }, 150);
}

// Preload speech voices
if ('speechSynthesis' in window) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    window.speechSynthesis.getVoices();
  });
}
