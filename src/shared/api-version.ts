/**
 * The version of the server's `/api` that these screens expect. The server sends its own in the `x-api-version`
 * header; when the two differ, the app stops sending its queue until one side is updated (ADR 0003).
 * Bump it whenever a change to `/api` would break an older Android app.
 * 3: a Vehicle Item points at an Item Spec (itemSpecId), the snapshot carries `itemSpecs`, and `specLines` holds only the lines not moved to Notion (ADR 0009).
 */
export const API_VERSION = 3;

export const API_VERSION_HEADER = 'x-api-version';
