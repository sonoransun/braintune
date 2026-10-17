// Keyboard shortcuts (plan §5, §9): key facts plus typing / interactive-focus / dialog context go through
// core/keyboard-map; dispatch(action, event) returns false to leave the key to the browser.

import { mapKeyToAction } from '../core/keyboard-map.js';

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week']);
const INTERACTIVE_SELECTOR = [
  'a[href]', 'button', 'input', 'select', 'textarea', 'summary', '[contenteditable]',
  '[role="button"]', '[role="switch"]', '[role="slider"]', '[role="radio"]', '[role="checkbox"]', '[role="link"]', '[role="tab"]',
].join(', ');

/** True when key presses on el type text (text-like inputs, textareas, contenteditable). */
export function isTypingTarget(el) {
  if (!el || typeof el.matches !== 'function') return false;
  if (el.isContentEditable) return true;
  if (el.matches('textarea')) return true;
  return el.matches('input') && TEXT_INPUT_TYPES.has((el.getAttribute('type') || 'text').toLowerCase());
}

/** True when el is a focusable control that handles Space/Enter itself. */
export function isInteractiveTarget(el) {
  return Boolean(el && typeof el.matches === 'function' && el.matches(INTERACTIVE_SELECTOR));
}

/** Installs the keydown listener on doc; returns a dispose function. */
export function installShortcuts(doc, { isEnabled = () => true, dispatch }) {
  function onKeyDown(e) {
    if (e.defaultPrevented || e.isComposing || e.repeat) return;
    const target = e.target;
    const action = mapKeyToAction(e, {
      shortcutsEnabled: Boolean(isEnabled()),
      typing: isTypingTarget(target),
      focusIsInteractive: isInteractiveTarget(target),
      dialogOpen: Boolean(doc.querySelector('dialog[open]')),
    });
    if (!action) return;
    const handled = dispatch(action, e);
    if (handled !== false && action !== 'escape') e.preventDefault();
  }
  doc.addEventListener('keydown', onKeyDown);
  return () => doc.removeEventListener('keydown', onKeyDown);
}
