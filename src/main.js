import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// ------------------------------------------------------------
// TUNING VARIABLES
// ------------------------------------------------------------
const baseConfig = {
  cameraFov: 90,

  strikeZoneDistance: 1.28,
  strikeZoneWidth: 1.32,
  strikeZoneHeight: 1.82,
  strikeZoneDepth: 0.18,

  pciRadius: 0.13,

  swingDurationMs: 300,
  swingCooldownMs: 620,
  contactWindowStart: 0.16,
  contactWindowEnd: 0.84,

  postSwingDelayMinMs: 2500,
  postSwingDelayMaxMs: 3600,

  pitchSpeedMin: 14,
  pitchSpeedMax: 19,
  breakX: 0.8,
  breakY: 0.45,

  swingWindowZ: 1.5,
  hitPlaneTolerance: 1.18,
  perfectPciDist: 0.7,
  goodPciDist: 1.12,
  perfectBatDist: 0.68,
  goodBatDist: 1.18,
  perfectTiming: 0.62,
  goodTiming: 1.02,

  weakImpulse: 3.6,
  goodImpulse: 6.0,
  perfectImpulse: 7.8,

  restitution: 0.5,
  friction: 0.33
};

const difficultyProfiles = {
  easy: {
    name: 'EASY',
    pitchSpeedMin: 9,
    pitchSpeedMax: 13,
    breakX: 0.2,
    breakY: 0.1,
    swingDurationMs: 360,
    swingCooldownMs: 720,
    postSwingDelayMinMs: 3000,
    postSwingDelayMaxMs: 4200,
    swingWindowZ: 1.85,
    hitPlaneTolerance: 1.45,
    perfectPciDist: 0.92,
    goodPciDist: 1.35,
    perfectBatDist: 0.9,
    goodBatDist: 1.45,
    perfectTiming: 0.82,
    goodTiming: 1.25
  },
  normal: {
    name: 'NORMAL',
    pitchSpeedMin: 12,
    pitchSpeedMax: 17,
    breakX: 0.45,
    breakY: 0.25,
    swingDurationMs: 330,
    swingCooldownMs: 660,
    postSwingDelayMinMs: 2700,
    postSwingDelayMaxMs: 3800,
    swingWindowZ: 1.68,
    hitPlaneTolerance: 1.3,
    perfectPciDist: 0.82,
    goodPciDist: 1.22,
    perfectBatDist: 0.8,
    goodBatDist: 1.3,
    perfectTiming: 0.72,
    goodTiming: 1.08
  },
  hard: {
    name: 'HARD',
    pitchSpeedMin: 14,
    pitchSpeedMax: 20,
    breakX: 0.8,
    breakY: 0.4,
    swingDurationMs: 285,
    swingCooldownMs: 560,
    postSwingDelayMinMs: 2200,
    postSwingDelayMaxMs: 3200,
    swingWindowZ: 1.38,
    hitPlaneTolerance: 1.1,
    perfectPciDist: 0.68,
    goodPciDist: 1.05,
    perfectBatDist: 0.62,
    goodBatDist: 1.0,
    perfectTiming: 0.56,
    goodTiming: 0.88
  }
};

let currentDifficulty = 'easy';
let activeConfig = { ...baseConfig, ...difficultyProfiles[currentDifficulty] };

function setDifficulty(mode) {
  if (!difficultyProfiles[mode]) return;
  currentDifficulty = mode;
  activeConfig = { ...baseConfig, ...difficultyProfiles[currentDifficulty] };
  if (difficultyEl) difficultyEl.value = mode;
  applyStrikeZoneAndPciConfig();
}

const fixedDt = 1 / 90;
const maxSubSteps = 4;

// ------------------------------------------------------------
// SCENE / CAMERA
// ------------------------------------------------------------
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  activeConfig.cameraFov,
  window.innerWidth / window.innerHeight,
  0.1,
  420
);
camera.position.set(0, 1.72, 1.35);
camera.lookAt(0, 1.2, -8.8);
scene.add(camera);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
renderer.domElement.style.cursor = 'none';

scene.add(new THREE.HemisphereLight(0xecf5ff, 0x2d4354, 0.98));
const sun = new THREE.DirectionalLight(0xffffff, 1.12);
sun.position.set(16, 20, 12);
scene.add(sun);

const skyGeo = new THREE.SphereGeometry(300, 36, 22);
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  uniforms: {
    topColor: { value: new THREE.Color(0x4f86cd) },
    bottomColor: { value: new THREE.Color(0xb9dbff) },
    offset: { value: 12.0 },
    exponent: { value: 0.85 }
  },
  vertexShader: `
    varying vec3 vWorldPosition;
    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPosition.xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 topColor;
    uniform vec3 bottomColor;
    uniform float offset;
    uniform float exponent;
    varying vec3 vWorldPosition;
    void main() {
      float h = normalize(vWorldPosition + offset).y;
      float t = max(pow(max(h, 0.0), exponent), 0.0);
      gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0);
    }
  `
});
scene.add(new THREE.Mesh(skyGeo, skyMat));

// ------------------------------------------------------------
// STADIUM ENVIRONMENT
// ------------------------------------------------------------
const HOME_PLATE = new THREE.Vector3(0, 0, 0);
const FIELD_SCALE = 0.5; // 1 unit ~= 2 ft (rough visual scale)
const BASE_PATH = 27.4 * FIELD_SCALE;
const MOUND_DISTANCE = 18.44 * FIELD_SCALE;
const OUTFIELD_RADIUS = 88 * FIELD_SCALE;

const field = new THREE.Mesh(
  new THREE.PlaneGeometry(260, 260),
  new THREE.MeshStandardMaterial({ color: 0x2e8f46, roughness: 0.95 })
);
field.rotation.x = -Math.PI / 2;
scene.add(field);

for (let i = 0; i < 12; i++) {
  const stripe = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 10),
    new THREE.MeshStandardMaterial({ color: i % 2 === 0 ? 0x2a8240 : 0x328f49, roughness: 0.96, transparent: true, opacity: 0.45 })
  );
  stripe.rotation.x = -Math.PI / 2;
  stripe.position.set(0, 0.012, -115 + i * 20);
  scene.add(stripe);
}

// Infield dirt around home and base paths (diamond feel)
const infieldCircle = new THREE.Mesh(
  new THREE.CircleGeometry(12.2, 80),
  new THREE.MeshStandardMaterial({ color: 0x8f7145, roughness: 0.9 })
);
infieldCircle.rotation.x = -Math.PI / 2;
infieldCircle.position.y = 0.01;
scene.add(infieldCircle);

const basePathLineA = new THREE.Mesh(
  new THREE.BoxGeometry(0.75, 0.02, BASE_PATH * 2.95),
  new THREE.MeshStandardMaterial({ color: 0x8f7145, roughness: 0.9 })
);
basePathLineA.position.set(BASE_PATH * 0.5, 0.02, -BASE_PATH * 0.5);
basePathLineA.rotation.y = Math.PI / 4;
scene.add(basePathLineA);

const basePathLineB = new THREE.Mesh(
  new THREE.BoxGeometry(0.75, 0.02, BASE_PATH * 2.95),
  new THREE.MeshStandardMaterial({ color: 0x8f7145, roughness: 0.9 })
);
basePathLineB.position.set(-BASE_PATH * 0.5, 0.02, -BASE_PATH * 0.5);
basePathLineB.rotation.y = -Math.PI / 4;
scene.add(basePathLineB);

const basePathLineC = new THREE.Mesh(
  new THREE.BoxGeometry(0.75, 0.02, BASE_PATH * 2.95),
  new THREE.MeshStandardMaterial({ color: 0x8f7145, roughness: 0.9 })
);
basePathLineC.position.set(BASE_PATH * 0.5, 0.02, -BASE_PATH * 1.5);
basePathLineC.rotation.y = -Math.PI / 4;
scene.add(basePathLineC);

const basePathLineD = new THREE.Mesh(
  new THREE.BoxGeometry(0.75, 0.02, BASE_PATH * 2.95),
  new THREE.MeshStandardMaterial({ color: 0x8f7145, roughness: 0.9 })
);
basePathLineD.position.set(-BASE_PATH * 0.5, 0.02, -BASE_PATH * 1.5);
basePathLineD.rotation.y = Math.PI / 4;
scene.add(basePathLineD);

const mound = new THREE.Mesh(
  new THREE.CylinderGeometry(1.4, 1.6, 0.16, 30),
  new THREE.MeshStandardMaterial({ color: 0x9b7c4f, roughness: 0.85 })
);
mound.position.set(0, 0.08, -MOUND_DISTANCE);
scene.add(mound);

const plate = new THREE.Mesh(
  new THREE.CylinderGeometry(0.42, 0.5, 0.04, 6),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65 })
);
plate.position.set(HOME_PLATE.x, 0.02, HOME_PLATE.z);
plate.rotation.y = Math.PI / 6;
scene.add(plate);

function addBase(x, z) {
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.08, 0.5),
    new THREE.MeshStandardMaterial({ color: 0xfefefe, roughness: 0.65 })
  );
  base.position.set(x, 0.04, z);
  scene.add(base);
}
addBase(BASE_PATH, -BASE_PATH); // 1B
addBase(-BASE_PATH, -BASE_PATH); // 3B
addBase(0, -BASE_PATH * 2); // 2B

const foulLineMat = new THREE.MeshBasicMaterial({ color: 0xf4f4f4 });
const foulLineA = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 95), foulLineMat);
foulLineA.position.set(33.6, 0.015, -33.6);
foulLineA.rotation.y = Math.PI / 4;
scene.add(foulLineA);

const foulLineB = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 95), foulLineMat);
foulLineB.position.set(-33.6, 0.015, -33.6);
foulLineB.rotation.y = -Math.PI / 4;
scene.add(foulLineB);

const backstopWall = new THREE.Mesh(
  new THREE.BoxGeometry(16, 8, 0.35),
  new THREE.MeshStandardMaterial({ color: 0x2e3844, roughness: 0.76 })
);
backstopWall.position.set(0, 4, 3.7);
scene.add(backstopWall);

const backstopNet = new THREE.Mesh(
  new THREE.PlaneGeometry(15, 7),
  new THREE.MeshBasicMaterial({ color: 0xb8ccdf, transparent: true, opacity: 0.22, side: THREE.DoubleSide })
);
backstopNet.position.set(0, 3.95, 3.5);
scene.add(backstopNet);

const outfieldWall = new THREE.Mesh(
  new THREE.CylinderGeometry(OUTFIELD_RADIUS, OUTFIELD_RADIUS, 4.8, 120, 1, true),
  new THREE.MeshStandardMaterial({ color: 0x1f4766, roughness: 0.82, side: THREE.DoubleSide })
);
outfieldWall.position.set(0, 2.4, -22);
scene.add(outfieldWall);

const warningTrack = new THREE.Mesh(
  new THREE.RingGeometry(OUTFIELD_RADIUS - 5.5, OUTFIELD_RADIUS, 150),
  new THREE.MeshStandardMaterial({ color: 0x8b6e46, roughness: 0.9, side: THREE.DoubleSide })
);
warningTrack.rotation.x = -Math.PI / 2;
warningTrack.position.set(0, 0.011, -22);
scene.add(warningTrack);

const seatMats = [
  new THREE.MeshStandardMaterial({ color: 0x566a84, roughness: 0.84 }),
  new THREE.MeshStandardMaterial({ color: 0x6f5f86, roughness: 0.84 }),
  new THREE.MeshStandardMaterial({ color: 0x5f7f6c, roughness: 0.84 }),
  new THREE.MeshStandardMaterial({ color: 0x7c6a56, roughness: 0.84 })
];
const seatGeo = new THREE.BoxGeometry(1.9, 0.56, 1.25);

for (let tier = 0; tier < 4; tier++) {
  const rows = 6;
  const stepsPerRing = 40 + tier * 6;
  const total = rows * stepsPerRing;
  const seatInstances = new THREE.InstancedMesh(seatGeo, seatMats[tier % seatMats.length], total);
  const m = new THREE.Matrix4();
  let idx = 0;

  for (let row = 0; row < rows; row++) {
    const radius = 18 + tier * 11 + row * 2.0;
    const y = 1.0 + tier * 2.0 + row * 0.6;
    for (let i = 0; i < stepsPerRing; i++) {
      const t = i / (stepsPerRing - 1);
      const a = THREE.MathUtils.lerp(0, Math.PI * 2, t);
      const x = Math.cos(a) * radius;
      const z = Math.sin(a) * radius - 10;
      m.compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a + Math.PI * 0.5, 0)),
        new THREE.Vector3(1, 1, 1)
      );
      seatInstances.setMatrixAt(idx++, m);
    }
  }
  seatInstances.instanceMatrix.needsUpdate = true;
  scene.add(seatInstances);
}

function addLightTower(x, z) {
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.28, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0x9ba4ab, roughness: 0.7 })
  );
  pole.position.set(x, 8, z);
  scene.add(pole);

  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 1.8, 0.4),
    new THREE.MeshStandardMaterial({ color: 0xdde8f2, emissive: 0x556677, emissiveIntensity: 0.35 })
  );
  panel.position.set(x, 16, z);
  panel.lookAt(0, 1.2, -8);
  scene.add(panel);
}
addLightTower(-34, -8);
addLightTower(34, -8);
addLightTower(-46, -42);
addLightTower(46, -42);

const scoreboard = new THREE.Mesh(
  new THREE.BoxGeometry(8, 4, 1),
  new THREE.MeshStandardMaterial({ color: 0x182430, roughness: 0.6, emissive: 0x101820, emissiveIntensity: 0.4 })
);
scoreboard.position.set(0, 6.5, -52);
scene.add(scoreboard);

const scoreboardFace = new THREE.Mesh(
  new THREE.PlaneGeometry(6.5, 2.8),
  new THREE.MeshBasicMaterial({ color: 0x9dd5ff, transparent: true, opacity: 0.85 })
);
scoreboardFace.position.set(0, 6.5, -51.45);
scene.add(scoreboardFace);

const dugoutMat = new THREE.MeshStandardMaterial({ color: 0x4f5b67, roughness: 0.8 });
for (const x of [-12.5, 12.5]) {
  const dugout = new THREE.Mesh(new THREE.BoxGeometry(6, 2.2, 2.2), dugoutMat);
  dugout.position.set(x, 1.1, 1.6);
  scene.add(dugout);
}

function addSimplePlayer(x, z, facing = 0, shirt = 0xeeeeee, pants = 0x4c5e7b) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = facing;

  const legMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.85 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xe6c29c, roughness: 0.8 });

  const leftLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.65, 10), legMat);
  leftLeg.position.set(-0.12, 0.33, 0);
  g.add(leftLeg);

  const rightLeg = leftLeg.clone();
  rightLeg.position.x = 0.12;
  g.add(rightLeg);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.45, 6, 10), shirtMat);
  torso.position.set(0, 0.95, 0);
  g.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), skinMat);
  head.position.set(0, 1.45, 0);
  g.add(head);

  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.165, 0.08, 12), new THREE.MeshStandardMaterial({ color: 0x213248, roughness: 0.7 }));
  cap.position.set(0, 1.56, 0);
  g.add(cap);

  scene.add(g);
}

addSimplePlayer(0, -MOUND_DISTANCE, Math.PI, 0xdbe5ef, 0x42556d); // pitcher
addSimplePlayer(BASE_PATH + 2.8, -BASE_PATH - 0.8, Math.PI * 1.35, 0xdfe6f4, 0x4a5b73); // 1B
addSimplePlayer(-BASE_PATH - 2.8, -BASE_PATH - 0.8, Math.PI * 0.65, 0xdfe6f4, 0x4a5b73); // 3B
addSimplePlayer(3.8, -BASE_PATH - 4.6, Math.PI * 1.1, 0xdfe6f4, 0x4a5b73); // 2B
addSimplePlayer(-3.8, -BASE_PATH - 4.6, Math.PI * 0.9, 0xdfe6f4, 0x4a5b73); // SS
addSimplePlayer(0, -BASE_PATH * 2.55, Math.PI, 0xdfe6f4, 0x4a5b73); // CF

// ------------------------------------------------------------
// STRIKE ZONE + PCI
// ------------------------------------------------------------
const STRIKE_ZONE_CENTER_Y = 1.14;

const strikeZone = {
  center: new THREE.Vector3(),
  width: activeConfig.strikeZoneWidth,
  height: activeConfig.strikeZoneHeight,
  depth: activeConfig.strikeZoneDepth
};

const zoneFill = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshBasicMaterial({ color: 0x67bcff, transparent: true, opacity: 0.13, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
);
zoneFill.renderOrder = 14;
scene.add(zoneFill);

const zoneEdges = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
  new THREE.LineBasicMaterial({ color: 0xeef8ff, depthTest: false, transparent: true, opacity: 0.96 })
);
zoneEdges.renderOrder = 20;
scene.add(zoneEdges);

const pciGroup = new THREE.Group();
const wedgeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.96 });
let outerLeft;
let outerRight;
let innerLeft;
let innerRight;
let pciDot;
let pciDot2;
let pciDot3;
scene.add(pciGroup);

const pciPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.0);
const raycaster = new THREE.Raycaster();
const mouseNdc = new THREE.Vector2(0, 0);
const rayHit = new THREE.Vector3();

let pciOffsetX = 0;
let pciOffsetY = 0;

function rebuildPciGeometry() {
  for (const m of [outerLeft, outerRight, innerLeft, innerRight, pciDot, pciDot2, pciDot3]) {
    if (!m) continue;
    pciGroup.remove(m);
    m.geometry.dispose();
  }

  outerLeft = new THREE.Mesh(new THREE.RingGeometry(activeConfig.pciRadius * 3.2, activeConfig.pciRadius * 2.86, 30, 1, Math.PI * 0.61, Math.PI * 0.9), wedgeMat.clone());
  outerRight = new THREE.Mesh(new THREE.RingGeometry(activeConfig.pciRadius * 3.2, activeConfig.pciRadius * 2.86, 30, 1, Math.PI * 1.49, Math.PI * 0.9), wedgeMat.clone());
  innerLeft = new THREE.Mesh(new THREE.RingGeometry(activeConfig.pciRadius * 1.65, activeConfig.pciRadius * 1.38, 24, 1, Math.PI * 0.73, Math.PI * 0.62), wedgeMat.clone());
  innerRight = new THREE.Mesh(new THREE.RingGeometry(activeConfig.pciRadius * 1.65, activeConfig.pciRadius * 1.38, 24, 1, Math.PI * 1.79, Math.PI * 0.62), wedgeMat.clone());

  pciDot = new THREE.Mesh(
    new THREE.BoxGeometry(0.068, 0.068, 0.002),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
  );
  pciDot.rotation.z = Math.PI / 4;

  pciDot2 = new THREE.Mesh(
    new THREE.BoxGeometry(0.046, 0.046, 0.002),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
  );
  pciDot2.rotation.z = Math.PI / 4;
  pciDot2.position.y = -0.12;

  pciDot3 = new THREE.Mesh(
    new THREE.BoxGeometry(0.028, 0.028, 0.002),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
  );
  pciDot3.rotation.z = Math.PI / 4;
  pciDot3.position.y = -0.205;

  pciGroup.add(outerLeft, outerRight, innerLeft, innerRight, pciDot, pciDot2, pciDot3);
}

function updatePciTransform() {
  pciGroup.position.set(
    strikeZone.center.x + pciOffsetX,
    strikeZone.center.y + pciOffsetY,
    strikeZone.center.z + strikeZone.depth * 0.55
  );
  pciGroup.lookAt(camera.position);
}

function applyStrikeZoneAndPciConfig() {
  strikeZone.width = activeConfig.strikeZoneWidth;
  strikeZone.height = activeConfig.strikeZoneHeight;
  strikeZone.depth = activeConfig.strikeZoneDepth;

  strikeZone.center.set(0, STRIKE_ZONE_CENTER_Y, camera.position.z - activeConfig.strikeZoneDistance);

  zoneFill.geometry.dispose();
  zoneFill.geometry = new THREE.BoxGeometry(strikeZone.width, strikeZone.height, strikeZone.depth);
  zoneFill.position.copy(strikeZone.center);

  zoneEdges.geometry.dispose();
  zoneEdges.geometry = new THREE.EdgesGeometry(zoneFill.geometry);
  zoneEdges.position.copy(strikeZone.center);

  pciPlane.constant = -(strikeZone.center.z + strikeZone.depth * 0.55);

  rebuildPciGeometry();

  const halfW = strikeZone.width * 0.5;
  const halfH = strikeZone.height * 0.5;
  pciOffsetX = THREE.MathUtils.clamp(pciOffsetX, -halfW, halfW);
  pciOffsetY = THREE.MathUtils.clamp(pciOffsetY, -halfH, halfH);
  updatePciTransform();
}

applyStrikeZoneAndPciConfig();

// ------------------------------------------------------------
// FIRST-PERSON BAT + SWING ANIMATION
// ------------------------------------------------------------
const batPivot = new THREE.Group();
camera.add(batPivot);

const batIdlePos = new THREE.Vector3(1.02, -0.7, -1.72);
const batLoadPos = new THREE.Vector3(1.14, -0.77, -1.78);
const batContactPos = new THREE.Vector3(0.22, -0.37, -1.22);
const batFollowPos = new THREE.Vector3(-0.72, -0.1, -1.08);

const batIdleRot = new THREE.Euler(-0.22, -1.2, 1.08);
const batLoadRot = new THREE.Euler(-0.5, -1.58, 1.16);
const batContactRot = new THREE.Euler(-0.08, 0.1, 0.04);
const batFollowRot = new THREE.Euler(0.2, 1.2, -0.62);

batPivot.position.copy(batIdlePos);
batPivot.rotation.copy(batIdleRot);

const batMesh = new THREE.Mesh(
  new THREE.CylinderGeometry(0.045, 0.065, 1.58, 20),
  new THREE.MeshStandardMaterial({ color: 0xcf9e68, roughness: 0.42, metalness: 0.02 })
);
batMesh.rotation.z = Math.PI / 2;
batMesh.position.set(0.84, -0.09, -0.2);
batPivot.add(batMesh);

const batCap = new THREE.Mesh(
  new THREE.SphereGeometry(0.068, 16, 12),
  new THREE.MeshStandardMaterial({ color: 0xab7948, roughness: 0.48 })
);
batCap.position.set(-0.08, -0.09, -0.2);
batPivot.add(batCap);

let isSwinging = false;
let swingStartMs = 0;
let nextSwingAllowedMs = 0;
let swingUsedThisPitch = false;
let swingContactResolved = false;
let swingMissQueued = false;
let nextPitchReadyAt = 0;
let pitchInFlight = false;

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function updateBatSwing(nowMs) {
  if (!isSwinging) return;

  const t = THREE.MathUtils.clamp((nowMs - swingStartMs) / activeConfig.swingDurationMs, 0, 1);

  if (t < 0.24) {
    const a = smoothstep(t / 0.24);
    batPivot.rotation.set(
      THREE.MathUtils.lerp(batIdleRot.x, batLoadRot.x, a),
      THREE.MathUtils.lerp(batIdleRot.y, batLoadRot.y, a),
      THREE.MathUtils.lerp(batIdleRot.z, batLoadRot.z, a)
    );
    batPivot.position.lerpVectors(batIdlePos, batLoadPos, a);
  } else if (t < 0.64) {
    const a = smoothstep((t - 0.24) / 0.4);
    batPivot.rotation.set(
      THREE.MathUtils.lerp(batLoadRot.x, batContactRot.x, a),
      THREE.MathUtils.lerp(batLoadRot.y, batContactRot.y, a),
      THREE.MathUtils.lerp(batLoadRot.z, batContactRot.z, a)
    );
    batPivot.position.lerpVectors(batLoadPos, batContactPos, a);
  } else if (t < 0.88) {
    const a = smoothstep((t - 0.64) / 0.24);
    batPivot.rotation.set(
      THREE.MathUtils.lerp(batContactRot.x, batFollowRot.x, a),
      THREE.MathUtils.lerp(batContactRot.y, batFollowRot.y, a),
      THREE.MathUtils.lerp(batContactRot.z, batFollowRot.z, a)
    );
    batPivot.position.lerpVectors(batContactPos, batFollowPos, a);
  } else {
    const a = smoothstep((t - 0.88) / 0.12);
    batPivot.rotation.set(
      THREE.MathUtils.lerp(batFollowRot.x, batIdleRot.x, a),
      THREE.MathUtils.lerp(batFollowRot.y, batIdleRot.y, a),
      THREE.MathUtils.lerp(batFollowRot.z, batIdleRot.z, a)
    );
    batPivot.position.lerpVectors(batFollowPos, batIdlePos, a);
  }

  const inContactPhase = t >= activeConfig.contactWindowStart && t <= activeConfig.contactWindowEnd;
  if (inContactPhase && !swingContactResolved) {
    tryResolveContact();
  }

  if (t >= 1) {
    isSwinging = false;
    batPivot.rotation.copy(batIdleRot);
    batPivot.position.copy(batIdlePos);
    if (!swingContactResolved && swingMissQueued) {
      showResult('MISS');
      registerOut();
    }
    scheduleNextPitch();
  }
}

function getBatSweetSpotWorld() {
  return batPivot.localToWorld(new THREE.Vector3(1.34, -0.08, -0.2));
}

// ------------------------------------------------------------
// PHYSICS WORLD
// ------------------------------------------------------------
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.solver.iterations = 10;
world.solver.tolerance = 1e-4;

const ballMaterial = new CANNON.Material('ball');
const groundMaterial = new CANNON.Material('ground');
world.addContactMaterial(
  new CANNON.ContactMaterial(ballMaterial, groundMaterial, {
    restitution: activeConfig.restitution,
    friction: activeConfig.friction
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
// AUDIO (procedural + simple background music)
// ------------------------------------------------------------
let audioCtx = null;
let musicStarted = false;
let musicTimer = null;
let musicStep = 0;

function ensureAudioContext() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
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

function playMusicTick() {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  const notes = [261.63, 329.63, 392.0, 329.63, 293.66, 349.23, 440.0, 349.23];
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = notes[musicStep % notes.length];

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.035, now + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.36);
  musicStep += 1;
}

function startMusic() {
  if (musicStarted) return;
  musicStarted = true;
  playMusicTick();
  musicTimer = setInterval(playMusicTick, 360);
}

// ------------------------------------------------------------
// HUD + SCORE + MINIMAP
// ------------------------------------------------------------
const statusEl = document.getElementById('status');
const detailsEl = document.getElementById('details');
const difficultyEl = document.getElementById('difficulty');
const scoreEl = document.getElementById('score');
const minimapCanvas = document.getElementById('minimap');
const mapCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;
let hudTimer = null;

const gameStats = {
  score: 0,
  hits: 0,
  homeruns: 0,
  fouls: 0,
  outs: 0
};

const minimapDots = [];

function updateScoreText() {
  if (!scoreEl) return;
  scoreEl.textContent = `Score ${gameStats.score} | H ${gameStats.hits} | HR ${gameStats.homeruns} | F ${gameStats.fouls} | O ${gameStats.outs}`;
}

function drawMinimap() {
  if (!mapCtx || !minimapCanvas) return;
  const w = minimapCanvas.width;
  const h = minimapCanvas.height;
  mapCtx.clearRect(0, 0, w, h);

  mapCtx.fillStyle = '#113024';
  mapCtx.fillRect(0, 0, w, h);

  const homeX = w * 0.5;
  const homeY = h - 10;
  const mapScale = OUTFIELD_RADIUS / (h * 0.72);

  // Outfield fence arc
  mapCtx.strokeStyle = '#7ad090';
  mapCtx.lineWidth = 2;
  mapCtx.beginPath();
  mapCtx.arc(homeX, homeY, OUTFIELD_RADIUS / mapScale, Math.PI * 1.22, Math.PI * 1.78);
  mapCtx.stroke();

  // Foul lines
  mapCtx.strokeStyle = '#d8e4f5';
  mapCtx.beginPath();
  mapCtx.moveTo(homeX, homeY);
  mapCtx.lineTo(homeX + 34, homeY - 34);
  mapCtx.moveTo(homeX, homeY);
  mapCtx.lineTo(homeX - 34, homeY - 34);
  mapCtx.stroke();


  function drawDiamond(cx, cy, size, fill = false) {
    mapCtx.beginPath();
    mapCtx.moveTo(cx, cy - size);
    mapCtx.lineTo(cx + size, cy);
    mapCtx.lineTo(cx, cy + size);
    mapCtx.lineTo(cx - size, cy);
    mapCtx.closePath();
    if (fill) mapCtx.fill();
    else mapCtx.stroke();
  }

  // Infield diamond
  const first = { x: homeX + BASE_PATH / mapScale, y: homeY - BASE_PATH / mapScale };
  const second = { x: homeX, y: homeY - (BASE_PATH * 2) / mapScale };
  const third = { x: homeX - BASE_PATH / mapScale, y: homeY - BASE_PATH / mapScale };
  mapCtx.strokeStyle = '#b8c8d8';
  mapCtx.beginPath();
  mapCtx.moveTo(homeX, homeY);
  mapCtx.lineTo(first.x, first.y);
  mapCtx.lineTo(second.x, second.y);
  mapCtx.lineTo(third.x, third.y);
  mapCtx.closePath();
  mapCtx.stroke();

  mapCtx.strokeStyle = '#f4f7ff';
  drawDiamond(homeX, homeY, 2.8);
  drawDiamond(first.x, first.y, 2.5, true);
  drawDiamond(second.x, second.y, 2.5, true);
  drawDiamond(third.x, third.y, 2.5, true);

  mapCtx.fillStyle = '#e74c3c';
  for (const dot of minimapDots) {
    mapCtx.beginPath();
    mapCtx.arc(dot.x, dot.y, 3, 0, Math.PI * 2);
    mapCtx.fill();
  }
}

drawMinimap();
updateScoreText();

if (difficultyEl) {
  difficultyEl.value = currentDifficulty;
  difficultyEl.addEventListener('change', (event) => {
    setDifficulty(event.target.value);
    showResult(`Difficulty: ${activeConfig.name}`);
    scheduleNextPitch();
  });
}

function showResult(text, mph = null) {
  statusEl.textContent = text;
  const evText = mph == null ? '' : `Exit velocity: ${mph.toFixed(1)} mph`;
  detailsEl.textContent = `${evText}${evText ? ' • ' : ''}${activeConfig.name}`;

  if (hudTimer) clearTimeout(hudTimer);
  hudTimer = setTimeout(() => {
    statusEl.textContent = 'TRACK THE BALL';
    detailsEl.textContent = '';
  }, 900);
}

function registerOut() {
  gameStats.outs += 1;
  updateScoreText();
}

function addMinimapLanding(worldX, worldZ) {
  if (!mapCtx || !minimapCanvas) return;
  const mapScale = OUTFIELD_RADIUS / (minimapCanvas.height * 0.72);
  const mx = minimapCanvas.width * 0.5 + worldX / mapScale;
  const my = minimapCanvas.height - 10 + worldZ / mapScale;
  minimapDots.push({ x: THREE.MathUtils.clamp(mx, 5, minimapCanvas.width - 5), y: THREE.MathUtils.clamp(my, 5, minimapCanvas.height - 5) });
  if (minimapDots.length > 12) minimapDots.shift();
  drawMinimap();
}

// ------------------------------------------------------------
// PITCHING
// ------------------------------------------------------------
const spawnPos = new CANNON.Vec3(0, 1.52, -MOUND_DISTANCE);
let ballWasHit = false;
let ballLandingTracked = false;

function randomPitchVelocity() {
  const r = Math.random();
  const pitchType = r < 0.45 ? 'FASTBALL' : r < 0.75 ? 'CURVE' : 'DROP';

  const tx = (Math.random() - 0.5) * strikeZone.width * 0.85;
  const ty = strikeZone.center.y + (Math.random() - 0.5) * strikeZone.height * 0.82;
  const tz = strikeZone.center.z;

  const toTarget = new THREE.Vector3(tx - spawnPos.x, ty - spawnPos.y, tz - spawnPos.z).normalize();
  let speed = THREE.MathUtils.lerp(activeConfig.pitchSpeedMin, activeConfig.pitchSpeedMax, Math.random());

  let breakX = (Math.random() - 0.5) * activeConfig.breakX;
  let breakY = (Math.random() - 0.5) * activeConfig.breakY;

  if (pitchType === 'FASTBALL') {
    speed += 1.6;
    breakX *= 0.35;
    breakY *= 0.35;
  } else if (pitchType === 'CURVE') {
    breakX *= 1.2;
    breakY *= 0.55;
  } else {
    breakX *= 0.5;
    breakY -= Math.abs(breakY) * 0.8;
  }

  return new CANNON.Vec3(toTarget.x * speed + breakX, toTarget.y * speed + breakY, toTarget.z * speed);
}

function queueBallAtMound() {
  ballBody.position.copy(spawnPos);
  ballBody.velocity.setZero();
  ballBody.angularVelocity.setZero();
  ballBody.quaternion.set(0, 0, 0, 1);

  swingUsedThisPitch = false;
  swingContactResolved = false;
  swingMissQueued = false;
  pitchInFlight = false;
  ballWasHit = false;
  ballLandingTracked = false;
}

function launchPitch() {
  ballBody.velocity.copy(randomPitchVelocity());
  pitchInFlight = true;
  playPitchSound();
}

function scheduleNextPitch() {
  queueBallAtMound();
  const delay = THREE.MathUtils.lerp(activeConfig.postSwingDelayMinMs, activeConfig.postSwingDelayMaxMs, Math.random());
  nextPitchReadyAt = performance.now() + delay;
}

scheduleNextPitch();

// ------------------------------------------------------------
// INPUT (PCI ATTACHED TO CURSOR)
// ------------------------------------------------------------
window.addEventListener('mousemove', (e) => {

  mouseNdc.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouseNdc.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouseNdc, camera);

  if (raycaster.ray.intersectPlane(pciPlane, rayHit)) {
    pciOffsetX = rayHit.x - strikeZone.center.x;
    pciOffsetY = rayHit.y - strikeZone.center.y;

    const halfW = strikeZone.width * 0.5;
    const halfH = strikeZone.height * 0.5;
    pciOffsetX = THREE.MathUtils.clamp(pciOffsetX, -halfW, halfW);
    pciOffsetY = THREE.MathUtils.clamp(pciOffsetY, -halfH, halfH);
    updatePciTransform();
  }
});

window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  ensureAudioContext();
  startMusic();

  if (key === 'r') {
    pciOffsetX = 0;
    pciOffsetY = 0;
    updatePciTransform();
    scheduleNextPitch();
    return;
  }

  if (key === 'm') {
    if (musicTimer) {
      clearInterval(musicTimer);
      musicTimer = null;
      musicStarted = false;
      showResult('MUSIC OFF');
    } else {
      startMusic();
      showResult('MUSIC ON');
    }
    return;
  }

  if (key !== ' ' && e.code !== 'Space') return;

  e.preventDefault();
  const now = performance.now();

  if (now < nextSwingAllowedMs || isSwinging || swingUsedThisPitch || !pitchInFlight) return;

  isSwinging = true;
  swingStartMs = now;
  nextSwingAllowedMs = now + activeConfig.swingCooldownMs;
  swingUsedThisPitch = true;
  swingContactResolved = false;
  swingMissQueued = true;
});

// ------------------------------------------------------------
// HIT DETECTION + SCORING
// ------------------------------------------------------------
function pciBallDistance() {
  const dx = ballBody.position.x - (strikeZone.center.x + pciOffsetX);
  const dy = ballBody.position.y - (strikeZone.center.y + pciOffsetY);
  return Math.hypot(dx, dy);
}

function isFairBall(x, z) {
  if (z > 0) return false;
  return Math.abs(x) <= Math.abs(z) * 1.05;
}

function classifyContact(pciDist, timingDist, batDist) {
  const perfect =
    pciDist <= activeConfig.perfectPciDist &&
    timingDist <= activeConfig.perfectTiming &&
    batDist <= activeConfig.perfectBatDist;
  if (perfect) return 'PERFECT';

  const good =
    pciDist <= activeConfig.goodPciDist &&
    timingDist <= activeConfig.goodTiming &&
    batDist <= activeConfig.goodBatDist;
  if (good) return 'GOOD';

  return 'WEAK';
}

function tryResolveContact() {
  const timingDist = Math.abs(ballBody.position.z - strikeZone.center.z);
  if (timingDist > activeConfig.swingWindowZ || ballBody.position.z > strikeZone.center.z + 0.6) {
    return;
  }

  const pciDist = pciBallDistance();
  if (pciDist > activeConfig.goodPciDist * 2.0) return;

  const sweetSpot = getBatSweetSpotWorld();
  const batDist = sweetSpot.distanceTo(ballMesh.position);
  if (batDist > activeConfig.goodBatDist * 1.95) return;

  swingContactResolved = true;
  swingMissQueued = false;
  ballWasHit = true;

  const quality = classifyContact(pciDist, timingDist, batDist);

  const xInfluence = THREE.MathUtils.clamp(pciOffsetX / (strikeZone.width * 0.5), -1, 1);
  const yInfluence = THREE.MathUtils.clamp(pciOffsetY / (strikeZone.height * 0.5), -1, 1);
  const timingScale = 1 - THREE.MathUtils.clamp(timingDist / activeConfig.hitPlaneTolerance, 0, 1);

  let impulseMag = activeConfig.weakImpulse;
  if (quality === 'GOOD') impulseMag = activeConfig.goodImpulse;
  if (quality === 'PERFECT') impulseMag = activeConfig.perfectImpulse;

  const hitDir = new CANNON.Vec3(
    xInfluence * 0.82,
    0.82 + yInfluence * 0.62 + timingScale * 0.2,
    1.05 - Math.abs(xInfluence) * 0.14
  );
  hitDir.normalize();
  hitDir.scale(impulseMag * (0.82 + timingScale * 0.35), hitDir);

  const preSpeed = ballBody.velocity.length();
  if (preSpeed > 42) ballBody.velocity.scale(42 / preSpeed, ballBody.velocity);

  ballBody.applyImpulse(hitDir, ballBody.position);

  const exitMph = ballBody.velocity.length() * 2.23694;
  showResult(quality, exitMph);
  playHitSound(quality !== 'WEAK');
}

function handleBallLanding() {
  if (!ballWasHit || ballLandingTracked) return;
  if (ballBody.position.y > 0.13) return;

  ballLandingTracked = true;
  const x = ballBody.position.x;
  const z = ballBody.position.z;
  addMinimapLanding(x, z);

  const fair = isFairBall(x, z);
  const distance = Math.hypot(x, z);

  if (!fair) {
    gameStats.fouls += 1;
    showResult('FOUL BALL');
  } else if (distance > 48) {
    gameStats.hits += 1;
    gameStats.homeruns += 1;
    gameStats.score += 1;
    showResult('HOME RUN');
  } else {
    gameStats.hits += 1;
    gameStats.score += distance > 30 ? 1 : 0;
    showResult(distance > 30 ? 'FAIR HIT - RUN SCORED' : 'FAIR HIT');
  }
  updateScoreText();
}

function maybeAutoMiss() {
  if (!swingUsedThisPitch && pitchInFlight && ballBody.position.z > strikeZone.center.z + 0.72) {
    swingUsedThisPitch = true;
    showResult('MISS');
    registerOut();
    scheduleNextPitch();
  }
}

// ------------------------------------------------------------
// LOOP HELPERS
// ------------------------------------------------------------
function shouldResetBallOutOfPlay() {
  return (
    ballBody.position.z > 18 ||
    Math.abs(ballBody.position.x) > 24 ||
    Math.abs(ballBody.position.z) > 48 ||
    ballBody.position.y < -4
  );
}

function updatePciColor() {
  const d = pciBallDistance();
  let color = 0xffffff;
  if (d <= activeConfig.goodPciDist) color = 0xffe066;
  if (d <= activeConfig.perfectPciDist) color = 0x60ff75;
  outerLeft.material.color.setHex(color);
  outerRight.material.color.setHex(color);
  innerLeft.material.color.setHex(color);
  innerRight.material.color.setHex(color);
  pciDot.material.color.setHex(color);
  pciDot2.material.color.setHex(color);
  pciDot3.material.color.setHex(color);
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
  if (!pitchInFlight && now >= nextPitchReadyAt) {
    launchPitch();
  }

  updateBatSwing(now);
  handleBallLanding();

  maybeAutoMiss();
  if (pitchInFlight && shouldResetBallOutOfPlay()) {
    scheduleNextPitch();
  }

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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  applyStrikeZoneAndPciConfig();
});
