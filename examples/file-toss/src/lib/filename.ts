/** Marks a transfer as coming from this app, and carries the file's name. */
const KIND_PREFIX = 'file-toss/1:';
const MAX_KIND_LENGTH = 255;
const MAX_NAME_LENGTH = 120;
const MAX_EXTENSION_LENGTH = 16;
const FALLBACK_NAME = 'file';
const FALLBACK_MIME = 'application/octet-stream';

const RESERVED = new Set('<>:"|?*');

/** Control characters, and the formatting ones that can disguise an extension. */
function isUnsafe(character: string): boolean {
  const code = character.codePointAt(0)!;
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2069) ||
    (code >= 0xd800 && code <= 0xdfff) || // Half of a broken pair.
    code === 0xfeff ||
    RESERVED.has(character)
  );
}

function splitExtension(name: string): [string, string] {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || name.length - dot > MAX_EXTENSION_LENGTH) return [name, ''];
  return [name.slice(0, dot), name.slice(dot)];
}

/** Cuts the stem until `fits` passes, keeping the extension. Never splits a character. */
function shorten(name: string, fits: (candidate: string) => boolean): string {
  const [stem, extension] = splitExtension(name);
  const characters = Array.from(stem);
  let candidate = name;
  while (!fits(candidate) && characters.length > 1) {
    characters.pop();
    candidate = characters.join('').trimEnd() + extension;
  }
  return candidate;
}

/** Makes a name from another phone safe to use as a filename and to show. */
export function sanitizeFilename(raw: string): string {
  const base = raw.replace(/\\/g, '/').split('/').pop() ?? '';
  const cleaned = Array.from(base)
    .filter((character) => !isUnsafe(character))
    .join('')
    .replace(/^[\s.]+/, '')
    .replace(/[\s.]+$/, '');
  if (cleaned === '') return FALLBACK_NAME;
  return shorten(cleaned, (name) => Array.from(name).length <= MAX_NAME_LENGTH);
}

/** Puts a filename in the transfer's `kind`, which has to be short printable ASCII. */
export function nameToKind(name: string): string {
  const encode = (value: string) => KIND_PREFIX + encodeURIComponent(value);
  return encode(shorten(sanitizeFilename(name), (value) => encode(value).length <= MAX_KIND_LENGTH));
}

/** Reads the filename back out of a `kind`, which comes from the sender and is untrusted. */
export function kindToName(kind: string): string {
  if (!kind.startsWith(KIND_PREFIX)) return FALLBACK_NAME;
  try {
    return sanitizeFilename(decodeURIComponent(kind.slice(KIND_PREFIX.length)));
  } catch {
    return FALLBACK_NAME;
  }
}

/** Android installs and runs these, so nothing received should claim to be one. */
const EXECUTABLE_MIME = /android\.package-archive|x-msdownload|x-executable|x-sh\b/i;

/** Gives back a type that's safe to label a file with, or a generic one. */
export function safeMime(mime: string | null | undefined): string {
  if (!mime || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mime) || EXECUTABLE_MIME.test(mime)) {
    return FALLBACK_MIME;
  }
  return mime.toLowerCase();
}
