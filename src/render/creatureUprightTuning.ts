import * as THREE from 'three';
import type { MotionConfig } from './sceneRenderers/createSceneRendererHooks';

export type UprightStyle = NonNullable<MotionConfig['uprightStyle']>;

const UPRIGHT_HEADING_SMOOTHING_RATE: Record<UprightStyle, number> = {
  dragon: 6,
  unicorn: 5,
  shark: 14,
};

const UPRIGHT_MAX_TURN_RADIANS_PER_SEC: Record<UprightStyle, number> = {
  dragon: THREE.MathUtils.degToRad(720),
  unicorn: THREE.MathUtils.degToRad(540),
  shark: THREE.MathUtils.degToRad(1080),
};

const UPRIGHT_MAX_UP_TILT_RADIANS: Record<Exclude<UprightStyle, 'dragon'>, number> = {
  unicorn: THREE.MathUtils.degToRad(30),
  shark: THREE.MathUtils.degToRad(30),
};

const UPRIGHT_PITCH_LIMITS: Record<Exclude<UprightStyle, 'dragon'>, { ascend: number; descend: number }> = {
  unicorn: {
    ascend: 0,
    descend: THREE.MathUtils.degToRad(10),
  },
  shark: {
    ascend: THREE.MathUtils.degToRad(15),
    descend: THREE.MathUtils.degToRad(15),
  },
};

const UPRIGHT_CLIMB_FLAP_BOOST: Record<Exclude<UprightStyle, 'dragon'>, { climbBoost: number; descendCut: number }> = {
  unicorn: {
    climbBoost: 0.9,
    descendCut: 0.55,
  },
  shark: {
    climbBoost: 0,
    descendCut: 0,
  },
};

export function getUprightHeadingSmoothingRate(style: UprightStyle): number {
  return UPRIGHT_HEADING_SMOOTHING_RATE[style];
}

export function getUprightTurnRate(style: UprightStyle): number {
  return UPRIGHT_MAX_TURN_RADIANS_PER_SEC[style];
}

export function getUprightMaxUpTilt(style: UprightStyle): number | null {
  if (style === 'dragon') return null;
  return UPRIGHT_MAX_UP_TILT_RADIANS[style];
}

export function getUprightPitchLimits(
  style: UprightStyle,
): { ascend: number; descend: number } | null {
  if (style === 'dragon') return null;
  return UPRIGHT_PITCH_LIMITS[style];
}

export function getUprightFlapFrequencyMultiplier(
  style: UprightStyle,
  climbFraction: number,
): number {
  if (style === 'dragon') return 1;
  const tuning = UPRIGHT_CLIMB_FLAP_BOOST[style];
  if (tuning.climbBoost === 0 && tuning.descendCut === 0) return 1;
  if (climbFraction >= 0) {
    return 1 + tuning.climbBoost * climbFraction;
  }
  return 1 - tuning.descendCut * -climbFraction;
}

export function isClampedUprightStyle(style: UprightStyle): boolean {
  return style !== 'dragon';
}

export function usesTailSwayMatrix(style: UprightStyle): boolean {
  return style === 'dragon' || style === 'shark';
}
