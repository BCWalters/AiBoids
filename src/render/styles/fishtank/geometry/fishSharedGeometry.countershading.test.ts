import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { bakeCountershadeColors } from './fishSharedGeometry';
import {
  BLUE_TANG_FISHTANK_PALETTE,
  GOLDFISH_FISHTANK_PALETTE,
  createBlueTangGeometries,
  createGoldfishGeometries,
} from './smallFishGeometry';

/**
 * Fish bodies are lathes whose radius shrinks to nearly zero at the snout
 * and at the caudal peduncle. Normalising a dorsoventral pattern by
 * `position.z / bodyDepthSpan` therefore collapses every vertex at either
 * end toward the middle of the range regardless of which way its surface
 * actually faces, washing the pattern out to a flat back/belly average
 * exactly where the body narrows.
 *
 * Measured on a goldfish before the fix, sampling the topmost body vertex
 * in each of eight bands along Y:
 *
 *     peduncle #ff8929 | ... | mid-body #ff6a00 | ... | snout #ff8323
 *
 * against a configured back colour of #ff6a00 — a pale smear at both ends
 * of an otherwise solid orange back. Same defect and same fix as #227 on
 * bird bodies: key the gradient to the surface normal, which is
 * radius-independent.
 *
 * Vertex colours are stored **linear**, so every comparison here converts
 * the shipped sRGB palette hex to linear rather than the other way round.
 */

function linearPalette(hex: number): THREE.Color {
  return new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
}

function channelDistance(a: THREE.Color, b: THREE.Color): number {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}

function vertexColor(geometry: THREE.BufferGeometry, index: number): THREE.Color {
  const attribute = geometry.attributes.color as THREE.BufferAttribute;
  return new THREE.Color(attribute.getX(index), attribute.getY(index), attribute.getZ(index));
}

/**
 * A lathe that tapers to a point at both ends — the shape every fish body
 * in the tank has, and the shape the old position-based normalisation
 * degenerates on. Deliberately built here rather than imported so the
 * geometry under test is unambiguous.
 */
function buildTaperingLathe(): THREE.BufferGeometry {
  const profile = [
    new THREE.Vector2(0.0, -4.0),
    new THREE.Vector2(0.4, -3.0),
    new THREE.Vector2(1.0, -1.0),
    new THREE.Vector2(1.2, 0.5),
    new THREE.Vector2(0.7, 2.5),
    new THREE.Vector2(0.0, 4.0),
  ];
  return new THREE.LatheGeometry(profile, 24);
}

/** Index of the highest / lowest vertex within `tolerance` of `y`. */
function extremeVertexAt(geometry: THREE.BufferGeometry, y: number, tolerance: number, top: boolean): number {
  const position = geometry.attributes.position;
  let best = -1;
  let bestZ = top ? -Infinity : Infinity;
  for (let i = 0; i < position.count; i++) {
    if (Math.abs(position.getY(i) - y) > tolerance) continue;
    const z = position.getZ(i);
    if (top ? z > bestZ : z < bestZ) {
      bestZ = z;
      best = i;
    }
  }
  return best;
}

describe('bakeCountershadeColors on a tapering lathe', () => {
  it('reaches the configured back and belly colours where the body is narrowest', () => {
    const geometry = bakeCountershadeColors(
      buildTaperingLathe(),
      linearPalette(GOLDFISH_FISHTANK_PALETTE.back),
      linearPalette(GOLDFISH_FISHTANK_PALETTE.belly),
    );
    const back = linearPalette(GOLDFISH_FISHTANK_PALETTE.back);
    const belly = linearPalette(GOLDFISH_FISHTANK_PALETTE.belly);

    // y = -3.0 has a radius of 0.4 against the body's widest 1.2, so the
    // position-normalised gradient can only span a third of the range
    // there and lands nowhere near either endpoint.
    const narrowY = -3.0;
    const top = extremeVertexAt(geometry, narrowY, 0.05, true);
    const bottom = extremeVertexAt(geometry, narrowY, 0.05, false);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(bottom).toBeGreaterThanOrEqual(0);

    expect(
      channelDistance(vertexColor(geometry, top), back),
      `narrow-station dorsal is ${vertexColor(geometry, top).getHexString()}, configured back is ${back.getHexString()}`,
    ).toBeLessThan(0.05);
    expect(
      channelDistance(vertexColor(geometry, bottom), belly),
      `narrow-station ventral is ${vertexColor(geometry, bottom).getHexString()}, configured belly is ${belly.getHexString()}`,
    ).toBeLessThan(0.05);
  });

  it('gives the same dorsal colour at the narrow station as at the widest one', () => {
    const geometry = bakeCountershadeColors(
      buildTaperingLathe(),
      linearPalette(GOLDFISH_FISHTANK_PALETTE.back),
      linearPalette(GOLDFISH_FISHTANK_PALETTE.belly),
    );
    const wide = extremeVertexAt(geometry, 0.5, 0.05, true);
    const narrow = extremeVertexAt(geometry, -3.0, 0.05, true);

    expect(
      channelDistance(vertexColor(geometry, wide), vertexColor(geometry, narrow)),
      `widest station ${vertexColor(geometry, wide).getHexString()} vs narrow station ${vertexColor(geometry, narrow).getHexString()}`,
    ).toBeLessThan(0.02);
  });
});

describe('shipped fish variants keep their dorsoventral patterns at the ends', () => {
  it('gives the goldfish a full-length dorsal ridge at the configured back colour', () => {
    const geometry = (createGoldfishGeometries(9.1, 3.2) as { body: THREE.BufferGeometry }).body;
    const back = linearPalette(GOLDFISH_FISHTANK_PALETTE.back);

    let atBackColor = 0;
    for (let i = 0; i < geometry.attributes.position.count; i++) {
      if (channelDistance(vertexColor(geometry, i), back) < 0.02) atBackColor++;
    }

    // Bound to the shipped palette, and absolute rather than expressed as
    // a fraction of whatever the current count happens to be. Measured:
    // 423 vertices reach the configured back colour with the fix, 150
    // without it — the ridge only got there at the body's deepest station.
    // 300 sits clear of both.
    expect(
      atBackColor,
      `only ${atBackColor} of ${geometry.attributes.position.count} goldfish body vertices reach the configured back colour ${back.getHexString()}`,
    ).toBeGreaterThan(300);
  });

  it("keeps the blue tang's flank mark on the widest point of the body at every station", () => {
    const geometry = (createBlueTangGeometries(9.1, 3.2) as { body: THREE.BufferGeometry }).body;
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox!;
    const position = geometry.attributes.position;
    const markColor = linearPalette(BLUE_TANG_FISHTANK_PALETTE.mark);
    const bandCount = 8;

    const boundaries: Array<{ y: number; relativeZ: number; halfDepth: number }> = [];
    for (let band = 0; band < bandCount; band++) {
      const from = bounds.min.y + ((bounds.max.y - bounds.min.y) * band) / bandCount;
      const to = bounds.min.y + ((bounds.max.y - bounds.min.y) * (band + 1)) / bandCount;
      let halfDepth = 0;
      let lowestMarkedZ = Infinity;
      for (let i = 0; i < position.count; i++) {
        const y = position.getY(i);
        if (y < from || y >= to) continue;
        halfDepth = Math.max(halfDepth, Math.abs(position.getZ(i)));
        if (channelDistance(vertexColor(geometry, i), markColor) < 0.01) {
          lowestMarkedZ = Math.min(lowestMarkedZ, position.getZ(i));
        }
      }
      if (halfDepth <= 0 || lowestMarkedZ === Infinity) continue;
      boundaries.push({ y: (from + to) / 2, relativeZ: lowestMarkedZ / halfDepth, halfDepth });
    }

    expect(boundaries.length).toBeGreaterThanOrEqual(5);

    // The mark's lower edge should sit on the widest point of the body
    // (relative Z of 0) wherever the mark appears. Pre-fix this held at
    // mid-body but reached -0.50 at the peduncle — half-way down the belly
    // side — because the boundary was a fixed absolute height while the
    // body narrowed around it.
    for (const boundary of boundaries) {
      expect(
        boundary.relativeZ,
        `mark reaches relative Z ${boundary.relativeZ.toFixed(2)} at y=${boundary.y.toFixed(2)} (local half-depth ${boundary.halfDepth.toFixed(3)})`,
      ).toBeGreaterThan(-0.12);
    }

    // ...and the mark must genuinely still be present where the body is
    // narrow, or the loop above would pass vacuously on a mark that had
    // simply shrunk away from the tail.
    const narrowest = boundaries.reduce((a, b) => (b.halfDepth < a.halfDepth ? b : a));
    expect(narrowest.halfDepth).toBeLessThan(0.6);
  });
});
