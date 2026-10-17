// Keyboard shortcut mapping. Pure: takes plain key facts and UI context, returns an action name.

const LETTER_ACTIONS = { m: 'mute', h: 'listening', t: 'theme', c: 'cat' };

/** Maps a key event ({key, code, metaKey, ctrlKey, altKey}) plus UI context to an action name, or null. */
export function mapKeyToAction(evt, ctx) {
  const { key = '', code = '', metaKey = false, ctrlKey = false, altKey = false } = evt ?? {};
  const { shortcutsEnabled = true, typing = false, focusIsInteractive = false, dialogOpen = false } = ctx ?? {};
  if (key === 'Escape' || key === 'Esc' || code === 'Escape') return 'escape';
  if (dialogOpen || typing || !shortcutsEnabled) return null;
  if (metaKey || ctrlKey || altKey) return null;
  const lower = typeof key === 'string' ? key.toLowerCase() : '';
  if (key === ' ' || key === 'Spacebar' || code === 'Space' || lower === 'k') {
    return focusIsInteractive ? null : 'toggle-play';
  }
  if (/^[1-9]$/.test(key)) return `preset:${key}`;
  if (key === '?') return 'about';
  return LETTER_ACTIONS[lower] ?? null;
}
