import { diffChanges } from './diff';
import {
  dayBounds,
  escapeRegex,
  localDateKey,
  mongoTimezone,
  weekStart,
} from './query';

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

describe('weekStart', () => {
  it('is Monday 00:00 in the client timezone', () => {
    // Wednesday 2026-10-14 10:00 UTC.
    const now = new Date('2026-10-14T10:00:00Z');
    expect(weekStart(0, now)).toEqual(new Date('2026-10-12T00:00:00Z'));
    // Nepal (UTC+5:45): local Monday midnight is Sunday 18:15 UTC.
    expect(weekStart(-345, now)).toEqual(new Date('2026-10-11T18:15:00Z'));
  });

  it('treats Monday itself and Sunday night correctly', () => {
    expect(weekStart(0, new Date('2026-10-12T00:00:00Z'))).toEqual(
      new Date('2026-10-12T00:00:00Z'),
    );
    expect(weekStart(0, new Date('2026-10-18T23:59:00Z'))).toEqual(
      new Date('2026-10-12T00:00:00Z'),
    );
  });
});

describe('mongoTimezone', () => {
  it('turns getTimezoneOffset minutes into an ±HH:MM offset', () => {
    expect(mongoTimezone(-345)).toBe('+05:45');
    expect(mongoTimezone(300)).toBe('-05:00');
    expect(mongoTimezone(0)).toBe('+00:00');
  });
});

describe('localDateKey', () => {
  it('uses the client calendar day', () => {
    const instant = new Date('2026-10-14T20:00:00Z');
    expect(localDateKey(instant, 0)).toBe('2026-10-14');
    expect(localDateKey(instant, -345)).toBe('2026-10-15'); // 01:45 in Nepal
  });
});
