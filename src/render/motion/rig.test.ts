import { describe, expect, it } from 'vitest';

import { findRigOrderingViolation, resolveDriveAngle, type RigPartDeclaration } from './rig';

function part(role: string, parent?: number): RigPartDeclaration {
  return {
    role,
    group: 'legs',
    pivot: [0, 0, 0],
    axis: [1, 0, 0],
    parent,
    drive: { source: 'legSwing' },
  };
}

describe('findRigOrderingViolation', () => {
  it('accepts a rig whose parents all precede their children', () => {
    expect(findRigOrderingViolation([part('hip'), part('knee', 0), part('hoof', 1)])).toBeNull();
  });

  it('accepts parts with no parent at all', () => {
    expect(findRigOrderingViolation([part('a'), part('b')])).toBeNull();
  });

  it('rejects a parent that comes after its child, which would compose stale ancestors', () => {
    expect(findRigOrderingViolation([part('knee', 1), part('hip')])).toMatch(/at or after its own index/);
  });

  it('rejects a part parented to itself', () => {
    expect(findRigOrderingViolation([part('loop', 0)])).toMatch(/at or after its own index/);
  });

  it('rejects an out-of-range parent index', () => {
    expect(findRigOrderingViolation([part('a'), part('b', 7)])).toMatch(/out-of-range/);
  });
});

describe('resolveDriveAngle', () => {
  it('passes the source angle through untouched by default', () => {
    expect(resolveDriveAngle({ drive: { source: 'legSwing' }, baseAngle: 0.4 })).toBeCloseTo(0.4);
  });

  it('scales the source angle so a child joint can move less than its parent', () => {
    const angle = resolveDriveAngle({
      drive: { source: 'legSwing', amplitudeScale: 0.5 },
      baseAngle: 0.4,
    });
    expect(angle).toBeCloseTo(0.2);
  });

  it('adds a rest offset that does not scale with the oscillation', () => {
    const drive = { source: 'legSwing' as const, amplitudeScale: 0.5, restOffsetRad: 0.1 };
    expect(resolveDriveAngle({ drive, baseAngle: 0.4 })).toBeCloseTo(0.3);
    // With the oscillator at rest the offset is all that remains, which is what
    // makes a rest pose independent of how hard the creature is working.
    expect(resolveDriveAngle({ drive, baseAngle: 0 })).toBeCloseTo(0.1);
  });
});
