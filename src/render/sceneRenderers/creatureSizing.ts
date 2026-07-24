/**
 * Per-scene creature sizing.
 *
 * Each scene declares a single base creature size (length + width in world
 * units) and expresses every one of its creatures as an explicit factor of
 * that base. This deliberately keeps sizes decoupled:
 *   - no creature's size is derived from another creature's size
 *     (e.g. a unicorn is NOT "0.8 of a dragon"), and
 *   - no scene's sizes are derived from another scene's
 *     (e.g. a fishtank shark is NOT tied to the nature dragon).
 * Changing one creature's factor — or a whole scene's base — never ripples
 * into any other creature or scene.
 */
export interface CreatureSize {
  /** Nose-to-tail length in world units. */
  length: number;
  /** Wingspan/girth in world units. */
  width: number;
}

type CreatureSizer = (lengthFactor: number, widthFactor?: number) => CreatureSize;

/**
 * Builds a sizer bound to a scene's base creature size. Call it with a
 * length factor (and an optional separate width factor — it defaults to the
 * length factor for uniformly-scaled creatures) to get an absolute size.
 */
export function createCreatureSizer(base: CreatureSize): CreatureSizer {
  return (lengthFactor, widthFactor = lengthFactor) => ({
    length: base.length * lengthFactor,
    width: base.width * widthFactor,
  });
}
