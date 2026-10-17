import { displayName, LAST_NAME_PLACEHOLDER } from './display-name';

describe('displayName', () => {
  it('joins first and last name', () => {
    expect(displayName({ firstName: 'Shiva', lastName: 'Bhusal' })).toBe(
      'Shiva Bhusal',
    );
  });

  it('never shows the missing-last-name placeholder', () => {
    expect(
      displayName({
        firstName: 'srollins175',
        lastName: LAST_NAME_PLACEHOLDER,
      }),
    ).toBe('srollins175');
  });

  it('falls back to the username, then the given fallback', () => {
    expect(
      displayName({ firstName: ' ', lastName: '', userName: 'sita' }),
    ).toBe('sita');
    expect(displayName({}, 'A teammate')).toBe('A teammate');
  });
});
