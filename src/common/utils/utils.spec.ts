import { diffChanges } from './diff';
import { dayBounds, escapeRegex } from './query';

describe('dayBounds', () => {
  it("computes 'today' in the client's timezone", () => {
    // 2026-10-08 20:00 UTC is already 2026-10-09 01:45 in Nepal (UTC+5:45, offset -345).
    const now = new Date('2026-10-08T20:00:00.000Z');
    expect(dayBounds(0, now)).toEqual({
      start: new Date('2026-10-08T00:00:00.000Z'),
      end: new Date('2026-10-09T00:00:00.000Z'),
    });
    expect(dayBounds(-345, now)).toEqual({
      start: new Date('2026-10-08T18:15:00.000Z'),
      end: new Date('2026-10-09T18:15:00.000Z'),
    });
  });
});

describe('escapeRegex', () => {
  it('treats user input literally', () => {
    expect(new RegExp(escapeRegex('a.*(b')).test('a.*(b')).toBe(true);
    expect(new RegExp(escapeRegex('a.*(b')).test('axxxb')).toBe(false);
  });
});

describe('diffChanges', () => {
  it('reports only fields that actually changed', () => {
    const before = {
      status: 'TODO',
      title: 'A',
      dueDate: new Date('2026-01-01'),
      labels: ['b', 'a'],
    };
    expect(
      diffChanges(before, {
        status: 'DONE',
        title: 'A',
        dueDate: new Date('2026-01-01'),
        labels: ['a', 'b'],
      }),
    ).toEqual({ status: { from: 'TODO', to: 'DONE' } });
  });
});
