import { describe, expect, it } from 'vitest';
import { axisLabel, niceTicks } from './charts';

describe('chart axes', () => {
  it('steps by 1, 2, 2.5 or 5 times a power of ten, up to at least the top value', () => {
    expect(niceTicks(184_250)).toEqual([0, 50_000, 100_000, 150_000, 200_000]);
    expect(niceTicks(8_240)).toEqual([0, 2_500, 5_000, 7_500, 10_000]);
    expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(0.35)).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
  });

  it('has a scale with nothing to show', () => {
    expect(niceTicks(0)).toEqual([0, 1]);
  });

  it('labels in full under 10,000 and compactly above', () => {
    expect(axisLabel(7_500, 10_000 - 1)).toBe('7,500');
    expect(axisLabel(50_000, 200_000)).toBe('50K');
    expect(axisLabel(1_250_000, 2_000_000)).toBe('1.25M');
  });
});
