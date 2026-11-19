import { describe, expect, it } from 'vitest';
import { MESSAGES } from './messages.ts';
import { SPEC_ERROR_CODES, SPEC_ERROR_STATUS, SpecError } from './spec-errors.ts';

describe('spec error vocabulary', () => {
  it('has the exact code to status table', () => {
    expect(SPEC_ERROR_STATUS).toEqual({
      not_found: 404,
      notion_off: 503,
      notion_busy: 409,
      vehicle_not_in_notion: 409,
      notion_incomplete: 409,
      value_not_number: 422,
      notion_failed: 502,
    });
    for (const code of SPEC_ERROR_CODES) expect(typeof SPEC_ERROR_STATUS[code]).toBe('number');
  });

  it('takes the status from the table', () => {
    for (const code of SPEC_ERROR_CODES) {
      const error = new SpecError(code, 'm');
      expect(error.status).toBe(SPEC_ERROR_STATUS[code]);
      expect(error.code).toBe(code);
      expect(error.name).toBe('SpecError');
      expect(error).toBeInstanceOf(Error);
    }
  });

  it('accepts a 422 override for not_found', () => {
    expect(new SpecError('not_found', 'm', 422).status).toBe(422);
  });

  it('has an English message for exactly these codes', () => {
    expect(Object.keys(MESSAGES.en.specs.errors).sort()).toEqual([...SPEC_ERROR_CODES].sort());
  });

  it('has a French message for exactly these codes', () => {
    expect(Object.keys(MESSAGES.fr.specs.errors).sort()).toEqual([...SPEC_ERROR_CODES].sort());
  });
});
