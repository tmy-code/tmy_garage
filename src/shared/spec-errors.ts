// The one vocabulary of spec-editing errors: each code has its HTTP status. Thrown by the Notion spec writers and the
// desktop spec editor, translated to the API's `{ error, code }` answer in app.ts. No server or Notion imports here.
export const SPEC_ERROR_STATUS = {
  not_found: 404,
  notion_off: 503,
  notion_busy: 409,
  vehicle_not_in_notion: 409,
  notion_incomplete: 409,
  value_not_number: 422,
  notion_failed: 502,
} as const;

export type SpecErrorCode = keyof typeof SPEC_ERROR_STATUS;
/** The table's statuses, plus 422 for the one not_found that means "an id in the request is unknown". */
export type SpecErrorStatus = (typeof SPEC_ERROR_STATUS)[SpecErrorCode] | 422;
export const SPEC_ERROR_CODES = Object.keys(SPEC_ERROR_STATUS) as SpecErrorCode[];

export class SpecError extends Error {
  readonly code: SpecErrorCode;
  readonly status: SpecErrorStatus;

  constructor(code: SpecErrorCode, message: string, status: SpecErrorStatus = SPEC_ERROR_STATUS[code]) {
    super(message);
    this.name = 'SpecError';
    this.code = code;
    this.status = status;
  }
}
