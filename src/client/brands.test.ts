import { describe, expect, it } from 'vitest';
import { KNOWN_MAKES, makeAsName, makeLogo } from './brands.tsx';

describe('makeLogo', () => {
  it('matches the make however it is typed', () => {
    expect(makeLogo('Renault')?.slug).toBe('renault');
    expect(makeLogo('  CITROËN ')?.slug).toBe('citroen');
    expect(makeLogo('Citroen DS')?.slug).toBe('citroen');
    expect(makeLogo('DS Automobiles')?.slug).toBe('dsautomobiles');
    expect(makeLogo('VW')?.slug).toBe('volkswagen');
  });

  it('has no logo for an unknown or missing make', () => {
    expect(makeLogo('Marque Exemple')).toBeNull();
    expect(makeLogo('')).toBeNull();
    expect(makeLogo(null)).toBeNull();
  });
});

describe('makeAsName', () => {
  it('writes a motorbike make in capitals', () => {
    expect(makeAsName({ kind: 'motorcycle', make: ' Honda ' })).toBe('HONDA');
    expect(makeAsName({ kind: 'motorcycle', make: 'Royal Enfield' })).toBe('ROYAL ENFIELD');
  });

  it('leaves cars, and motorbikes without a make, to the logo or icon', () => {
    expect(makeAsName({ kind: 'car', make: 'Honda' })).toBeNull();
    expect(makeAsName({ kind: 'motorcycle', make: '  ' })).toBeNull();
    expect(makeAsName({ kind: 'motorcycle', make: null })).toBeNull();
  });
});

describe('KNOWN_MAKES', () => {
  it('suggests car and motorbike makes by their plain names, once each', () => {
    expect(KNOWN_MAKES).toContain('Yamaha');
    expect(KNOWN_MAKES).toContain('Citroën');
    expect(KNOWN_MAKES).toContain('Kawasaki');
    expect(new Set(KNOWN_MAKES).size).toBe(KNOWN_MAKES.length);
  });
});
