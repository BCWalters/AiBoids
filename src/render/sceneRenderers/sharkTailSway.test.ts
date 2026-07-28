import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createSharkGeometries } from '../styles/fishtank/geometry/sharkGeometry';
import { createBarracudaGeometries } from '../styles/fishtank/geometry/barracudaGeometry';
import {
  FISHTANK_CREATURE_SIZES,
  SHARK_TAIL_SWAY_AMPLITUDE,
  BARRACUDA_TAIL_SWAY_AMPLITUDE,
  FISHTANK_SHARK_UNDULATION,
  FISHTANK_BARRACUDA_UNDULATION,
} from './FishtankSceneRenderer3D';

/**
 * The caudal fins of the two fishtank predators must YAW — swing side to side
 * as a rigid unit about the dorsoventral axis — never ROLL about the spine.
 *
 * A roll drives the fin's upper and lower lobes in opposite lateral
 * directions, so the fin traces an X instead of a beat. That is what the rig
 * actually did (`axis: [0, 1, 0]`, the spine) despite both call sites
 * documenting it as a side-to-side sweep about MODEL_UP. On the shark, whose
 * tail is heterocercal, the upper lobe swung 2.3x further than the lower and
 * the scissor was glaring next to the #219 body undulation.
 *
 * These assertions are geometric, not a restatement of the constants: they
 * rotate the shipped fin vertices by the shipped angle about the shipped axis
 * and measure where they land. Reverting either the axis or the amplitude
 * fails them.
 *
 * Units are model space (the geometry as authored). The renderer applies a
 * uniform per-species mesh boost on top, which scales every quantity here
 * equally and so cannot affect the ratios.
 */

const MODEL_UP = new THREE.Vector3(0, 0, 1);

interface FinSample {
  /** Lateral (X) displacement of the fin's highest vertex at peak sway. */
  topLobeDx: number;
  /** Lateral (X) displacement of the fin's lowest vertex at peak sway. */
  bottomLobeDx: number;
  /** Lateral displacement of the rearmost (trailing tip) vertex. */
  tipDx: number;
  /** Worst displacement among vertices at the fin's root, where it welds to
   *  the body. #219 has the fin share the body's undulation uniforms, which
   *  is only sound while the fin's matrix stays close to the body's. */
  worstRootSeamError: number;
  /** Peak lateral amplitude of the body undulation wave, in the same units. */
  undulationAmplitude: number;
}

function sampleFin({
  geometries,
  amplitude,
  undulationAmplitudeFraction,
}: {
  geometries: ReturnType<typeof createSharkGeometries>;
  amplitude: number;
  undulationAmplitudeFraction: number;
}): FinSample {
  const tail = geometries.tail;
  const rig = geometries.tailRig;
  if (!tail || !rig) throw new Error('expected a caudal fin with a sway rig');

  const body = geometries.body;
  body.computeBoundingBox();
  const bodySpan = body.boundingBox!.max.y - body.boundingBox!.min.y;

  tail.computeBoundingBox();
  const finBox = tail.boundingBox!.clone();
  const pivot = new THREE.Vector3(rig.pivot[0], rig.pivot[1], rig.pivot[2]);
  const axis = new THREE.Vector3(rig.axis[0], rig.axis[1], rig.axis[2]).normalize();

  const sway = new THREE.Matrix4()
    .makeTranslation(pivot.x, pivot.y, pivot.z)
    .multiply(new THREE.Matrix4().makeRotationAxis(axis, amplitude))
    .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));

  const position = tail.getAttribute('position');
  const vertexAt = (i: number) =>
    new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i));

  let topIndex = 0;
  let bottomIndex = 0;
  let tipIndex = 0;
  for (let i = 0; i < position.count; i++) {
    if (position.getZ(i) > position.getZ(topIndex)) topIndex = i;
    if (position.getZ(i) < position.getZ(bottomIndex)) bottomIndex = i;
    // The fin trails behind the body, so -Y is the trailing tip.
    if (position.getY(i) < position.getY(tipIndex)) tipIndex = i;
  }

  const lateralShift = (i: number) => {
    const rest = vertexAt(i);
    return rest.clone().applyMatrix4(sway).x - rest.x;
  };

  // Root band: the forward 5% of the fin, the part buried in the peduncle.
  const rootBand = (finBox.max.y - finBox.min.y) * 0.05;
  let worstRootSeamError = 0;
  for (let i = 0; i < position.count; i++) {
    if (position.getY(i) < finBox.max.y - rootBand) continue;
    const rest = vertexAt(i);
    worstRootSeamError = Math.max(
      worstRootSeamError,
      rest.clone().applyMatrix4(sway).distanceTo(rest),
    );
  }

  return {
    topLobeDx: lateralShift(topIndex),
    bottomLobeDx: lateralShift(bottomIndex),
    tipDx: lateralShift(tipIndex),
    worstRootSeamError,
    undulationAmplitude: undulationAmplitudeFraction * bodySpan,
  };
}

const shark = () =>
  sampleFin({
    geometries: createSharkGeometries(
      FISHTANK_CREATURE_SIZES.shark.length,
      FISHTANK_CREATURE_SIZES.shark.width,
    ),
    amplitude: SHARK_TAIL_SWAY_AMPLITUDE,
    undulationAmplitudeFraction: FISHTANK_SHARK_UNDULATION.amplitudeFraction,
  });

const barracuda = () =>
  sampleFin({
    geometries: createBarracudaGeometries(
      FISHTANK_CREATURE_SIZES.barracuda.length,
      FISHTANK_CREATURE_SIZES.barracuda.width,
    ),
    amplitude: BARRACUDA_TAIL_SWAY_AMPLITUDE,
    undulationAmplitudeFraction: FISHTANK_BARRACUDA_UNDULATION.amplitudeFraction,
  });

describe('caudal fin sway axis', () => {
  it('hinges both predators about the dorsoventral axis, not the spine', () => {
    for (const geometries of [
      createSharkGeometries(
        FISHTANK_CREATURE_SIZES.shark.length,
        FISHTANK_CREATURE_SIZES.shark.width,
      ),
      createBarracudaGeometries(
        FISHTANK_CREATURE_SIZES.barracuda.length,
        FISHTANK_CREATURE_SIZES.barracuda.width,
      ),
    ]) {
      const axis = new THREE.Vector3(...geometries.tailRig!.axis).normalize();
      // Parallel to MODEL_UP, and in particular no component along the spine.
      expect(Math.abs(axis.dot(MODEL_UP))).toBeCloseTo(1, 6);
      expect(Math.abs(axis.y)).toBeLessThan(1e-6);
    }
  });

  it.each([
    ['shark', shark],
    ['barracuda', barracuda],
  ])('swings the whole %s fin the same way — no X-pattern scissor', (_name, sample) => {
    const { topLobeDx, bottomLobeDx } = sample();
    // Both lobes must move the same way. A spine roll makes this product
    // negative, which is precisely the X the fix removes.
    expect(topLobeDx * bottomLobeDx).toBeGreaterThan(0);
    // And by comparable amounts — a fin swinging as a rigid unit cannot have
    // one lobe travelling in a wildly different arc from the other.
    const ratio =
      Math.abs(topLobeDx) > Math.abs(bottomLobeDx)
        ? Math.abs(topLobeDx / bottomLobeDx)
        : Math.abs(bottomLobeDx / topLobeDx);
    expect(ratio).toBeLessThan(2);
  });

  it('keeps the shark beat small enough that body undulation still leads', () => {
    const { tipDx, undulationAmplitude } = shark();
    // Absolute anchor: the shark's fin tip must not sweep more than ~1 model
    // unit. It swept 7.16 before the fix; it sweeps 0.65 now.
    expect(Math.abs(tipDx)).toBeLessThan(1.2);
    // And relative: the tail must stay quieter than the wave it terminates.
    expect(Math.abs(tipDx)).toBeLessThan(undulationAmplitude);
  });

  it('preserves the barracuda beat that was signed off', () => {
    const { tipDx } = barracuda();
    // The old spine roll swept the lobes 1.45u; the corrected yaw is tuned to
    // land in the same place so the approved look survives the axis change.
    expect(Math.abs(tipDx)).toBeGreaterThan(1.1);
    expect(Math.abs(tipDx)).toBeLessThan(1.9);
  });

  it.each([
    ['shark', shark],
    ['barracuda', barracuda],
  ])('holds the %s fin root close enough to share the body undulation', (_name, sample) => {
    // #219 evaluates the fin's wave in the BODY's frame, so any rotation of
    // the fin's instance matrix shows up as a seam at the weld. The old
    // 0.5 rad roll displaced shark root vertices by 0.235u.
    expect(sample().worstRootSeamError).toBeLessThan(0.06);
  });
});
