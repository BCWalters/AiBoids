import * as THREE from 'three';

function rotateAroundPivot(y: number, z: number, pivotY: number, angleRad: number): [number, number] {
  const dy = y - pivotY;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return [pivotY + dy * cos - z * sin, dy * sin + z * cos];
}

const length = 45, width = 19.8;
const halfLen = length * 0.5;
const RUMP_Y_FRACTION = 0.70;
const RUMP_R_SCALE = 0.26;
const NECK_PIVOT_FRACTION = 0.24;
const NECK_ANGLE_RAD = 0.4;
const HEAD_PIVOT_FRACTION = 0.56;
const HEAD_ANGLE_RAD = -0.6;
const SNOUT_TIP_FRACTION = 1.1;

const profile = [
  new THREE.Vector2(width * RUMP_R_SCALE, -halfLen * RUMP_Y_FRACTION),
  new THREE.Vector2(width * 0.52, -halfLen * 0.32),
  new THREE.Vector2(width * 0.46, halfLen * 0.02),
  new THREE.Vector2(width * 0.28, halfLen * 0.24),
  new THREE.Vector2(width * 0.19, halfLen * 0.42),
  new THREE.Vector2(width * 0.21, halfLen * 0.52),
  new THREE.Vector2(width * 0.27, halfLen * 0.6),
  new THREE.Vector2(width * 0.22, halfLen * 0.68),
  new THREE.Vector2(width * 0.14, halfLen * 0.8),
  new THREE.Vector2(width * 0.08, halfLen * 0.94),
  new THREE.Vector2(width * 0.015, halfLen * SNOUT_TIP_FRACTION),
];
const smoothProfile = new THREE.SplineCurve(profile).getPoints(64);
const latheGeometry = new THREE.LatheGeometry(smoothProfile, 48);

// Scale Z by 0.62
const pos = latheGeometry.getAttribute('position') as THREE.BufferAttribute;
for (let i = 0; i < pos.count; i++) {
  pos.setZ(i, pos.getZ(i) * 0.62);
}
pos.needsUpdate = true;

// Apply neck bend
const [bentHeadPivotY, bentHeadPivotZ] = rotateAroundPivot(halfLen * HEAD_PIVOT_FRACTION, 0, halfLen * NECK_PIVOT_FRACTION, NECK_ANGLE_RAD);
for (let i = 0; i < pos.count; i++) {
  const origY = pos.getY(i);
  let y = origY, z = pos.getZ(i);
  if (origY > halfLen * NECK_PIVOT_FRACTION) {
    [y, z] = rotateAroundPivot(y, z, halfLen * NECK_PIVOT_FRACTION, NECK_ANGLE_RAD);
  }
  if (origY > halfLen * HEAD_PIVOT_FRACTION) {
    const dy = y - bentHeadPivotY;
    const dz = z - bentHeadPivotZ;
    const cos = Math.cos(HEAD_ANGLE_RAD);
    const sin = Math.sin(HEAD_ANGLE_RAD);
    y = bentHeadPivotY + dy * cos - dz * sin;
    z = bentHeadPivotZ + dy * sin + dz * cos;
  }
  pos.setXYZ(i, pos.getX(i), y, z);
}
pos.needsUpdate = true;

latheGeometry.computeBoundingBox();
const bb = latheGeometry.boundingBox!;
console.log('Z span:', (bb.max.z - bb.min.z).toFixed(2));
console.log('X span:', (bb.max.x - bb.min.x).toFixed(2));
console.log('Y span:', (bb.max.y - bb.min.y).toFixed(2));

const zSpan = bb.max.z - bb.min.z;
for (const spl of [10, 15, 20, 25]) {
  const freq = spl / zSpan;
  const cellSize = 1 / freq;
  console.log(`scalesPerLength=${spl}: cellSize=${cellSize.toFixed(3)} wu`);
}
