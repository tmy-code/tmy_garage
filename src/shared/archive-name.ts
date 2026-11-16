// File names for a Receipt's Archive copy in Proton Drive (ADR 0010). Pure, so it can be tested without a browser.

const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g;

/** A name Windows and Proton accept: no path or reserved characters, no trailing dots or spaces, at most 120 characters. */
export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(ILLEGAL, '-').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return cleaned.slice(0, 120);
}

/** The extension to keep, lower case and without the dot; falls back on the content type, then `pdf`. */
export function extensionOf(fileName: string, contentType: string): string {
  const match = /\.([a-zA-Z0-9]{1,5})$/.exec(fileName);
  if (match) return match[1]!.toLowerCase();
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType.startsWith('image/')) return contentType.slice(6).replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'jpg';
  return 'pdf';
}

/** `YYYY-MM-DD_KitChaine.pdf`: the Service date, then its title in a few words with the spaces taken out. The owner can edit it. */
export function suggestFileName(date: string, title: string | null, extension: string): string {
  const label = (title ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
  const base = sanitizeFileName(label ? `${date}_${label}` : `${date}_Facture`);
  return `${base}.${extension}`;
}

/** The name with `.<ext>` forced on, so an edited name keeps the right file type. */
export function withExtension(name: string, extension: string): string {
  const base = sanitizeFileName(name).replace(/\.[a-zA-Z0-9]{1,5}$/, '');
  return `${base || 'facture'}.${extension}`;
}

/** The first free name: `name.pdf`, then `name-2.pdf`, `name-3.pdf`. Names are compared without regard to case (Windows). */
export function uniqueFileName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** The folders of a stored path, in order (`31 Véhicules\31.02 CB650R` becomes two). */
export function pathParts(path: string): string[] {
  return path.split(/[\\/]/).filter(Boolean);
}

/** The path shown and stored: forward slashes, whatever the owner typed. */
export function joinArchivePath(...parts: string[]): string {
  return parts.flatMap(pathParts).join('/');
}
