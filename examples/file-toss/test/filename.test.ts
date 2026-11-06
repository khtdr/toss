import { describe, expect, it } from 'vitest';
import { kindToName, nameToKind, safeMime, sanitizeFilename } from '../src/lib/filename';

describe('sanitizeFilename', () => {
  it.each([
    ['holiday.jpg', 'holiday.jpg'],
    ['résumé 2026.pdf', 'résumé 2026.pdf'],
    ['写真.png', '写真.png'],
    ['../../etc/passwd', 'passwd'],
    ['..\\..\\windows\\system.ini', 'system.ini'],
    ['/data/data/app/secret', 'secret'],
    ['.hidden', 'hidden'],
    ['...', 'file'],
    ['..', 'file'],
    ['', 'file'],
    ['   ', 'file'],
    ['trailing. . ', 'trailing'],
    ['nul\u0000byte.txt', 'nulbyte.txt'],
    ['line\nbreak.txt', 'linebreak.txt'],
    ['what?.txt', 'what.txt'],
    ['a:b.txt', 'ab.txt'],
    ['invoice‮fdp.exe', 'invoicefdp.exe'],
    ['bad\ud800.txt', 'bad.txt'],
  ])('turns %j into %j', (raw, safe) => {
    expect(sanitizeFilename(raw)).toBe(safe);
  });

  it('shortens a long name and keeps its extension', () => {
    const name = sanitizeFilename(`${'x'.repeat(500)}.pdf`);
    expect(Array.from(name)).toHaveLength(120);
    expect(name.endsWith('.pdf')).toBe(true);
  });

  it("doesn't split a character when shortening", () => {
    const name = sanitizeFilename(`${'😀'.repeat(500)}.png`);
    expect(name).toBe(`${'😀'.repeat(116)}.png`);
  });

  it('treats a long tail after a dot as part of the name', () => {
    const name = sanitizeFilename(`a.${'b'.repeat(500)}`);
    expect(Array.from(name)).toHaveLength(120);
  });
});

describe('kind', () => {
  it.each(['report.pdf', 'résumé 2026.pdf', '写真 (1).png', '100% done.txt'])('carries %j', (name) => {
    expect(kindToName(nameToKind(name))).toBe(name);
  });

  it('is short printable ASCII, as the protocol requires', () => {
    for (const name of ['a.txt', '写'.repeat(500) + '.png', '😀'.repeat(500), 'x'.repeat(5000)]) {
      const kind = nameToKind(name);
      expect(kind.length).toBeLessThanOrEqual(255);
      expect(kind).toMatch(/^[\x20-\x7e]+$/);
      expect(kindToName(kind)).not.toBe('');
    }
  });

  it('keeps the extension of a long name', () => {
    expect(kindToName(nameToKind(`${'写'.repeat(500)}.png`)).endsWith('.png')).toBe(true);
  });

  it('gives the same kind every time, or a resumed transfer would be a new session', () => {
    expect(nameToKind('résumé.pdf')).toBe(nameToKind('résumé.pdf'));
  });

  it.each([
    ['theme', 'file'],
    ['', 'file'],
    ['file-toss/1:', 'file'],
    ['file-toss/1:%E0%A4%A', 'file'],
    ['file-toss/1:..%2F..%2Fsecret', 'secret'],
    ['file-toss/1:%00evil.txt', 'evil.txt'],
  ])('reads the hostile kind %j safely', (kind, name) => {
    expect(kindToName(kind)).toBe(name);
  });
});

describe('safeMime', () => {
  it.each([
    ['image/png', 'image/png'],
    ['APPLICATION/PDF', 'application/pdf'],
    ['application/vnd.ms-excel', 'application/vnd.ms-excel'],
    ['application/vnd.android.package-archive', 'application/octet-stream'],
    ['text/plain; charset=utf-8', 'application/octet-stream'],
    ['nonsense', 'application/octet-stream'],
    ['', 'application/octet-stream'],
    [null, 'application/octet-stream'],
    [undefined, 'application/octet-stream'],
  ])('turns %j into %j', (mime, safe) => {
    expect(safeMime(mime)).toBe(safe);
  });
});
