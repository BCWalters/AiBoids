import { describe, it, expect } from 'vitest';
import { createDragonGeometries } from '../styles/nature/geometry/dragonGeometry';
import { createSharkGeometries } from '../styles/fishtank/geometry/sharkGeometry';
import { createBarracudaGeometries } from '../styles/fishtank/geometry/barracudaGeometry';
import type { CreatureGeometries } from './sharedGeometry';

/**
 * Guards the invariant the tail-sway rig depends on: the declared pivot has to
 * be the point the tail is actually built from.
 *
 * This is worth pinning because getting it wrong is silent. A pivot that drifts
 * away from the geometry doesn't throw and doesn't change any colour, so no
 * smoke or screenshot test notices — the only symptom is the tail's root
 * sweeping an arc it shouldn't and poking out through the body at large sway
 * angles.
 *
 * The dragon had exactly that: it declared no pivot at all and fell back to the
 * model origin, a quarter of a body length from where its tail attaches.
 *
 * The shark is a subtler cautionary tale. It carried an elaborate pivot
 * apparatus — an exported fraction, a helper, and a paragraph explaining that
 * pivoting at the fin's root was what stopped the root sweeping out through the
 * body — and every bit of it was inert, because the fin sweeps about Y and the
 * pivot was offset only in Y. See the perpendicular-offset test below. Because
 * nothing downstream could observe the value, it drifted freely: it was being
 * computed from a fictional "reference length" of 4.0 rather than the shark's
 * real length of 36, and a later pass rationalised the mismatch as deliberate
 * tuning. Dead parameters don't stay correct; they stay unfalsifiable.
 */

const CREATURES: { name: string; geometries: CreatureGeometries }[] = [
  { name: 'dragon', geometries: createDragonGeometries(10, 4) },
  { name: 'shark', geometries: createSharkGeometries(36, 15.84) },
  { name: 'barracuda', geometries: createBarracudaGeometries(27, 9.6) },
];

describe('swaying tails pivot about their own root', () => {
  for (const { name, geometries } of CREATURES) {
    describe(name, () => {
      it('declares a tail rig', () => {
        expect(geometries.tail).toBeDefined();
        expect(geometries.tailRig).toBeDefined();
      });

      it('pivots at a point the tail geometry actually reaches', () => {
        const tail = geometries.tail!;
        const pivot = geometries.tailRig!.pivot;
        tail.computeBoundingBox();
        const box = tail.boundingBox!;

        // The pivot is the attachment point, so it must lie within the tail's
        // own extent (with a small tolerance for the root vertex sitting
        // exactly on the boundary) rather than somewhere off in the body.
        const span = box.max.y - box.min.y;
        const tolerance = span * 0.05;
        expect(pivot[1]).toBeGreaterThanOrEqual(box.min.y - tolerance);
        expect(pivot[1]).toBeLessThanOrEqual(box.max.y + tolerance);
      });

      it('pivots nearer the tail root than the model origin', () => {
        const pivot = geometries.tailRig!.pivot;
        const tail = geometries.tail!;
        tail.computeBoundingBox();
        const box = tail.boundingBox!;

        // Tails extend rearward along -Y, so the root is the *most positive* Y
        // the tail reaches. Pivoting at the origin instead is the failure mode
        // this whole change exists to remove: it drags the root sideways
        // through the body. Assert the pivot is closer to the root than to the
        // origin, which fails loudly if a pivot silently falls back to 0.
        const rootY = box.max.y;
        expect(Math.abs(pivot[1] - rootY)).toBeLessThan(Math.abs(pivot[1]));
      });

      it('has a pivot offset perpendicular to its own sway axis', () => {
        // A pivot only does anything in the components perpendicular to the
        // rotation axis: translating *along* the axis commutes with the
        // rotation, so that component cancels out exactly. The fish tails fail
        // this — they sweep about Y and are offset only in Y, making their
        // pivots precise no-ops. That is why the shark's long-documented
        // "pivot fix" never actually did anything, and why feeding it a
        // fictional reference length went unnoticed for so long. Asserted per
        // creature rather than globally so the fact stays on the record: if
        // someone gives a fish tail an off-axis sweep, this flips and they
        // find out the pivot has started mattering.
        const [ax, ay, az] = geometries.tailRig!.axis;
        const [px, py, pz] = geometries.tailRig!.pivot;
        const alongAxis = px * ax + py * ay + pz * az;
        const perpendicular = Math.hypot(
          px - alongAxis * ax,
          py - alongAxis * ay,
          pz - alongAxis * az,
        );
        expect(perpendicular > 1e-6).toBe(name === 'dragon');
      });

      it('rotates about a unit-length axis', () => {
        const [x, y, z] = geometries.tailRig!.axis;
        expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
      });
    });
  }

  it('sweeps fish tails side-to-side and the dragon tail up-and-down', () => {
    // Not interchangeable: a caudal fin is built as a vertical blade that
    // sweeps horizontally, while a dragon's whip tail sweeps vertically.
    // Swapping the axes would make each one scythe through its own body.
    const [shark, barracuda, dragon] = [
      createSharkGeometries(36, 15.84).tailRig!.axis,
      createBarracudaGeometries(27, 9.6).tailRig!.axis,
      createDragonGeometries(10, 4).tailRig!.axis,
    ];
    expect(shark).toEqual([0, 1, 0]);
    expect(barracuda).toEqual([0, 1, 0]);
    expect(dragon).toEqual([1, 0, 0]);
  });
});
