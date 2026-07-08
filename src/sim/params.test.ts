import { describe, it, expect, afterEach } from 'vitest';
import { params, defaultParams, resetParams } from './params';

describe('params', () => {
  afterEach(() => {
    resetParams();
  });

  it('params starts out equal to defaultParams', () => {
    expect(params).toEqual(defaultParams);
  });

  it('resetParams restores every field after mutation', () => {
    params.boidCount = 9999;
    params.mode = '2d';
    params.visualStyle = 'arcade';
    resetParams();
    expect(params).toEqual(defaultParams);
  });

  it('resetParams mutates the shared object in place rather than replacing it', () => {
    const ref = params;
    params.boidCount = 1;
    resetParams();
    expect(params).toBe(ref);
  });
});
