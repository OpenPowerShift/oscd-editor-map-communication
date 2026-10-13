import { expect } from '@open-wc/testing';

import { isApple, shortcut, shortcutAction } from './shortcuts.js';

const press = (key: string, modifiers: Partial<KeyboardEvent> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers,
});

describe('shortcuts', () => {
  it('shows shortcuts for the platform', () => {
    expect(shortcut('F', false)).to.equal('Ctrl+F');
    expect(shortcut('F', true)).to.equal('\u2318F');
    expect(isApple('MacIntel')).to.equal(true);
    expect(isApple('Linux x86_64')).to.equal(false);
    expect(typeof shortcut('F')).to.equal('string');
  });

  it('maps Ctrl and Command combinations', () => {
    expect(shortcutAction(press('f', { ctrlKey: true }), false)).to.equal('search');
    expect(shortcutAction(press('F', { metaKey: true }), true)).to.equal('search');
    expect(shortcutAction(press('=', { ctrlKey: true }), false)).to.equal('zoom-in');
    expect(shortcutAction(press('-', { ctrlKey: true }), false)).to.equal('zoom-out');
    expect(shortcutAction(press('0', { ctrlKey: true }), false)).to.equal('zoom-fit');
    expect(shortcutAction(press('[', { ctrlKey: true }), false)).to.equal(
      'previous-substation',
    );
    expect(shortcutAction(press(']', { ctrlKey: true }), false)).to.equal(
      'next-substation',
    );
    expect(
      ['g', 's', 'r', 'l'].map(key =>
        shortcutAction(press(key, { ctrlKey: true }), true),
      ),
    ).to.deep.equal(['toggle-goose', 'toggle-sv', 'toggle-report', 'toggle-labels']);
    // Left to the shell, the browser or unmapped.
    expect(
      shortcutAction(press('F', { ctrlKey: true, shiftKey: true }), false),
    ).to.equal(undefined);
    expect(shortcutAction(press('f', { ctrlKey: true, altKey: true }), false)).to.equal(
      undefined,
    );
    expect(shortcutAction(press('z', { ctrlKey: true }), false)).to.equal(undefined);
  });

  it('maps single keys outside text fields only', () => {
    expect(
      ['/', '+', '-', '0', 'f', 'l', 'x'].map(key =>
        shortcutAction(press(key), false),
      ),
    ).to.deep.equal([
      'search',
      'zoom-in',
      'zoom-out',
      'zoom-fit',
      'toggle-filter',
      'toggle-labels',
      undefined,
    ]);
    expect(shortcutAction(press('f'), true)).to.equal(undefined);
  });
});
