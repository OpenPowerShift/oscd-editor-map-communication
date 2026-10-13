/**
 * Preferences remembered per browser. Storage may be unavailable (private
 * mode, blocked or full): reading then gives nothing and writing does
 * nothing, as all stored values are optional.
 */

/** The stored value, or `null` when there is none or storage is unavailable. */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Stores a value if storage is available. */
export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Unavailable: the preference is just not remembered.
  }
}
