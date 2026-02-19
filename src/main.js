import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// ------------------------------------------------------------
// Gameplay tuning variables
// ------------------------------------------------------------
// pitchSpeedMin/Max: base speed range for randomized pitches.
// pitchBreakX/BreakY: horizontal/vertical velocity variation for pitch movement.
// pciSensitivity: mouse-to-PCI movement scale.
// hitPlaneTolerance: timing window around strike zone plane for contact.
// perfect/good PCI and timing thresholds: decide hit quality tier.
// impulse ranges: output power for weak/good/perfect contact.
const config = {
  pitchIntervalMs: 1200,
  pitchSpeedMin: 28,
  pitchSpeedMax: 35,
  pitchBreakX: 1.8,
  pitchBreakY: 1.2,
  pciSensitivity: 0.0018,
  hitPlaneTolerance: 0.45,
  perfectPciDist: 0.18,
  goodPciDist: 0.34,
  perfectTiming: 0.12,
  goodTiming: 0.24,
  weakImpulse: 2.8,
  goodImpulse: 4.6,
  perfectImpulse: 6.4,
  restitution: 0.5,
  friction: 0.32
};

const fixedDt = 1 / 120;
const maxSubSteps = 5;

// ------------------------------------------------------------
// Scene / camera (first-person batter view)
// ------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7ca3cd);

const camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.1, 250);
camera.position.set(0, 1.62, 1.25);
camera.lookAt(0, 1.25, -2.0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xe6f2ff, 0x30465b, 0.9));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(6, 10, 4);
scene.add(dirLight);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100),
  new THREE.MeshStandardMaterial({ color: 0x2f8e44, roughness: 0.97 })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const plateMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.6, 0.04, 0.6),
  new THREE.MeshStandardMaterial({ color: 0xffffff })
);
plateMesh.position.set(0, 0.02, 0);
scene.add(plateMesh);

// ------------------------------------------------------------
// Strike zone + PCI visuals
// ------------------------------------------------------------
const strikeZone = {
  center: new THREE.Vector3(0, 1.25, -2.0),
  width: 0.82,
  height: 1.0,
  depth: 0.05
};

const zoneBox = new THREE.Mesh(
  new THREE.BoxGeometry(strikeZone.width, strikeZone.height, strikeZone.depth),
  new THREE.MeshBasicMaterial({ color: 0x66bbff, transparent: true, opacity: 0.16 })
);
zoneBox.position.copy(strikeZone.center);
scene.add(zoneBox);

const zoneEdges = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(strikeZone.width, strikeZone.height, strikeZone.depth)),
  new THREE.LineBasicMaterial({ color: 0xb7e1ff })
);
zoneEdges.position.copy(strikeZone.center);
scene.add(zoneEdges);

const pciGroup = new THREE.Group();
const pciRing = new THREE.Mesh(
  new THREE.RingGeometry(0.12, 0.14, 32),
  new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.95 })
);
const pciDot = new THREE.Mesh(
  new THREE.CircleGeometry(0.02, 20),
  new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
);
pciGroup.add(pciRing, pciDot);
pciGroup.position.copy(strikeZone.center);
scene.add(pciGroup);

let pciOffsetX = 0;
let pciOffsetY = 0;

function updatePciTransform() {
  pciGroup.position.set(
    strikeZone.center.x + pciOffsetX,
    strikeZone.center.y + pciOffsetY,
    strikeZone.center.z + 0.03
  );
  // Face camera
  pciGroup.lookAt(camera.position);
}

updatePciTransform();

// ------------------------------------------------------------
// Physics world
// ------------------------------------------------------------
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.solver.iterations = 14;
world.solver.tolerance = 1e-4;

const ballMat = new CANNON.Material('ball');
const groundMat = new CANNON.Material('ground');
world.addContactMaterial(
  new CANNON.ContactMaterial(ballMat, groundMat, {
    restitution: config.restitution,
    friction: config.friction
  })
);

const groundBody = new CANNON.Body({ mass: 0, material: groundMat });
groundBody.addShape(new CANNON.Plane());
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(groundBody);

const ballRadius = 0.12;
const ballBody = new CANNON.Body({
  mass: 0.145,
  shape: new CANNON.Sphere(ballRadius),
  material: ballMat,
  linearDamping: 0.01,
  angularDamping: 0.01
});
world.addBody(ballBody);

const ballMesh = new THREE.Mesh(
  new THREE.SphereGeometry(ballRadius, 24, 24),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.36 })
);
scene.add(ballMesh);

const spawnPos = new CANNON.Vec3(0, 1.45, -18);
let pitchTimer = null;
let swingUsed = false;
let ballWasHit = false;

const statusEl = document.getElementById('status');
const detailsEl = document.getElementById('details');
let hudTimeout = null;

function showResult(label, mph = null) {
  statusEl.textContent = label;
  detailsEl.textContent = mph == null ? '' : `Exit velocity: ${mph.toFixed(1)} mph`;
  if (hudTimeout) clearTimeout(hudTimeout);
  hudTimeout = setTimeout(() => {
    statusEl.textContent = 'TRACK THE BALL';
    detailsEl.textContent = '';
  }, 850);
}

function randomPitchVelocity() {
  const targetX = (Math.random() - 0.5) * (strikeZone.width * 0.8);
  const targetY = strikeZone.center.y + (Math.random() - 0.5) * (strikeZone.height * 0.8);
  const targetZ = strikeZone.center.z;

  const dir = new THREE.Vector3(targetX - spawnPos.x, targetY - spawnPos.y, targetZ - spawnPos.z).normalize();
  const speed = THREE.MathUtils.lerp(config.pitchSpeedMin, config.pitchSpeedMax, Math.random());

  const vx = dir.x * speed + (Math.random() - 0.5) * config.pitchBreakX;
  const vy = dir.y * speed + (Math.random() - 0.5) * config.pitchBreakY;
  const vz = dir.z * speed;

  return new CANNON.Vec3(vx, vy, vz);
}

function resetAndPitch(delay = config.pitchIntervalMs) {
  if (pitchTimer) clearTimeout(pitchTimer);

  ballBody.position.copy(spawnPos);
  ballBody.velocity.setZero();
  ballBody.angularVelocity.setZero();
  ballBody.quaternion.set(0, 0, 0, 1);

  swingUsed = false;
  ballWasHit = false;

  pitchTimer = setTimeout(() => {
    ballBody.velocity.copy(randomPitchVelocity());
  }, delay);
}

resetAndPitch(500);

// ------------------------------------------------------------
// Input system
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

function pciBallDistance() {
  const dx = ballBody.position.x - (strikeZone.center.x + pciOffsetX);
  const dy = ballBody.position.y - (strikeZone.center.y + pciOffsetY);
  return Math.sqrt(dx * dx + dy * dy);
}

function classifyHit(pciDist, timingDist) {
  if (timingDist > config.hitPlaneTolerance || ballBody.position.z > strikeZone.center.z + 0.35) {
    return 'MISS';
  }

  if (pciDist <= config.perfectPciDist && timingDist <= config.perfectTiming) return 'PERFECT';
  if (pciDist <= config.goodPciDist && timingDist <= config.goodTiming) return 'GOOD';
  return 'WEAK';
}

function applyHitImpulse(quality, pciDist, timingDist) {
  let impulseMag = 0;
  if (quality === 'PERFECT') impulseMag = config.perfectImpulse;
  else if (quality === 'GOOD') impulseMag = config.goodImpulse;
  else if (quality === 'WEAK') impulseMag = config.weakImpulse;
  else return;

  const xInfluence = THREE.MathUtils.clamp(pciOffsetX / (strikeZone.width * 0.5), -1, 1);
  const yInfluence = THREE.MathUtils.clamp(pciOffsetY / (strikeZone.height * 0.5), -1, 1);
  const timingScale = 1 - THREE.MathUtils.clamp(timingDist / config.hitPlaneTolerance, 0, 1);

  const forward = new CANNON.Vec3(
    xInfluence * 0.85,
    0.75 + yInfluence * 0.65 + timingScale * 0.2,
    1.05 - Math.abs(xInfluence) * 0.2
  );
  forward.normalize();
  forward.scale(impulseMag * (0.75 + timingScale * 0.35), forward);

  // Clamp pre-hit speed to avoid extreme launches.
  const speed = ballBody.velocity.length();
  if (speed > 42) ballBody.velocity.scale(42 / speed, ballBody.velocity);

  ballBody.applyImpulse(forward, ballBody.position);
  ballWasHit = true;

  const exitMps = ballBody.velocity.length();
  const exitMph = exitMps * 2.23694;
  showResult(`${quality} HIT`, exitMph);
}

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || swingUsed) return;
  swingUsed = true;

  const pciDist = pciBallDistance();
  const timingDist = Math.abs(ballBody.position.z - strikeZone.center.z);
  const quality = classifyHit(pciDist, timingDist);

  if (quality === 'MISS') {
    showResult('MISS');
    return;
  }

  applyHitImpulse(quality, pciDist, timingDist);
});

// ------------------------------------------------------------
// Game loop helpers
// ------------------------------------------------------------
function updatePciColor() {
  const d = pciBallDistance();
  let color = 0xffffff;
  if (d <= config.goodPciDist) color = 0xffe066;
  if (d <= config.perfectPciDist) color = 0x61ff76;
  pciRing.material.color.setHex(color);
  pciDot.material.color.setHex(color);
}

function shouldResetBall() {
  return (
    ballBody.position.z > 16 ||
    Math.abs(ballBody.position.x) > 18 ||
    Math.abs(ballBody.position.z) > 40 ||
    ballBody.position.y < -4
  );
}

function maybeAutoMiss() {
  if (!swingUsed && ballBody.position.z > strikeZone.center.z + 0.25 && !ballWasHit) {
    swingUsed = true;
    showResult('MISS');
  }
}

// ------------------------------------------------------------
// Fixed timestep main loop
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

  maybeAutoMiss();
  if (shouldResetBall()) resetAndPitch(config.pitchIntervalMs);

  ballMesh.position.copy(ballBody.position);
  ballMesh.quaternion.copy(ballBody.quaternion);

  updatePciColor();
  renderer.render(scene, camera);
}

animate();

window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'r') {
    pciOffsetX = 0;
    pciOffsetY = 0;
    updatePciTransform();
    resetAndPitch(120);
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});
