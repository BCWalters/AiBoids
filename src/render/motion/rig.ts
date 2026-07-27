/**
 * Declarative description of a creature's articulated parts.
 *
 * The problem this solves: a joint's pivot is a property of the *geometry* —
 * it's measured in whatever model units that creature's builder chose. But
 * until now the animation parameters lived in each scene's MotionConfig, which
 * has no way to know those units. A pivot configured at the scene level is a
 * number someone has to guess, and a wrong guess detaches the limb from the
 * body rather than degrading gracefully. (#195 hit exactly this and had to fall
 * back on inferring the hip from the legs' bounding box.)
 *
 * So structure is declared here, next to the code that *places* the joint, and
 * scenes keep only the tuning they legitimately own — how fast and how hard to
 * drive each oscillator. A creature's rig travels with its geometry; a scene
 * says "flap at 6Hz", not "the knee is at z=-0.34".
 *
 * Pivots and axes are plain numeric triples rather than THREE.Vector3 so rig
 * declarations stay comparable, serialisable and unit-testable without pulling
 * in a renderer.
 */

/** Coarse bucket used by the colour applicators, which tint whole limbs. */
export type PartGroup = 'body' | 'wings' | 'tail' | 'legs' | 'beak';

/**
 * Which oscillator drives a part.
 *
 * 'static' parts are posed with the plain body transform — the same treatment
 * the beak gets today — so a part can be declared before it's animated.
 */
export type PartDriveSource = 'flap' | 'tailSway' | 'legSwing' | 'static';

export interface PartDrive {
  source: PartDriveSource;
  /**
   * Scales the angle the source produces. Lets a child joint move less than its
   * parent (a knee folds through a smaller arc than the hip it hangs from)
   * without inventing a second set of scene-level amplitudes.
   */
  amplitudeScale?: number;
  /**
   * Radians added at rest, before any oscillation. Used for pose offsets that
   * shouldn't scale with how hard the creature is working.
   */
  restOffsetRad?: number;
  /**
   * Shifts this part in the cycle. A child joint reads as jointed rather than
   * rigid mainly because it lags its parent, so this is the field that sells
   * a limb as having a real knee in it.
   */
  phaseOffsetRad?: number;
  /** Multiplies the source frequency, for parts that beat faster than the body. */
  frequencyScale?: number;
}

/** Model-space vector as a plain triple, to keep this module renderer-free. */
export type Triple = readonly [number, number, number];

/**
 * One articulated part, before it's been turned into an InstancedMesh.
 *
 * `parent` indexes into the same array and must refer to an *earlier* entry, so
 * a single forward pass can compose each part after its ancestors. Chains are
 * expected to be short (hip → knee → hoof).
 */
export interface RigPartDeclaration {
  /** Stable identifier for this specific part, e.g. 'legLowerFront'. */
  role: string;
  group: PartGroup;
  /** Model-space point the part rotates about. */
  pivot: Triple;
  /** Model-space rotation axis; should be unit length. */
  axis: Triple;
  /** Index of the parent part within the same array, or undefined if it hangs
   * directly off the body. Must be less than this part's own index. */
  parent?: number;
  drive: PartDrive;
}

/**
 * Validates the ordering invariant the posing pass depends on: every parent
 * reference points at an earlier entry, so ancestors are always composed first
 * and no cycle is possible. Exported for tests and for builders to assert
 * against as they're written.
 */
export function findRigOrderingViolation(parts: readonly RigPartDeclaration[]): string | null {
  for (let i = 0; i < parts.length; i += 1) {
    const { parent, role } = parts[i];
    if (parent === undefined) continue;
    if (!Number.isInteger(parent)) return `part '${role}' has a non-integer parent index`;
    if (parent < 0 || parent >= parts.length) return `part '${role}' has an out-of-range parent index ${parent}`;
    if (parent >= i) return `part '${role}' references parent ${parent} at or after its own index ${i}`;
  }
  return null;
}

/** Resolved drive parameters for one part on one frame. */
export function resolveDriveAngle({
  drive,
  baseAngle,
}: {
  drive: PartDrive;
  /** Angle the part's source oscillator produced for this creature this frame. */
  baseAngle: number;
}): number {
  return baseAngle * (drive.amplitudeScale ?? 1) + (drive.restOffsetRad ?? 0);
}
