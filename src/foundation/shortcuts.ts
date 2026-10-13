/** True on Apple platforms, where shortcuts use Command instead of Ctrl. */
export function isApple(platform = navigator.platform): boolean {
  return /Mac|iPhone|iPad/.test(platform);
}

/** A shortcut as shown in tooltips: `Ctrl+F`, or `⌘F` on Apple platforms. */
export function shortcut(key: string, apple = isApple()): string {
  return apple ? `\u2318${key}` : `Ctrl+${key}`;
}

/** Map actions available from the keyboard. */
export type ShortcutAction =
  | 'search'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-fit'
  | 'previous-substation'
  | 'next-substation'
  | 'toggle-goose'
  | 'toggle-sv'
  | 'toggle-report'
  | 'toggle-filter'
  | 'toggle-labels';

/** Actions of Ctrl (Command) key combinations, by lower case key. */
const withModifier: Record<string, ShortcutAction> = {
  f: 'search',
  '=': 'zoom-in',
  '+': 'zoom-in',
  '-': 'zoom-out',
  '0': 'zoom-fit',
  '[': 'previous-substation',
  ']': 'next-substation',
  g: 'toggle-goose',
  s: 'toggle-sv',
  r: 'toggle-report',
  l: 'toggle-labels',
};

/** Actions of single keys, used outside text fields. */
const single: Record<string, ShortcutAction> = {
  '/': 'search',
  '+': 'zoom-in',
  '=': 'zoom-in',
  '-': 'zoom-out',
  '0': 'zoom-fit',
  f: 'toggle-filter',
  l: 'toggle-labels',
};

/**
 * The map action of a key press, if any. Single keys only act outside text
 * fields; Ctrl+Shift+F is left to the OpenSCD shell (its plugin search),
 * and Alt combinations to the browser.
 */
export function shortcutAction(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
  inTextField: boolean,
): ShortcutAction | undefined {
  if (event.altKey) {
    return undefined;
  }
  const key = event.key.toLowerCase();
  if (event.ctrlKey || event.metaKey) {
    if (event.shiftKey && key === 'f') {
      return undefined;
    }
    return withModifier[key];
  }
  return inTextField ? undefined : single[key];
}
