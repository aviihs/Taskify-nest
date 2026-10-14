import { directKeyOf, normalizeMessageBody } from './chat.service';

describe('normalizeMessageBody', () => {
  it('trims and keeps newlines and tabs', () => {
    expect(normalizeMessageBody('  hi\n\tthere  ')).toBe('hi\n\tthere');
  });

  it('normalizes line endings and drops control characters', () => {
    expect(normalizeMessageBody('a\r\nb\rc\u0000\u0007d')).toBe('a\nb\ncd');
  });

  it('caps runs of blank lines', () => {
    expect(normalizeMessageBody('a\n\n\n\n\n\nb')).toBe('a\n\n\nb');
  });

  it('leaves markup as literal text', () => {
    expect(normalizeMessageBody('<b>bold</b>')).toBe('<b>bold</b>');
  });

  it('reduces whitespace-only input to empty', () => {
    expect(normalizeMessageBody(' \n\t\u0000 ')).toBe('');
  });
});

describe('directKeyOf', () => {
  it('is the same whichever participant opens the conversation', () => {
    expect(directKeyOf('w', 'b', 'a')).toBe(directKeyOf('w', 'a', 'b'));
    expect(directKeyOf('w', 'a', 'b')).toBe('w:a:b');
  });
});
