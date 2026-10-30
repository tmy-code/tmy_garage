import { describe, expect, it } from 'vitest';
import { KNOWN_MAKES, makeLogo } from './brands.tsx';

describe('makeLogo', () => {
  it('matches the make however it is typed', () => {
    expect(makeLogo('Renault')?.slug).toBe('renault');
    expect(makeLogo('  CITROËN ')?.slug).toBe('citroen');
    expect(makeLogo('Citroen DS')?.slug).toBe('citroen');
    expect(makeLogo('DS Automobiles')?.slug).toBe('dsautomobiles');
    expect(makeLogo('VW')?.slug).toBe('volkswagen');
    expect(makeLogo('Yamaha')?.slug).toBe('yamahamotorcorporation');
  });

  it('has no logo for an unknown or missing make', () => {
    expect(makeLogo('Marque Exemple')).toBeNull();
    expect(makeLogo('')).toBeNull();
    expect(makeLogo(null)).toBeNull();
  });

  it('suggests makes by their plain names', () => {
    expect(KNOWN_MAKES).toContain('Yamaha');
    expect(KNOWN_MAKES).toContain('Piaggio');
    expect(KNOWN_MAKES).toContain('Citroën');
  });
});
