'use strict';

/* =====================================================
   HOP ACROSS 3D - a Crossy Road style game
   Made with plain HTML, CSS 3D transforms and JavaScript.
   Rows are numbered upward: row 0 is at the bottom and
   the number grows as you move forward.
   Game logic uses a flat grid; the 3D look comes from
   tilting that grid like a floor (see style.css).
   ===================================================== */

// ---------- Settings you can tweak ----------
const COLS = 9;            // squares across the playable area
const VISIBLE_ROWS = 10;   // board height in squares (used for sizing)
const ROWS_AHEAD = 18;     // how many rows to build in front of the player
const START_ROW = 4;       // the player starts on this row
const OFF = 4;             // extra scenery columns on each side of the road
const TILT = 52;           // camera tilt in degrees (0 = flat top-down)
const CAR_COLORS = ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93', '#ff924c'];
const CAR_TYPES = [        // w = how many squares wide
  { w: 1 }, { w: 1 }, { w: 1 },
  { w: 1.8, bus: true },
  { w: 1.8, truck: true },
];

// ---------- Page elements ----------
const $ = (id) => document.getElementById(id);
const boardEl = $('board');
const worldEl = $('world');
const playerEl = $('player');
const turnEl = $('turn');
const hopEl = $('hop');
const scoreEl = $('score');
const bestEl = $('best');
const overlayEl = $('overlay');
const finalScoreEl = $('finalScore');
const restartBtn = $('restartBtn');

// ---------- Game state ----------
let TILE = 48;             // size of one square in pixels (set by resize())
let rows = new Map();      // row number -> row data
let player;                // { col, row }
let maxRow;                // furthest row reached so far
let generatedUpTo;         // highest row created so far
let camRow, camX;          // camera position (glides towards the player)
let alive;
let lastMoveTime = 0;
let best = 0;

try { best = Number(localStorage.getItem('hopAcrossBest')) || 0; } catch (e) { /* storage may be blocked */ }
bestEl.textContent = best;

// ---------- Small helpers ----------
const randInt = (n) => Math.floor(Math.random() * n);
const pick = (list) => list[randInt(list.length)];

// Restart a CSS animation by removing and re-adding its class
function playAnim(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;     // forces the browser to notice the change
  el.classList.add(cls);
}

/* =====================================================
   3D BUILDING BLOCK
   box() makes a block from four CSS faces. Sizes and
   positions are measured in tiles:
   w = width, d = depth, h = height, x/y/z = position.
   ===================================================== */
function box(parent, w, d, h, color, x, y, z) {
  const el = document.createElement('div');
  el.className = 'box';
  el.style.cssText = `--w:${w};--d:${d};--h:${h};--x:${x};--y:${y};--z:${z};--c:${color}`;
  el.innerHTML = '<i class="t"></i><i class="f"></i><i class="l"></i><i class="r"></i>';
  parent.appendChild(el);
  return el;
}

// A group is an empty holder we can move around (a tree, a car...)
function group(parent, x) {
  const g = document.createElement('div');
  g.className = 'g';
  g.style.setProperty('--x', x);
  parent.appendChild(g);
  return g;
}

/* ---------- The chicken, built from boxes (it faces "up", away from us) ---------- */
function buildChicken() {
  box(hopEl, 0.5, 0.55, 0.42, '#ffffff', 0.25, 0.28, 0);       // body
  box(hopEl, 0.3, 0.3, 0.3, '#ffffff', 0.35, 0.12, 0.42);      // head
  box(hopEl, 0.1, 0.22, 0.12, '#e63946', 0.45, 0.16, 0.72);    // comb
  box(hopEl, 0.14, 0.14, 0.1, '#ff9f1c', 0.43, 0.0, 0.5);      // beak
  box(hopEl, 0.1, 0.12, 0.16, '#ffffff', 0.45, 0.78, 0.15);    // tail
}

/* ---------- Scenery ---------- */
function buildTree(parent, x) {
  const g = group(parent, x);
  const tall = 0.45 + Math.random() * 0.25;
  box(g, 0.2, 0.2, 0.35, '#8d5a2b', 0.4, 0.4, 0);                         // trunk
  box(g, 0.7, 0.7, tall, '#3f9b4b', 0.15, 0.15, 0.35);                    // leaves
  box(g, 0.42, 0.42, 0.25, '#58b85f', 0.29, 0.29, 0.35 + tall);          // top leaves
}
function buildRock(parent, x) {
  box(group(parent, x), 0.6, 0.5, 0.3, '#9aa0a6', 0.2, 0.25, 0);
}
function buildFlower(parent, x) {
  const g = group(parent, x);
  const cx = 0.2 + Math.random() * 0.5, cy = 0.2 + Math.random() * 0.5;
  box(g, 0.14, 0.14, 0.12, pick(['#ff7096', '#fff3b0', '#ffffff']), cx, cy, 0);
}

/* ---------- Cars are boxes too: wheels, body and a cabin ---------- */
function buildCar(row, kind) {
  const g = group(row.el, 0);
  const dir = row.dir;
  const bw = kind.w * 0.92, x0 = kind.w * 0.04;      // body width and left margin
  box(g, bw - 0.1, 0.64, 0.12, '#222', x0 + 0.05, 0.18, 0);                       // wheels / underside
  box(g, bw, 0.6, 0.3, kind.color, x0, 0.2, 0.12);                                // body

  let cw, cx;                                         // cabin width and position
  if (kind.truck) { cw = 0.55; cx = dir > 0 ? x0 + bw - cw - 0.04 : x0 + 0.04; }
  else { cw = kind.bus ? bw * 0.88 : bw * 0.55; cx = x0 + (bw - cw) / 2; }
  box(g, cw, 0.5, 0.26, '#cfeaf7', cx, 0.25, 0.42);                               // cabin / windows
  if (kind.truck) {
    box(g, bw - cw - 0.12, 0.58, 0.45, '#f4f4f4', dir > 0 ? x0 + 0.04 : x0 + cw + 0.08, 0.21, 0.42); // cargo
  }
  return g;
}

/* =====================================================
   SIZING - make the board fit any screen
   ===================================================== */
function resize() {
  const maxW = Math.min(window.innerWidth - 24, 560);
  const maxH = window.innerHeight - 250;      // leave room for header and buttons
  TILE = Math.max(24, Math.floor(Math.min(maxW / COLS, maxH / VISIBLE_ROWS, 56)));
  document.documentElement.style.setProperty('--tile', TILE + 'px');
}

/* =====================================================
   BUILDING THE WORLD
   ===================================================== */
function makeRow(r) {
  const prev = rows.get(r - 1);
  const prevStreak = prev && prev.type === 'road' ? prev.streak : 0;

  // Grass or road? The first rows are always safe grass.
  // After 3 roads in a row, grass becomes much more likely.
  let type = 'grass';
  if (r >= START_ROW + 2) {
    const roadChance = prev.type === 'road' ? (prevStreak >= 3 ? 0.1 : 0.65) : 0.8;
    type = Math.random() < roadChance ? 'road' : 'grass';
  }

  const el = document.createElement('div');
  el.className = 'row ' + type + (r % 2 ? ' alt' : '');
  el.style.setProperty('--r', r);

  const row = {
    type, el,
    blocked: new Set(),                       // columns with a tree or rock
    cars: [],
    streak: type === 'road' ? prevStreak + 1 : 0,
  };

  if (type === 'grass') {
    // Keep one column free (also free in the grass row below) so you never get trapped
    const open = [];
    for (let c = 0; c < COLS; c++) {
      if (!(prev && prev.type === 'grass' && prev.blocked.has(c))) open.push(c);
    }
    const safeCol = pick(open);
    const plain = (r === START_ROW || r === START_ROW + 1);   // keep the start area clear

    // Columns -OFF..-1 and COLS..COLS+OFF-1 are scenery outside the playable area
    for (let c = -OFF; c < COLS + OFF; c++) {
      const inside = c >= 0 && c < COLS;
      if (inside && (c === safeCol || plain)) continue;
      const roll = Math.random();
      if (roll < (inside ? 0.2 : 0.4)) {
        if (inside && Math.random() < 0.25) buildRock(el, c + OFF);
        else buildTree(el, c + OFF);
        if (inside) row.blocked.add(c);       // only trees inside the road area block you
      } else if (roll < 0.5 && inside) {
        buildFlower(el, c + OFF);
      }
    }
  } else {
    // Road: every car in this lane goes the same direction at the same speed
    row.dir = Math.random() < 0.5 ? -1 : 1;
    row.speed = 1.4 + Math.random() * 2 + Math.min(maxRow * 0.02, 1.2);   // faster as you go
    const length = COLS + 4;                  // cars travel from -2 to COLS+2, then wrap around
    const count = 2 + randInt(2);             // 2 or 3 cars per lane
    const spacing = length / count;
    const offset = Math.random() * spacing;

    for (let i = 0; i < count; i++) {
      const kind = Object.assign({ color: pick(CAR_COLORS) }, pick(CAR_TYPES));
      row.cars.push({ x: -2 + offset + i * spacing, w: kind.w, el: buildCar(row, kind) });
    }
  }

  worldEl.appendChild(el);
  rows.set(r, row);
}

// Keep rows coming in the distance, and remove rows far behind us
function updateRows() {
  while (generatedUpTo < player.row + ROWS_AHEAD) makeRow(++generatedUpTo);
  rows.forEach((row, r) => {
    if (r < camRow - 3) { row.el.remove(); rows.delete(r); }
  });
}

/* =====================================================
   STARTING / RESTARTING
   ===================================================== */
function startGame() {
  rows.forEach((row) => row.el.remove());
  rows.clear();

  player = { col: Math.floor(COLS / 2), row: START_ROW };
  maxRow = START_ROW;
  generatedUpTo = -1;
  camRow = maxRow - 3;
  camX = 0;
  alive = true;

  // Jump the chicken to its start square without sliding there
  playerEl.classList.add('no-anim');
  playerEl.classList.remove('dead');
  turnEl.style.setProperty('--a', '0deg');
  drawPlayer();
  void playerEl.offsetWidth;
  playerEl.classList.remove('no-anim');

  scoreEl.textContent = 0;
  overlayEl.classList.add('hidden');
  updateRows();
}

function drawPlayer() {
  playerEl.style.setProperty('--c', player.col);
  playerEl.style.setProperty('--r', player.row);
}

/* =====================================================
   MOVING THE PLAYER
   ===================================================== */
const FACING = { '0,1': 0, '1,0': 90, '0,-1': 180, '-1,0': -90 };   // degrees to turn the chicken

function move(dCol, dRow) {
  if (!alive) return;

  // Small delay between hops so holding a key feels controlled
  const now = performance.now();
  if (now - lastMoveTime < 90) return;
  lastMoveTime = now;

  const newCol = player.col + dCol;
  const newRow = player.row + dRow;

  turnEl.style.setProperty('--a', FACING[dCol + ',' + dRow] + 'deg');   // face the way we hop

  // Stay on the board, and don't walk back off the bottom of the screen
  if (newCol < 0 || newCol >= COLS || newRow < maxRow - 2) return;

  // Trees and rocks block the way: wiggle instead of moving
  const target = rows.get(newRow);
  if (target && target.blocked.has(newCol)) { playAnim(hopEl, 'bump'); return; }

  player.col = newCol;
  player.row = newRow;
  drawPlayer();
  playAnim(hopEl, 'jump');

  // Score goes up only when we reach a new furthest row
  if (newRow > maxRow) {
    maxRow = newRow;
    scoreEl.textContent = maxRow - START_ROW;
    playAnim(scoreEl, 'pop');
  }

  updateRows();
  checkCollision();   // we might have hopped straight into a car
}

/* =====================================================
   COLLISIONS AND GAME OVER
   Cars and the player are compared as simple left/right
   ranges on the same row (the 3D is only for looks).
   ===================================================== */
function checkCollision() {
  const row = rows.get(player.row);
  if (!row || row.type !== 'road') return;

  const pLeft = player.col + 0.2;     // a small margin keeps hits fair
  const pRight = player.col + 0.8;
  for (const car of row.cars) {
    if (pRight > car.x + 0.1 && pLeft < car.x + car.w - 0.1) {
      gameOver();
      return;
    }
  }
}

function gameOver() {
  alive = false;
  playerEl.classList.add('dead');

  const finalScore = maxRow - START_ROW;
  if (finalScore > best) {
    best = finalScore;
    bestEl.textContent = best;
    try { localStorage.setItem('hopAcrossBest', best); } catch (e) { /* ignore */ }
  }
  finalScoreEl.textContent = finalScore;

  // Show the Game Over card after a short pause so the squash is visible
  setTimeout(() => {
    overlayEl.classList.remove('hidden');
    restartBtn.focus();
  }, 450);
}

/* =====================================================
   MAIN LOOP - runs about 60 times per second
   ===================================================== */
let lastTime = performance.now();

function frame(time) {
  const dt = Math.min((time - lastTime) / 1000, 0.05);  // seconds since last frame
  lastTime = time;

  if (alive) {
    // Slide every car along its lane
    rows.forEach((row) => {
      if (row.type !== 'road') return;
      const length = COLS + 4;
      for (const car of row.cars) {
        car.x += row.dir * row.speed * dt;
        // Wrap around when a car leaves the scene
        if (row.dir > 0 && car.x > COLS + 2) car.x -= length;
        if (row.dir < 0 && car.x < -2) car.x += length;
        car.el.style.transform = `translate3d(${(car.x + OFF) * TILE}px, 0, 0)`;
      }
    });
    checkCollision();
  }

  // Camera: glide towards the player (forward and a little sideways)
  const ease = Math.min(1, dt * 6);
  camRow += (maxRow - 3 - camRow) * ease;
  camX += ((player.col - (COLS - 1) / 2) * TILE * 0.35 - camX) * ease;

  // Tilt the whole world backwards (rotateX) so the flat grid becomes a 3D floor,
  // then slide it so the camera stays behind the player.
  worldEl.style.transform =
    `rotateX(${TILT}deg) translate3d(${-camX}px, ${(camRow + 1) * TILE}px, 0)`;

  requestAnimationFrame(frame);
}

/* =====================================================
   CONTROLS
   ===================================================== */

// Keyboard: arrow keys and WASD
const KEYS = {
  ArrowUp: [0, 1],    w: [0, 1],  W: [0, 1],
  ArrowDown: [0, -1], s: [0, -1], S: [0, -1],
  ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0],
  ArrowRight: [1, 0], d: [1, 0],  D: [1, 0],
};

window.addEventListener('keydown', (e) => {
  const dir = KEYS[e.key];
  if (!dir) return;
  e.preventDefault();          // stop arrow keys from scrolling the page
  move(dir[0], dir[1]);
});

// On-screen buttons
const DIRS = { up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0] };
document.querySelectorAll('.dpad button').forEach((btn) => {
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const d = DIRS[btn.dataset.dir];
    move(d[0], d[1]);
  });
});

// Swipe on the board (a quick tap hops forward)
let swipeStart = null;
boardEl.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.overlay')) return;
  swipeStart = { x: e.clientX, y: e.clientY };
});
boardEl.addEventListener('pointerup', (e) => {
  if (!swipeStart) return;
  const dx = e.clientX - swipeStart.x;
  const dy = e.clientY - swipeStart.y;
  swipeStart = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) move(0, 1);        // tap = forward
  else if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 1 : -1, 0);   // horizontal swipe
  else move(0, dy < 0 ? 1 : -1);                                    // vertical swipe
});

restartBtn.addEventListener('click', startGame);
window.addEventListener('resize', resize);

/* =====================================================
   GO!
   ===================================================== */
resize();
buildChicken();
startGame();
requestAnimationFrame(frame);
