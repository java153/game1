import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// ------------------------------------------------------------
// TUNING VARIABLES
// ------------------------------------------------------------
// strikeZoneDistance/width/height/depth: close, immersive strike zone volume.
// pciSensitivity/pciRadius: PCI movement feel + reticle size.
// swingDurationMs/swingCooldownMs/swingWindowZ: swing animation timing + valid contact zone.
// pitchSpeedMin/Max + breakX/breakY: pitch type variation envelope.
// hit thresholds + impulse values: quality tiers and output ball speed.
const config = {
  strikeZoneDistance: 0.78,
  strikeZoneWidth: 1.25,
  strikeZoneHeight: 1.55,
  strikeZoneDepth: 0.12,

  pciSensitivity: 0.0019,
  pciRadius: 0.13,

  swingDurationMs: 190,
  swingCooldownMs: 380,
  swingWindowZ: 0.38,

  pitchIntervalMs: 1200,
  pitchSpeedMin: 27,
  pitchSpeedMax: 34,
  breakX: 1.9,
  breakY: 1.3,

  hitPlaneTolerance: 0.42,
  perfectPciDist: 0.19,
  goodPciDist: 0.37,
  perfectTiming: 0.11,
  goodTiming: 0.23,
  weakImpulse: 2.9,
  goodImpulse: 4.9,
  perfectImpulse: 6.7,

  restitution: 0.5,
  friction: 0.33
};

const fixedDt = 1 / 120;
const maxSubSteps = 5;

// ------------------------------------------------------------
// SCENE / CAMERA
// ------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87a9cf);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 350);
camera.position.set(0, 1.62, 1.18);
camera.lookAt(0, 1.35, -2.0);
scene.add(camera);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xecf4ff, 0x2f4559, 0.95));
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(14, 18, 10);
scene.add(sun);

// ------------------------------------------------------------
// SIMPLE STADIUM ENVIRONMENT
// ------------------------------------------------------------
const field = new THREE.Mesh(
  new THREE.PlaneGeometry(180, 180),
  new THREE.MeshStandardMaterial({ color: 0x2c8e45, roughness: 0.96 })
);
field.rotation.x = -Math.PI / 2;
scene.add(field);

const dirt = new THREE.Mesh(
  new THREE.CircleGeometry(5, 48),
  new THREE.MeshStandardMaterial({ color: 0x8a6d42, roughness: 0.9 })
);
dirt.rotation.x = -Math.PI / 2;
dirt.position.y = 0.01;
scene.add(dirt);

const plate = new THREE.Mesh(
  new THREE.BoxGeometry(0.62, 0.04, 0.62),
  new THREE.MeshStandardMaterial({ color: 0xffffff })
);
plate.position.set(0, 0.02, 0);
scene.add(plate);

const backstop = new THREE.Mesh(
  new THREE.BoxGeometry(12, 6, 0.3),
  new THREE.MeshStandardMaterial({ color: 0x33404e, roughness: 0.8 })
);
backstop.position.set(0, 3, 2.9);
scene.add(backstop);

const outfieldWall = new THREE.Mesh(
  new THREE.CylinderGeometry(45, 45, 3.2, 80, 1, true, Math.PI * 0.08, Math.PI * 0.84),
  new THREE.MeshStandardMaterial({ color: 0x244561, roughness: 0.82, side: THREE.DoubleSide })
);
outfieldWall.position.set(0, 1.6, -43);
scene.add(outfieldWall);

const seatMaterial = new THREE.MeshStandardMaterial({ color: 0x5d6e86, roughness: 0.85 });
for (let row = 0; row < 6; row++) {
  const radius = 9 + row * 2.5;
  const y = 1.1 + row * 0.8;
  const steps = 26 + row * 2;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const a = THREE.MathUtils.lerp(Math.PI * 0.12, Math.PI * 0.88, t);
    const x = Math.cos(a) * radius;
    const z = Math.sin(a) * radius + 2.5;
    const block = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 1.2), seatMaterial);
    block.position.set(x, y, z);
    block.lookAt(0, y, 2.0);
    scene.add(block);
  }
}

// ------------------------------------------------------------
// STRIKE ZONE + PCI (LARGE/CLOSE)
// ------------------------------------------------------------
const strikeZone = {
  center: new THREE.Vector3(0, 1.35, camera.position.z - config.strikeZoneDistance),
  width: config.strikeZoneWidth,
  height: config.strikeZoneHeight,
  depth: config.strikeZoneDepth
};

const zoneFill = new THREE.Mesh(
  new THREE.BoxGeometry(strikeZone.width, strikeZone.height, strikeZone.depth),
  new THREE.MeshBasicMaterial({ color: 0x66bbff, transparent: true, opacity: 0.16 })
);
zoneFill.position.copy(strikeZone.center);
scene.add(zoneFill);

const zoneEdges = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(strikeZone.width, strikeZone.height, strikeZone.depth)),
  new THREE.LineBasicMaterial({ color: 0xd3ecff })
);
zoneEdges.position.copy(strikeZone.center);
scene.add(zoneEdges);

const pciGroup = new THREE.Group();
const pciRing = new THREE.Mesh(
  new THREE.RingGeometry(config.pciRadius * 0.82, config.pciRadius, 36),
  new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.96 })
);
const pciDot = new THREE.Mesh(
  new THREE.CircleGeometry(0.025, 20),
  new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
);
pciGroup.add(pciRing, pciDot);
scene.add(pciGroup);

let pciOffsetX = 0;
let pciOffsetY = 0;

function updatePciTransform() {
  pciGroup.position.set(
    strikeZone.center.x + pciOffsetX,
    strikeZone.center.y + pciOffsetY,
    strikeZone.center.z + strikeZone.depth * 0.55
  );
  pciGroup.lookAt(camera.position);
}
updatePciTransform();

// ------------------------------------------------------------
// FIRST-PERSON BAT (VISIBLE + SWING ANIMATION)
// ------------------------------------------------------------
const batPivot = new THREE.Group();
const batIdlePos = new THREE.Vector3(0.44, -0.28, -0.58);
const batIdleRot = new THREE.Euler(-0.45, -0.9, 0.8);
const batSwingRot = new THREE.Euler(0.1, 1.0, -0.65);

camera.add(batPivot);
batPivot.position.copy(batIdlePos);
batPivot.rotation.copy(batIdleRot);

const batMesh = new THREE.Mesh(
  new THREE.CylinderGeometry(0.04, 0.06, 1.35, 18),
  new THREE.MeshStandardMaterial({ color: 0xc99660, roughness: 0.45, metalness: 0.02 })
);
batMesh.rotation.z = Math.PI / 2;
batMesh.position.set(0.52, -0.05, -0.1);
batPivot.add(batMesh);

let isSwinging = false;
let swingStartMs = 0;
let swingForwardDone = false;
let nextSwingAllowedMs = 0;
let swingUsedThisPitch = false;

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function updateBatSwing(nowMs) {
  if (!isSwinging) return;

  const elapsed = nowMs - swingStartMs;
  const half = config.swingDurationMs * 0.55;

  if (elapsed <= half) {
    const t = easeOutCubic(elapsed / half);
    batPivot.rotation.x = THREE.MathUtils.lerp(batIdleRot.x, batSwingRot.x, t);
    batPivot.rotation.y = THREE.MathUtils.lerp(batIdleRot.y, batSwingRot.y, t);
    batPivot.rotation.z = THREE.MathUtils.lerp(batIdleRot.z, batSwingRot.z, t);
  } else if (elapsed <= config.swingDurationMs) {
    if (!swingForwardDone) {
      swingForwardDone = true;
      evaluateSwing();
    }
    const t = (elapsed - half) / (config.swingDurationMs - half);
    batPivot.rotation.x = THREE.MathUtils.lerp(batSwingRot.x, batIdleRot.x, t);
    batPivot.rotation.y = THREE.MathUtils.lerp(batSwingRot.y, batIdleRot.y, t);
    batPivot.rotation.z = THREE.MathUtils.lerp(batSwingRot.z, batIdleRot.z, t);
  } else {
    batPivot.rotation.copy(batIdleRot);
    isSwinging = false;
  }
}

// ------------------------------------------------------------
// PHYSICS WORLD
// ------------------------------------------------------------
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.solver.iterations = 14;
world.solver.tolerance = 1e-4;

const ballMaterial = new CANNON.Material('ball');
const groundMaterial = new CANNON.Material('ground');
world.addContactMaterial(
  new CANNON.ContactMaterial(ballMaterial, groundMaterial, {
    restitution: config.restitution,
    friction: config.friction
  })
);

const groundBody = new CANNON.Body({ mass: 0, material: groundMaterial });
groundBody.addShape(new CANNON.Plane());
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(groundBody);

const ballRadius = 0.12;
const ballBody = new CANNON.Body({
  mass: 0.145,
  shape: new CANNON.Sphere(ballRadius),
  material: ballMaterial,
  linearDamping: 0.01,
  angularDamping: 0.01
});
world.addBody(ballBody);

const ballMesh = new THREE.Mesh(
  new THREE.SphereGeometry(ballRadius, 24, 24),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 })
);
scene.add(ballMesh);

// ------------------------------------------------------------
// AUDIO (procedural, no external assets needed)
// ------------------------------------------------------------
let audioCtx = null;
let audioReady = false;

function ensureAudioContext() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  audioReady = true;
  return audioCtx;
}

function playPitchSound() {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  const noise = ctx.createBufferSource();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.08, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.45;

  noise.buffer = buffer;
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(220, now);
  osc.frequency.exponentialRampToValueAtTime(90, now + 0.08);

  filter.type = 'bandpass';
  filter.frequency.value = 900;
  filter.Q.value = 0.7;

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.11, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);

  osc.connect(filter);
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.1);
  noise.start(now);
  noise.stop(now + 0.09);
}

function playHitSound(strong = false) {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  const noise = ctx.createBufferSource();
  const gain = ctx.createGain();
  const hp = ctx.createBiquadFilter();

  const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.07, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.8;
  noise.buffer = buffer;

  osc.type = 'square';
  osc.frequency.value = strong ? 520 : 380;

  hp.type = 'highpass';
  hp.frequency.value = 700;

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(strong ? 0.28 : 0.18, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);

  osc.connect(hp);
  noise.connect(hp);
  hp.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.11);
  noise.start(now);
  noise.stop(now + 0.07);
}

// ------------------------------------------------------------
// HUD
// ------------------------------------------------------------
const statusEl = document.getElementById('status');
const detailsEl = document.getElementById('details');
let hudTimer = null;

function showResult(text, mph = null) {
  statusEl.textContent = text;
  detailsEl.textContent = mph == null ? '' : `Exit velocity: ${mph.toFixed(1)} mph`;

  if (hudTimer) clearTimeout(hudTimer);
  hudTimer = setTimeout(() => {
    statusEl.textContent = 'TRACK THE BALL';
    detailsEl.textContent = '';
  }, 850);
}

// ------------------------------------------------------------
// PITCHING SYSTEM
// ------------------------------------------------------------
const spawnPos = new CANNON.Vec3(0, 1.5, -17.5);
let pitchTimer = null;
let ballWasHit = false;

function randomPitchVelocity() {
  // Choose pitch profile: fastball / slight curve / slight drop
  const r = Math.random();
  const pitchType = r < 0.45 ? 'FASTBALL' : r < 0.75 ? 'CURVE' : 'DROP';

  const tx = (Math.random() - 0.5) * strikeZone.width * 0.82;
  const ty = strikeZone.center.y + (Math.random() - 0.5) * strikeZone.height * 0.82;
  const tz = strikeZone.center.z;

  const toTarget = new THREE.Vector3(tx - spawnPos.x, ty - spawnPos.y, tz - spawnPos.z).normalize();
  let speed = THREE.MathUtils.lerp(config.pitchSpeedMin, config.pitchSpeedMax, Math.random());

  let breakX = (Math.random() - 0.5) * config.breakX;
  let breakY = (Math.random() - 0.5) * config.breakY;

  if (pitchType === 'FASTBALL') {
    speed += 1.5;
    breakX *= 0.35;
    breakY *= 0.4;
  } else if (pitchType === 'CURVE') {
    breakX *= 1.2;
    breakY *= 0.55;
  } else {
    breakX *= 0.5;
    breakY -= Math.abs(breakY) * 0.8;
  }

  return new CANNON.Vec3(toTarget.x * speed + breakX, toTarget.y * speed + breakY, toTarget.z * speed);
}

function resetAndPitch(delay = config.pitchIntervalMs) {
  if (pitchTimer) clearTimeout(pitchTimer);

  ballBody.position.copy(spawnPos);
  ballBody.velocity.setZero();
  ballBody.angularVelocity.setZero();
  ballBody.quaternion.set(0, 0, 0, 1);

  swingUsedThisPitch = false;
  ballWasHit = false;

  pitchTimer = setTimeout(() => {
    ballBody.velocity.copy(randomPitchVelocity());
    playPitchSound();
  }, delay);
}

resetAndPitch(550);

// ------------------------------------------------------------
// INPUT: PCI movement + Z swing
// ------------------------------------------------------------
window.addEventListener('mousemove', (e) => {
  pciOffsetX += e.movementX * config.pciSensitivity;
  pciOffsetY -= e.movementY * config.pciSensitivity;

  const halfW = strikeZone.width * 0.5;
  const halfH = strikeZone.height * 0.5;
  pciOffsetX = THREE.MathUtils.clamp(pciOffsetX, -halfW, halfW);
  pciOffsetY = THREE.MathUtils.clamp(pciOffsetY, -halfH, halfH);
  updatePciTransform();
});

window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();

  if (key === 'r') {
    pciOffsetX = 0;
    pciOffsetY = 0;
    updatePciTransform();
    resetAndPitch(120);
    return;
  }

  if (key !== 'z') return;

  const now = performance.now();
  ensureAudioContext(); // user gesture unlock

  if (now < nextSwingAllowedMs || isSwinging || swingUsedThisPitch) return;

  isSwinging = true;
  swingStartMs = now;
  swingForwardDone = false;
  swingUsedThisPitch = true;
  nextSwingAllowedMs = now + config.swingCooldownMs;
});

// ------------------------------------------------------------
// HIT DETECTION (PCI + TIMING + BAT SWING WINDOW)
// ------------------------------------------------------------
function pciBallDistance() {
  const dx = ballBody.position.x - (strikeZone.center.x + pciOffsetX);
  const dy = ballBody.position.y - (strikeZone.center.y + pciOffsetY);
  return Math.hypot(dx, dy);
}

function classifyContact(pciDist, timingDist) {
  if (pciDist <= config.perfectPciDist && timingDist <= config.perfectTiming) return 'PERFECT';
  if (pciDist <= config.goodPciDist && timingDist <= config.goodTiming) return 'GOOD';
  return 'WEAK';
}

function evaluateSwing() {
  const zDist = Math.abs(ballBody.position.z - strikeZone.center.z);
  const inSwingWindow = zDist <= config.swingWindowZ;

  if (!inSwingWindow || ballBody.position.z > strikeZone.center.z + 0.28) {
    showResult('MISS');
    return;
  }

  const pciDist = pciBallDistance();
  const timingDist = Math.abs(ballBody.position.z - strikeZone.center.z);

  // Require at least moderate PCI alignment for contact.
  if (pciDist > config.goodPciDist * 1.35) {
    showResult('MISS');
    return;
  }

  const quality = classifyContact(pciDist, timingDist);

  const xInfluence = THREE.MathUtils.clamp(pciOffsetX / (strikeZone.width * 0.5), -1, 1);
  const yInfluence = THREE.MathUtils.clamp(pciOffsetY / (strikeZone.height * 0.5), -1, 1);
  const timingScale = 1 - THREE.MathUtils.clamp(timingDist / config.hitPlaneTolerance, 0, 1);

  let impulseMag = config.weakImpulse;
  if (quality === 'GOOD') impulseMag = config.goodImpulse;
  if (quality === 'PERFECT') impulseMag = config.perfectImpulse;

  const hitDir = new CANNON.Vec3(
    xInfluence * 0.85,
    0.78 + yInfluence * 0.62 + timingScale * 0.18,
    1.04 - Math.abs(xInfluence) * 0.16
  );
  hitDir.normalize();
  hitDir.scale(impulseMag * (0.77 + timingScale * 0.35), hitDir);

  const preSpeed = ballBody.velocity.length();
  if (preSpeed > 42) ballBody.velocity.scale(42 / preSpeed, ballBody.velocity);

  ballBody.applyImpulse(hitDir, ballBody.position);
  ballWasHit = true;

  const exitMph = ballBody.velocity.length() * 2.23694;
  showResult(quality, exitMph);
  playHitSound(quality !== 'WEAK');
}

function maybeAutoMiss() {
  if (!swingUsedThisPitch && !ballWasHit && ballBody.position.z > strikeZone.center.z + 0.26) {
    swingUsedThisPitch = true;
    showResult('MISS');
  }
}

// ------------------------------------------------------------
// LOOP HELPERS
// ------------------------------------------------------------
function shouldResetBall() {
  return (
    ballBody.position.z > 16 ||
    Math.abs(ballBody.position.x) > 22 ||
    Math.abs(ballBody.position.z) > 45 ||
    ballBody.position.y < -4
  );
}

function updatePciColor() {
  const d = pciBallDistance();
  let color = 0xffffff;
  if (d <= config.goodPciDist) color = 0xffe066;
  if (d <= config.perfectPciDist) color = 0x60ff75;
  pciRing.material.color.setHex(color);
  pciDot.material.color.setHex(color);
}

// ------------------------------------------------------------
// FIXED-STEP MAIN LOOP
// ------------------------------------------------------------
const clock = new THREE.Clock();
let accumulator = 0;

function animate() {
  requestAnimationFrame(animate);

  const deltaTime = Math.min(clock.getDelta(), 0.05);
  accumulator += deltaTime;

  while (accumulator >= fixedDt) {
    world.step(fixedDt, deltaTime, maxSubSteps);
    accumulator -= fixedDt;
  }

  const now = performance.now();
  updateBatSwing(now);

  maybeAutoMiss();
  if (shouldResetBall()) resetAndPitch(config.pitchIntervalMs);

  ballMesh.position.copy(ballBody.position);
  ballMesh.quaternion.copy(ballBody.quaternion);

  updatePciColor();
  renderer.render(scene, camera);
}

animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});
