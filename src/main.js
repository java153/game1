import './style.css';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// ------------------------
// Tunable parameters
// ------------------------
const config = {
  pitchSpeed: 22,
  pitchInterval: 1000,
  batMotorStrength: 28,
  batDamping: 0.95,
  maxBatAngle: Math.PI * 0.75,
  mouseSensitivity: 0.005,
  restitution: 0.55,
  friction: 0.35
};

const fixedDt = 1 / 120;
const maxSubSteps = 5;

// ------------------------
// Three.js setup
// ------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7fa4cc);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(5, 2.4, 8.5);
camera.lookAt(0, 1, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const hemiLight = new THREE.HemisphereLight(0xddeeff, 0x334455, 0.95);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(6, 9, 4);
scene.add(dirLight);

const groundMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: 0x2d7c38, roughness: 0.95 })
);
groundMesh.rotation.x = -Math.PI / 2;
scene.add(groundMesh);

const plateMesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.6, 0.04, 0.6),
  new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.6 })
);
plateMesh.position.set(0, 0.02, 0);
scene.add(plateMesh);

// ------------------------
// Physics setup
// ------------------------
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
world.solver.iterations = 14;
world.solver.tolerance = 1e-4;

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
    restitution: config.restitution + 0.1,
    friction: config.friction * 0.7
  })
);

const groundBody = new CANNON.Body({ mass: 0, material: groundMaterial });
groundBody.addShape(new CANNON.Plane());
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(groundBody);

// ------------------------
// Bat: dynamic + hinge motor
// ------------------------
const pivotHeight = 1.0;
const batLength = 1.25;
const batRadius = 0.065;

const batPivotBody = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC });
batPivotBody.position.set(-0.25, pivotHeight, 0.3);
world.addBody(batPivotBody);

const batBody = new CANNON.Body({
  mass: 1.1,
  material: batMaterial,
  linearDamping: 0.2,
  angularDamping: 0.2
});
const batShape = new CANNON.Cylinder(batRadius, batRadius * 0.65, batLength, 12);
const qAlign = new CANNON.Quaternion();
qAlign.setFromEuler(0, 0, Math.PI / 2);
batBody.addShape(batShape, new CANNON.Vec3(0, 0, 0), qAlign);
batBody.position.set(-0.25 + batLength * 0.5, pivotHeight, 0.3);
batBody.angularVelocity.set(0, 0, 0);
batBody.sleepSpeedLimit = 0.05;
batBody.allowSleep = false;
world.addBody(batBody);

// Hinge around Y axis from the knob/handle.
const hinge = new CANNON.HingeConstraint(batPivotBody, batBody, {
  pivotA: new CANNON.Vec3(0, 0, 0),
  axisA: new CANNON.Vec3(0, 1, 0),
  pivotB: new CANNON.Vec3(-batLength * 0.5, 0, 0),
  axisB: new CANNON.Vec3(0, 1, 0),
  collideConnected: false
});
world.addConstraint(hinge);
hinge.enableMotor();
hinge.setMotorMaxForce(90);

const batMesh = new THREE.Mesh(
  new THREE.CylinderGeometry(batRadius * 0.7, batRadius, batLength, 16),
  new THREE.MeshStandardMaterial({ color: 0xc3905c, roughness: 0.45, metalness: 0.05 })
);
batMesh.rotation.z = Math.PI / 2;
scene.add(batMesh);

// ------------------------
// Ball
// ------------------------
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
let pitchTimeout = null;
let lastHitSpeed = 0;
let bestDistance = 0;
let wasContactingBat = false;

const statsEl = document.getElementById('stats');

function updateHud() {
  statsEl.textContent = `Last hit: ${lastHitSpeed.toFixed(1)} m/s | Distance: ${bestDistance.toFixed(1)} m`;
}

function resetBallAndPitch(delay = config.pitchInterval) {
  if (pitchTimeout) clearTimeout(pitchTimeout);
  ballBody.position.copy(moundPos);
  ballBody.velocity.setZero();
  ballBody.angularVelocity.setZero();
  ballBody.quaternion.set(0, 0, 0, 1);

  pitchTimeout = setTimeout(() => {
    // Slight randomness keeps pitches varied.
    const lateral = (Math.random() - 0.5) * 1.0;
    const vertical = (Math.random() - 0.5) * 0.4;
    ballBody.velocity.set(lateral, vertical, config.pitchSpeed);
    bestDistance = 0;
  }, delay);
}

resetBallAndPitch(450);

// ------------------------
// Input: click+drag bat control
// ------------------------
const raycaster = new THREE.Raycaster();
const mouseNdc = new THREE.Vector2();
let isDragging = false;
let lastMouseX = 0;
let targetBatAngle = 0;

function setMouseNdc(clientX, clientY) {
  mouseNdc.x = (clientX / window.innerWidth) * 2 - 1;
  mouseNdc.y = -(clientY / window.innerHeight) * 2 + 1;
}

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  setMouseNdc(e.clientX, e.clientY);
  raycaster.setFromCamera(mouseNdc, camera);
  const hit = raycaster.intersectObject(batMesh, false);
  if (hit.length > 0) {
    isDragging = true;
    lastMouseX = e.clientX;
    batMesh.material.color.set(0xff8a65);
  }
});

window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const dx = e.clientX - lastMouseX;
  lastMouseX = e.clientX;

  targetBatAngle += dx * config.mouseSensitivity;
  targetBatAngle = THREE.MathUtils.clamp(targetBatAngle, -0.25, config.maxBatAngle);
});

window.addEventListener('mouseup', () => {
  if (!isDragging) return;
  isDragging = false;
  batMesh.material.color.set(0xc3905c);
});

window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'r') {
    targetBatAngle = 0;
    batBody.angularVelocity.setZero();
    resetBallAndPitch(150);
  }
});

// ------------------------
// Animation / simulation
// ------------------------
const clock = new THREE.Clock();
let accumulator = 0;

function getBatAngleAroundY() {
  // Signed yaw from bat vector in XZ plane.
  const forward = new CANNON.Vec3(1, 0, 0);
  batBody.quaternion.vmult(forward, forward);
  return Math.atan2(forward.z, forward.x);
}

function driveBatMotor() {
  const angle = getBatAngleAroundY();

  // Return-to-rest spring when released.
  if (!isDragging) {
    targetBatAngle *= config.batDamping;
    if (Math.abs(targetBatAngle) < 0.002) targetBatAngle = 0;
  }

  const error = THREE.MathUtils.clamp(targetBatAngle - angle, -1.2, 1.2);
  const desiredSpeed = THREE.MathUtils.clamp(error * config.batMotorStrength, -30, 30);

  hinge.enableMotor();
  hinge.setMotorSpeed(desiredSpeed);
  hinge.setMotorMaxForce(90);

  // Safety cap against unstable spinning.
  batBody.angularVelocity.x = THREE.MathUtils.clamp(batBody.angularVelocity.x, -25, 25);
  batBody.angularVelocity.y = THREE.MathUtils.clamp(batBody.angularVelocity.y, -35, 35);
  batBody.angularVelocity.z = THREE.MathUtils.clamp(batBody.angularVelocity.z, -25, 25);
}

function checkHitAndStats() {
  const contacts = world.contacts;
  let contactingBat = false;
  for (let i = 0; i < contacts.length; i++) {
    const c = contacts[i];
    const batBall =
      (c.bi === batBody && c.bj === ballBody) ||
      (c.bi === ballBody && c.bj === batBody);
    if (batBall) {
      contactingBat = true;
      break;
    }
  }

  // Detect first frame of impact.
  if (contactingBat && !wasContactingBat) {
    lastHitSpeed = ballBody.velocity.length();
  }
  wasContactingBat = contactingBat;

  // Approximate hit travel distance from plate in XZ.
  const dx = ballBody.position.x - plateMesh.position.x;
  const dz = ballBody.position.z - plateMesh.position.z;
  bestDistance = Math.max(bestDistance, Math.sqrt(dx * dx + dz * dz));

  updateHud();
}

function shouldResetBall() {
  return (
    ballBody.position.z > 14 ||
    Math.abs(ballBody.position.x) > 22 ||
    Math.abs(ballBody.position.z) > 30 ||
    ballBody.position.y < -5
  );
}

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.05);
  accumulator += dt;

  while (accumulator >= fixedDt) {
    driveBatMotor();
    world.step(fixedDt, dt, maxSubSteps);
    accumulator -= fixedDt;
  }

  if (shouldResetBall()) {
    resetBallAndPitch(config.pitchInterval);
  }

  checkHitAndStats();

  batMesh.position.copy(batBody.position);
  batMesh.quaternion.copy(batBody.quaternion);

  ballMesh.position.copy(ballBody.position);
  ballMesh.quaternion.copy(ballBody.quaternion);

  renderer.render(scene, camera);
}

animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});
