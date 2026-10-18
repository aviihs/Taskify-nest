import { isAtLeastAge } from './min-age';

describe('isAtLeastAge', () => {
  const now = new Date('2026-10-18T10:00:00Z');

  it('accepts someone who turned 10 today', () => {
    expect(isAtLeastAge('2016-10-18', 10, now)).toBe(true);
  });

  it('rejects someone who turns 10 tomorrow', () => {
    expect(isAtLeastAge('2016-10-19', 10, now)).toBe(false);
  });

  it('accepts adults and rejects future dates', () => {
    expect(isAtLeastAge('1998-03-02', 10, now)).toBe(true);
    expect(isAtLeastAge('2030-01-01', 10, now)).toBe(false);
  });

  it('rejects values that are not dates', () => {
    expect(isAtLeastAge('not-a-date', 10, now)).toBe(false);
    expect(isAtLeastAge(undefined, 10, now)).toBe(false);
  });
});
