import { describe, expect, it } from 'vitest';
import { isSafeArchivePath } from './schemas.ts';
import { extensionOf, joinArchivePath, pathParts, sanitizeFileName, suggestFileName, uniqueFileName, withExtension } from './archive-name.ts';

describe('suggestFileName', () => {
  it('uses the date and the title without spaces', () => {
    expect(suggestFileName('2026-03-14', 'kit chaîne', 'pdf')).toBe('2026-03-14_KitChaîne.pdf');
  });
  it('falls back on a generic label with no title', () => {
    expect(suggestFileName('2026-03-14', null, 'jpg')).toBe('2026-03-14_Facture.jpg');
  });
  it('drops characters Windows refuses', () => {
    expect(suggestFileName('2026-03-14', 'a/b: c?', 'pdf')).not.toMatch(/[/:?]/);
  });
});

describe('sanitizeFileName and withExtension', () => {
  it('removes path characters and trailing dots', () => {
    expect(sanitizeFileName('  a\\b/c.  ')).toBe('a-b-c');
  });
  it('keeps the right extension on an edited name', () => {
    expect(withExtension('2026-03-14_Kit.pdf', 'pdf')).toBe('2026-03-14_Kit.pdf');
    expect(withExtension('2026-03-14_Kit', 'jpg')).toBe('2026-03-14_Kit.jpg');
    expect(withExtension('', 'pdf')).toBe('facture.pdf');
  });
});

describe('extensionOf', () => {
  it('reads the file name, then the content type', () => {
    expect(extensionOf('Scan.PDF', 'application/pdf')).toBe('pdf');
    expect(extensionOf('photo', 'image/jpeg')).toBe('jpg');
    expect(extensionOf('doc', 'application/pdf')).toBe('pdf');
  });
});

describe('uniqueFileName', () => {
  it('keeps a free name', () => {
    expect(uniqueFileName('a.pdf', ['b.pdf'])).toBe('a.pdf');
  });
  it('adds -2, then -3, ignoring case', () => {
    expect(uniqueFileName('a.pdf', ['A.PDF'])).toBe('a-2.pdf');
    expect(uniqueFileName('a.pdf', ['a.pdf', 'a-2.pdf'])).toBe('a-3.pdf');
  });
});

describe('paths', () => {
  it('splits and joins with forward slashes', () => {
    expect(pathParts('31 Véhicules\\31.02 CB650R')).toEqual(['31 Véhicules', '31.02 CB650R']);
    expect(joinArchivePath('31 Véhicules\\31.02 CB650R', 'Entretien', 'a.pdf')).toBe('31 Véhicules/31.02 CB650R/Entretien/a.pdf');
  });
  it('accepts relative folders only', () => {
    expect(isSafeArchivePath('31 Véhicules\\31.02 CB650R')).toBe(true);
    expect(isSafeArchivePath('31 Véhicules/31.02 CB650R')).toBe(true);
    expect(isSafeArchivePath('..\\x')).toBe(false);
    expect(isSafeArchivePath('a/../b')).toBe(false);
    expect(isSafeArchivePath('C:\\Users\\x')).toBe(false);
    expect(isSafeArchivePath('/abs')).toBe(false);
    expect(isSafeArchivePath('')).toBe(false);
    expect(isSafeArchivePath('a//b')).toBe(false);
  });
});
