import './style.css';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// ------------------------------------------------------------
// Tuning parameters (requested by spec)
// ------------------------------------------------------------
const config = {
  pitchSpeed: 22,
  pitchInterval: 1000,
  batMotorStrength: 30,
  batDamping: 0.92,
  maxBatAngle: Math.PI * 0.75,
  maxBatTilt: 0.35,
  mouseSensitivity: 0.005,
  tiltSensitivity: 0.004,
  restitution: 0.55,
  friction: 0.32
};

const fixedDt = 1 / 120;
const maxSubSteps = 5;

// ------------------------------------------------------------
// Three.js scene setup
// ------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8db1d5);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 250);
camera.position.set(4.8, 2.6, 8.4);
camera.lookAt(0, 1, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xe0f0ff, 0x314759, 0.95));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.05);
dirLight.position.set(8, 10, 4);
scene.add(dirLight);

const groundMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: 0x2f8b45, roughness: 0.96 })
);
groundMesh.rotation.x = -Math.PI / 2;
scene.add(groundMesh);

const homePlateMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.6, 0.04, 0.6),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72 })
);
homePlateMesh.position.set(0, 0.02, 0);
scene.add(homePlateMesh);

// ------------------------------------------------------------
// Cannon world setup
// ------------------------------------------------------------
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.solver.iterations = 14;
world.solver.tolerance = 1e-4;
world.allowSleep = true;

const ballMaterial = new CANNON.Material('ball');
const batMaterial = new CANNON.Material('bat');
const groundMaterial = new CANNON.Material('ground');

world.addContactMaterial(
  new CANNON.ContactMaterial(ballMaterial, groundMaterial, {
    restitution: config.restitution,
    friction: config.friction
  })
);
world.addContactMaterial(
  new CANNON.ContactMaterial(ballMaterial, batMaterial, {
    restitution: config.restitution + 0.12,
    friction: config.friction * 0.7
  })
);

const groundBody = new CANNON.Body({ mass: 0, material: groundMaterial });
groundBody.addShape(new CANNON.Plane());
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(groundBody);

// ------------------------------------------------------------
// Bat: dynamic body constrained by hinge motor
// ------------------------------------------------------------
const batLength = 1.25;
const batRadius = 0.065;
const batPivot = new CANNON.Vec3(-0.28, 1.02, 0.34);

const batPivotBody = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC });
batPivotBody.position.copy(batPivot);
world.addBody(batPivotBody);

const batBody = new CANNON.Body({
  mass: 1.1,
  material: batMaterial,
  linearDamping: 0.2,
  angularDamping: 0.2
});
const batShape = new CANNON.Cylinder(batRadius, batRadius * 0.65, batLength, 12);
const batShapeRot = new CANNON.Quaternion();
batShapeRot.setFromEuler(0, 0, Math.PI / 2);
batBody.addShape(batShape, new CANNON.Vec3(0, 0, 0), batShapeRot);
batBody.position.set(batPivot.x + batLength * 0.5, batPivot.y, batPivot.z);
batBody.allowSleep = false;
world.addBody(batBody);

const batHinge = new CANNON.HingeConstraint(batPivotBody, batBody, {
  pivotA: new CANNON.Vec3(0, 0, 0),
  axisA: new CANNON.Vec3(0, 1, 0),
  pivotB: new CANNON.Vec3(-batLength * 0.5, 0, 0),
  axisB: new CANNON.Vec3(0, 1, 0),
  collideConnected: false
});
world.addConstraint(batHinge);
batHinge.enableMotor();
batHinge.setMotorMaxForce(95);

const batMesh = new THREE.Mesh(
  new THREE.CylinderGeometry(batRadius * 0.7, batRadius, batLength, 18),
  new THREE.MeshStandardMaterial({ color: 0xc79564, roughness: 0.45, metalness: 0.02 })
);
batMesh.rotation.z = Math.PI / 2;
scene.add(batMesh);

// ------------------------------------------------------------
// Ball setup
// ------------------------------------------------------------
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

const moundPos = new CANNON.Vec3(0, 1.05, -12);
let pitchTimer = null;
let lastHitSpeed = 0;
let maxDistance = 0;
let touchingBatPrev = false;

const statsEl = document.getElementById('stats');

function updateHud() {
  statsEl.textContent = `Last hit: ${lastHitSpeed.toFixed(1)} m/s | Distance: ${maxDistance.toFixed(1)} m`;
}

function resetBallAndPitch(delayMs = config.pitchInterval) {
  if (pitchTimer) clearTimeout(pitchTimer);

  ballBody.position.copy(moundPos);
  ballBody.velocity.setZero();
  ballBody.angularVelocity.setZero();
  ballBody.quaternion.set(0, 0, 0, 1);
  maxDistance = 0;

  pitchTimer = setTimeout(() => {
    const randomX = (Math.random() - 0.5) * 0.9;
    const randomY = (Math.random() - 0.5) * 0.35;
    ballBody.velocity.set(randomX, randomY, config.pitchSpeed);
  }, delayMs);
}

resetBallAndPitch(500);

// ------------------------------------------------------------
// Mouse controls for bat swing
// ------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let grabbingBat = false;
let lastMouseX = 0;
let lastMouseY = 0;
let targetYaw = 0;
let targetTilt = 0;

function setMouseNDC(clientX, clientY) {
  mouse.x = (clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(clientY / window.innerHeight) * 2 + 1;
}

window.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;

  setMouseNDC(event.clientX, event.clientY);
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObject(batMesh, false);
  if (hits.length > 0) {
    grabbingBat = true;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
    batMesh.material.color.set(0xff8f6a);
  }
});

window.addEventListener('mousemove', (event) => {
  if (!grabbingBat) return;

  const dx = event.clientX - lastMouseX;
  const dy = event.clientY - lastMouseY;
  lastMouseX = event.clientX;
  lastMouseY = event.clientY;

  targetYaw += dx * config.mouseSensitivity;
  targetYaw = THREE.MathUtils.clamp(targetYaw, -0.28, config.maxBatAngle);

  targetTilt += -dy * config.tiltSensitivity;
  targetTilt = THREE.MathUtils.clamp(targetTilt, -config.maxBatTilt, config.maxBatTilt);
});

window.addEventListener('mouseup', () => {
  if (!grabbingBat) return;
  grabbingBat = false;
  batMesh.material.color.set(0xc79564);
});

window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() !== 'r') return;
  targetYaw = 0;
  targetTilt = 0;
  batBody.angularVelocity.setZero();
  batBody.velocity.setZero();
  resetBallAndPitch(200);
});

// ------------------------------------------------------------
// Simulation helpers
// ------------------------------------------------------------
function getBatYaw() {
  const axis = new CANNON.Vec3(1, 0, 0);
  batBody.quaternion.vmult(axis, axis);
  return Math.atan2(axis.z, axis.x);
}

function driveBat() {
  const currentYaw = getBatYaw();

  // On release, move target back to neutral with damping.
  if (!grabbingBat) {
    targetYaw *= config.batDamping;
    targetTilt *= config.batDamping;
    if (Math.abs(targetYaw) < 0.002) targetYaw = 0;
    if (Math.abs(targetTilt) < 0.002) targetTilt = 0;
  }

  const yawError = THREE.MathUtils.clamp(targetYaw - currentYaw, -1.2, 1.2);
  const motorSpeed = THREE.MathUtils.clamp(yawError * config.batMotorStrength, -30, 30);

  batHinge.enableMotor();
  batHinge.setMotorSpeed(motorSpeed);
  batHinge.setMotorMaxForce(95);

  // Optional extra tilt response around bat local Z (torque-based).
  const batUp = new CANNON.Vec3(0, 0, 1);
  batBody.quaternion.vmult(batUp, batUp);
  const tiltError = targetTilt - batUp.y * 0.5;
  const tiltTorque = THREE.MathUtils.clamp(tiltError * 18, -10, 10);
  batBody.torque.x += tiltTorque;

  // Safety caps to reduce instability/explosions.
  batBody.angularVelocity.x = THREE.MathUtils.clamp(batBody.angularVelocity.x, -24, 24);
  batBody.angularVelocity.y = THREE.MathUtils.clamp(batBody.angularVelocity.y, -35, 35);
  batBody.angularVelocity.z = THREE.MathUtils.clamp(batBody.angularVelocity.z, -24, 24);
}

function trackContactStats() {
  let touchingBatNow = false;
  for (let i = 0; i < world.contacts.length; i++) {
    const c = world.contacts[i];
    const batBallPair =
      (c.bi === batBody && c.bj === ballBody) ||
      (c.bi === ballBody && c.bj === batBody);
    if (batBallPair) {
      touchingBatNow = true;
      break;
    }
  }

  if (touchingBatNow && !touchingBatPrev) {
    lastHitSpeed = ballBody.velocity.length();
  }
  touchingBatPrev = touchingBatNow;

  const dx = ballBody.position.x - homePlateMesh.position.x;
  const dz = ballBody.position.z - homePlateMesh.position.z;
  maxDistance = Math.max(maxDistance, Math.sqrt(dx * dx + dz * dz));

  updateHud();
}

function ballNeedsReset() {
  return (
    ballBody.position.z > 14 ||
    Math.abs(ballBody.position.x) > 22 ||
    Math.abs(ballBody.position.z) > 32 ||
    ballBody.position.y < -5
  );
}

// ------------------------------------------------------------
// Main loop with accumulator + fixed step
// ------------------------------------------------------------
const clock = new THREE.Clock();
let accumulator = 0;

function frame() {
  requestAnimationFrame(frame);

  const dt = Math.min(clock.getDelta(), 0.05);
  accumulator += dt;

  while (accumulator >= fixedDt) {
    driveBat();
    world.step(fixedDt, dt, maxSubSteps);
    accumulator -= fixedDt;
  }

  if (ballNeedsReset()) resetBallAndPitch(config.pitchInterval);

  trackContactStats();

  batMesh.position.copy(batBody.position);
  batMesh.quaternion.copy(batBody.quaternion);
  ballMesh.position.copy(ballBody.position);
  ballMesh.quaternion.copy(ballBody.quaternion);

  renderer.render(scene, camera);
}

frame();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});
