import { describe, expect, it } from 'vitest';
import { NotionError } from '../notion/api.ts';
import { SpecError } from '../shared/spec-errors.ts';
import { asSpecError } from './spec-edits.ts';

describe('asSpecError', () => {
  it('returns a SpecError as the same instance', () => {
    const error = new SpecError('value_not_number', 'x');
    expect(asSpecError(error)).toBe(error);
  });

  it('maps a busy sync to notion_busy', () => {
    const busy = new Error('whatever');
    busy.name = 'NotionSyncBusy';
    const result = asSpecError(busy);
    expect(result?.code).toBe('notion_busy');
    expect(result?.status).toBe(409);
    expect(result?.message).toBe('A Notion sync is already running');
  });

  it('maps a NotionError to notion_failed', () => {
    const result = asSpecError(new NotionError(400, 'Notion said no'));
    expect(result?.code).toBe('notion_failed');
    expect(result?.status).toBe(502);
    expect(result?.message).toBe('Notion said no');
  });

  it('leaves a plain Error alone', () => {
    expect(asSpecError(new Error('bug'))).toBeNull();
  });

  it('leaves a string and undefined alone', () => {
    expect(asSpecError('oops')).toBeNull();
    expect(asSpecError(undefined)).toBeNull();
  });
});
