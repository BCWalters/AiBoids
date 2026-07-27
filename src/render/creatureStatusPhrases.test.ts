import { describe, expect, it } from 'vitest';
import {
  CREATURE_STATUS_PHRASES,
  CYCLE_MS,
  pickStatusPhrase,
  type CreatureStatusCategory,
} from './creatureStatusPhrases';

const CATEGORIES: CreatureStatusCategory[] = [
  'flocking',
  'fleeing',
  'searching',
  'hunting',
  'digesting',
];

describe('pickStatusPhrase', () => {
  it('returns a phrase from the selected category list', () => {
    for (const category of CATEGORIES) {
      expect(CREATURE_STATUS_PHRASES[category]).toContain(pickStatusPhrase(category, 7, 0));
    }
  });

  it('is stable within the same cycle window', () => {
    expect(pickStatusPhrase('searching', 3, 1)).toBe(pickStatusPhrase('searching', 3, CYCLE_MS - 1));
  });

  it('advances to the next phrase when the cycle window advances', () => {
    const phrases = CREATURE_STATUS_PHRASES.hunting;
    expect(pickStatusPhrase('hunting', 4, 0)).toBe(phrases[4]);
    expect(pickStatusPhrase('hunting', 4, CYCLE_MS)).toBe(phrases[5]);
  });

  it('wraps indices with non-negative modulo', () => {
    const phrases = CREATURE_STATUS_PHRASES.digesting;
    expect(pickStatusPhrase('digesting', 0, -CYCLE_MS)).toBe(phrases[phrases.length - 1]);
    expect(pickStatusPhrase('digesting', phrases.length - 1, CYCLE_MS)).toBe(phrases[0]);
  });

  it('can vary phrases between entities at the same time', () => {
    expect(pickStatusPhrase('flocking', 0, 0)).not.toBe(pickStatusPhrase('flocking', 1, 0));
  });
});
