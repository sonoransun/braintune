// Every user-visible string plus the formatters that build them. Pure: no globals.
// Copy rules: sentence case, no exclamation marks, never the word "error", calm and brief.

const SAFETY =
  "Brain Tune is for relaxation, not medical treatment. Don't use it while driving. " +
  'If you have a seizure disorder, a pacemaker, are pregnant or have a hearing condition, ask a professional first. ' +
  'Keep the volume moderate and stop if anything feels uncomfortable.';

function deepFreeze(value) {
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

/** All user-visible strings, grouped by screen area; {name} marks a placeholder for fill(). */
export const STRINGS = deepFreeze({
  app: { title: 'Brain Tune', tagline: 'Set your head straight' },
  titles: { playing: 'Playing {preset} {beat} — Brain Tune', paused: 'Paused — Brain Tune', idle: 'Brain Tune' },
  orb: {
    begin: 'Begin',
    pause: 'Pause',
    resume: 'Resume',
    tapToBegin: 'Tap to begin',
    tapToContinue: 'Tap to continue',
    unavailable: 'Sound unavailable',
    attune: 'Tap when it feels right',
  },
  status: {
    idle: { sub: 'Ready when you are.', returning: 'Welcome back.' },
    starting: { sub: 'Settling in…', announce: 'Playing {preset}, {beat} hertz, {band}.' },
    glide: '{preset} · easing {from} → {to}',
    playing: {
      headphones: 'Breathe with the glow.',
      speakers: 'Playing out loud.',
      left: '{time} left',
      five: 'Five minutes left.',
      one: 'One minute left, winding down.',
    },
    pausing: { sub: 'Letting go…' },
    paused: { sub: 'Paused. Take your time.', announce: 'Paused.' },
    ending: { sub: 'Winding down…' },
    ended: { status: 'Session complete', sub: 'Rest well.', announce: 'Session complete.' },
    ambient: { status: 'Rain and sea', sub: 'Tone finished — rain and sea continue.' },
    blocked: { sub: 'Your browser waits for a tap before playing sound.', announce: 'Sound is ready. Press Begin to start.' },
    interrupted: { sub: 'Sound paused while you were away.', announce: 'Sound paused while you were away. Press Resume to continue.' },
    unavailable: { sub: "Sound isn't available in this browser. The scene and the cats still work." },
  },
  hints: { orb: 'Tap the glow to begin', sheet: 'Scroll up for rain, ocean and timer' },
  player: {
    skipLink: 'Skip to controls',
    settings: 'Settings',
    catsGroup: 'Visiting cats',
    restartSound: 'Restart sound',
    blockedOverlay: 'Tap anywhere to let sound through',
    autoplayOverlay: 'Tap anywhere to begin {preset}',
    autoplayContinue: 'Tap anywhere to continue {preset} · {time} left',
    interruptedOverlay: 'Sound paused while you were away. Tap to continue.',
    resumePrompt: 'Resume your session? {time} left',
    resume: 'Resume',
    notNow: 'Not now',
    listening: { speakers: 'Speakers', headphones: 'Headphones' },
  },
  presets: { heading: 'Presets', custom: 'Custom' },
  mixer: {
    volume: 'Volume',
    mix: 'Mix',
    tone: 'Tone',
    rain: 'Rain',
    ocean: 'Ocean',
    purr: 'Purr',
    purrNote: 'A low purr near 26 Hz, there for comfort. It plays no part in the beat.',
    mute: 'Mute {layer}',
    unmute: 'Unmute {layer}',
  },
  toasts: {
    presetShift: 'Shifting to {preset}…',
    listeningSpeakers: 'Switched to speakers — using a soft pulsing tone.',
    listeningHeadphones: 'Switched to headphones — using binaural tones.',
    timerSet: 'Timer set to {minutes}.',
    timerSetOne: 'Timer set to 1 minute.',
    timerOff: 'Timer off.',
    offlineReady: 'Brain Tune works offline now.',
    updateReady: { text: 'A gentle update is ready.', action: 'Reload when you like' },
    reset: { text: 'Settings reset.', action: 'Undo' },
    catMilestone: "You've spotted {n} cats. They like you.",
    catMilestoneFirst: "You've spotted your first cat. It likes you.",
    stereoLeft: 'Left…',
    stereoRight: 'Right…',
  },
  firstRun: {
    title: 'Welcome to Brain Tune',
    intro: 'Gentle tones, rain and sea to help you settle, focus or drift off. Cats may wander by.',
    question: 'How are you listening right now?',
    options: {
      speakers: { label: 'Speakers', description: 'A soft pulsing tone that works out loud' },
      headphones: { label: 'Headphones', description: 'Each ear hears a slightly different tone: the full binaural effect' },
    },
    helpQuestion: 'What would help right now?',
    help: { sleep: 'Drift off', calm: 'Settle', focus: 'Focus' },
    quietNote: "Sound begins quietly when you tap Let's begin and fades in over a few seconds.",
    safety: SAFETY,
    button: "Let's begin",
  },
  settings: {
    heading: 'Settings',
    listening: {
      label: 'Listening',
      description: 'Speakers use a soft pulsing tone. Headphones give the full binaural effect.',
      speakers: 'Speakers',
      headphones: 'Headphones',
    },
    stereoCheck: { label: 'Check left/right', description: 'Plays a short tone in the left ear, then the right.', button: 'Play check' },
    cats: { label: 'Cats', description: 'Now and then a cat wanders by. Tap one to pet it.' },
    autoplay: { label: 'Play on open', description: 'Begins your last preset as soon as Brain Tune opens. Some browsers wait for a tap first.' },
    keepAwake: {
      label: 'Keep screen awake',
      description: 'Stops the screen turning off during a session.',
      unavailable: 'Your screen may dim during long sessions',
    },
    theme: { label: 'Theme', description: 'Auto follows your device.', dark: 'Dark', light: 'Light', auto: 'Auto' },
    stillMode: { label: 'Still mode', description: 'Stops the waves, rain and walking cats. Follows your device when reduced motion is on.' },
    scene: { label: 'Scene', description: 'The animated sky and sea behind the controls.', full: 'Full', off: 'Off' },
    haptics: { label: 'Haptics', description: 'A light tap when you change something.' },
    nightDim: { label: 'Night dim', description: 'In Sleep, Deep sleep and Rest the screen dims after a minute of stillness and settles further after five.' },
    shortcuts: {
      label: 'Keyboard shortcuts',
      description: 'Space or K plays and pauses. 1 to 9 pick a preset. M mutes, H switches listening, T changes the theme, C calls a cat, ? opens About.',
    },
    addToHome: {
      label: 'Add to home screen',
      description: 'Open Brain Tune like an app, offline too.',
      generic: "Use your browser's Add to Home Screen or Install option",
      apple: 'In Safari: Share, then Add to Home Screen.',
      button: 'Install',
    },
    reset: { label: 'Reset all settings', description: 'Back to the quiet defaults.', button: 'Reset' },
    more: { label: 'More settings' },
  },
  fineTuning: {
    heading: 'Fine tuning',
    beat: 'Beat',
    pitch: 'Pitch',
    timbre: 'Timbre',
    pad: 'Pad',
    beatStyle: 'Beat style',
    rainfall: 'Rainfall',
    sea: 'Sea',
    rainfallLevels: ['drizzle', 'steady', 'heavy', 'downpour'],
    seaLevels: ['glassy', 'gentle', 'rolling', 'heavy swell'],
    timbres: { sine: 'Sine', velvet: 'Velvet', warm: 'Warm', amber: 'Amber', glass: 'Glass', bell: 'Bell' },
    padStyle: { label: 'Pad style', auto: 'Auto', drone: 'Drone', canon: 'Canon' },
    styles: { auto: 'Auto', binaural: 'Binaural', monaural: 'Wavering', isochronic: 'Pulsing' },
    gammaNote: 'At 40 Hz the pulse is a fast flutter by nature.',
    attune: { start: 'Find your pitch', hint: 'Tap when it feels right', cancel: 'Never mind', done: 'Pitch set to {pitch}' },
    explainer: {
      title: 'What do these do?',
      beat: 'Beat is the slow rhythm your brain is invited to follow, in cycles per second. Lower feels sleepier, higher more alert.',
      pitch: 'Pitch is the tone that carries the beat. It does not change the tuning, so choose whatever sounds comfortable.',
      timbre: 'Timbre is the colour of the tone. Sine is plain, Velvet and Warm are rounder, Amber is octave-rich, Glass and Bell are sparse and clear.',
      pad:
        'Pad adds a quiet octave and fifth above the tone and a sub below it, all in pure ratios. At low pitches the fifth sits an octave higher, and the voices enter one at a time over the first minute.',
      padStyle:
        'Drone holds the harmony and lets it breathe. Canon adds two slow voices, one answering the other a few notes later, as in a round. Auto uses Canon in Meditate and Calm.',
      beatStyle:
        'Beat style chooses how the beat is made. Binaural needs headphones. Pulsing works out loud. Wavering sums both tones in the centre. Auto picks for you.',
      rainfall: 'Rainfall sets how hard the rain falls; the Rain slider sets how loud it is.',
      sea: 'Sea sets how big the waves are; the Ocean slider sets how loud they are.',
    },
  },
  timer: {
    heading: 'Timer',
    infinite: '∞',
    infiniteLabel: 'No timer',
    custom: 'Custom',
    minutes: '{n} min',
    hours: '{n} h',
    hoursMinutes: '{h} h {m} min',
    left: '{time} left',
    after: { label: 'After the timer', stop: 'Fade out', ambient: 'Keep rain and ocean' },
    endFade: 'End fade',
    chime: 'Soft chime',
  },
  about: {
    heading: 'About & safety',
    platformNotes: 'Platform notes',
    catsSpotted: 'Cats spotted',
    version: 'Version',
    safety: SAFETY,
    monoAudio: 'Binaural tones need stereo. If your device plays Mono Audio, choose Speakers.',
    tuning:
      'Pitch, pad and chime are tuned in simple whole-number ratios, which sound smooth because their overtones line up. No particular key or frequency is special on its own.',
    canon:
      "In Canon the pad's two slow voices follow simple rules of counterpoint: the second voice imitates the first, sometimes upside down, slower or sooner, and every pair of notes heard together forms a consonant interval.",
    privacy: 'Nothing leaves your device.',
    storageNote: 'This browser is not keeping site data, so settings last until you close the page.',
  },
  cats: {
    label: 'A {coat} cat {pose}',
    petting: 'A {coat} cat, purring',
    poses: { sit: 'sitting nearby', loaf: 'resting nearby', walk: 'walking by', sleep: 'sleeping nearby', peek: 'peeking in' },
    coats: { black: 'black', orangeTabby: 'orange tabby', grey: 'grey', calico: 'calico', tuxedo: 'tuxedo' },
    milestone: "You've spotted {n} cats. They like you.",
    called: 'A cat is on its way.',
    none: 'No cat nearby just now.',
  },
  limitations: {
    apple: [
      "Brain Tune asks iOS to treat it like music, so it keeps playing when the screen locks and with the silent switch on (this pauses other apps' audio).",
      'If sound stops after a call or alarm, tap Play again or use Restart sound.',
    ],
    android: [
      'Brain Tune keeps playing while you switch apps.',
      'There is no lock-screen control for this kind of audio — open Brain Tune to pause.',
      'If sound stops when the screen turns off, turn on Keep screen awake.',
    ],
    desktop: ['Works in a background tab.', 'Keep screen awake stops the display sleeping.'],
    shared: 'Binaural needs headphones; on speakers Brain Tune uses a pulsing tone.',
  },
});

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** How close a pitch must be to a just stop, or to an equal-tempered note, to carry its name, cents. */
const JUST_STOP_CENTS = 3;
const NOTE_CENTS = 5;

/** The just grid over A = 110 Hz as [hz, name] pairs, C3 to G5: C, D, E, F, G and A at 6/5, 4/3, 3/2, 8/5, 9/5 and 2 times the A below. */
export const JUST_STOPS = deepFreeze([
  [132, 'C3'], [440 / 3, 'D3'], [165, 'E3'], [176, 'F3'], [198, 'G3'], [220, 'A3'],
  [264, 'C4'], [880 / 3, 'D4'], [330, 'E4'], [352, 'F4'], [396, 'G4'], [440, 'A4'],
  [528, 'C5'], [1760 / 3, 'D5'], [660, 'E5'], [704, 'F5'], [792, 'G5'],
]);

const centsBetween = (hz, refHz) => 1200 * Math.log2(hz / refHz);

function oneDecimal(x) {
  return String(Number(x.toFixed(1)));
}

function nearestNote(hz) {
  const n = Math.round(12 * Math.log2(hz / 440)) + 69;
  const name = `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
  const cents = centsBetween(hz, 440 * 2 ** ((n - 69) / 12));
  return { name, cents };
}

/** Replaces {name} placeholders in a template with values from vars; missing values become empty. */
export function fill(template, vars = {}) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => (vars[key] === undefined || vars[key] === null ? '' : String(vars[key])));
}

/** '7.5 Hz', '10 Hz': at most one decimal, trailing zeros trimmed. */
export function formatHz(hz) {
  return Number.isFinite(hz) ? `${oneDecimal(hz)} Hz` : '—';
}

/** '264 Hz · C4' within ±3 cents of a JUST_STOPS pitch; otherwise '440 Hz · A4' within ±5 cents of an equal-tempered note, else '256 Hz · near C4'. */
export function formatPitch(hz) {
  if (!(Number.isFinite(hz) && hz > 0)) return '—';
  const stop = JUST_STOPS.find(([stopHz]) => Math.abs(centsBetween(hz, stopHz)) <= JUST_STOP_CENTS);
  if (stop) return `${formatHz(hz)} · ${stop[1]}`;
  const { name, cents } = nearestNote(hz);
  return `${formatHz(hz)} · ${Math.abs(cents) <= NOTE_CENTS ? name : `near ${name}`}`;
}

/** 0.7 → '70%'. */
export function formatPercent(x01) {
  const x = Number.isFinite(x01) ? Math.min(1, Math.max(0, x01)) : 0;
  return `${Math.round(x * 100)}%`;
}

/** 1180000 → '19:40'; from one hour up 'h:mm:ss'; seconds are rounded up so 0:00 means done. */
export function formatTimeLeft(ms) {
  const total = Math.max(0, Math.ceil((Number.isFinite(ms) ? ms : 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** 20 → '20 min'; a non-finite count reads as the no-timer glyph. */
export function formatMinutes(n) {
  if (!Number.isFinite(n) || n === 0) return STRINGS.timer.infinite;
  const total = Math.round(n);
  if (total < 120) return fill(STRINGS.timer.minutes, { n: total });
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? fill(STRINGS.timer.hours, { n: h }) : fill(STRINGS.timer.hoursMinutes, { h, m });
}

/** Orb label, status line, sub-line and live announcement for an engine state (§7.4 table); while glide.active the status reads 'Sleep · easing 6 → 2 Hz' and the start announcement names glide.fromHz. */
export function statusLine(state, ctx = {}) {
  const { presetName = '', beatHz, band = '', listening = 'speakers', remainingMs = null, returning = false, mark = null, glide = null } = ctx;
  const S = STRINGS.status;
  const O = STRINGS.orb;
  const gliding = Boolean(glide?.active) && Number.isFinite(glide.fromHz) && Number.isFinite(glide.toHz);
  const title = gliding
    ? fill(S.glide, { preset: presetName, from: oneDecimal(glide.fromHz), to: formatHz(glide.toHz) })
    : Number.isFinite(beatHz) ? `${presetName} · ${formatHz(beatHz)}` : presetName;
  const startHz = gliding ? glide.fromHz : beatHz;
  const idle = { label: O.begin, status: title, sub: returning ? S.idle.returning : S.idle.sub, announce: null, timeLeft: null };
  switch (state) {
    case 'starting':
      return {
        ...idle,
        label: O.pause,
        sub: S.starting.sub,
        announce: fill(S.starting.announce, { preset: presetName, beat: Number.isFinite(startHz) ? oneDecimal(startHz) : '', band }),
      };
    case 'playing': {
      const feel = listening === 'headphones' ? S.playing.headphones : S.playing.speakers;
      const timeLeft = Number.isFinite(remainingMs) && remainingMs > 0 ? fill(S.playing.left, { time: formatTimeLeft(remainingMs) }) : null;
      const announce = mark === 'five' ? S.playing.five : mark === 'one' ? S.playing.one : null;
      return { ...idle, label: O.pause, sub: timeLeft ? `${feel} ${timeLeft}` : feel, announce, timeLeft };
    }
    case 'pausing':
      return { ...idle, label: O.begin, sub: S.pausing.sub, announce: S.paused.announce };
    case 'paused':
      return { ...idle, label: O.resume, sub: S.paused.sub, announce: S.paused.announce };
    case 'ending':
      return { ...idle, label: O.pause, sub: S.ending.sub };
    case 'ended':
      return { ...idle, label: O.begin, status: S.ended.status, sub: S.ended.sub, announce: S.ended.announce };
    case 'ambient':
      return { ...idle, label: O.pause, status: S.ambient.status, sub: S.ambient.sub, announce: S.ambient.sub };
    case 'blocked':
      return { ...idle, label: O.tapToBegin, sub: S.blocked.sub, announce: S.blocked.announce };
    case 'interrupted':
      return { ...idle, label: O.tapToContinue, sub: S.interrupted.sub, announce: S.interrupted.announce };
    case 'unavailable':
      return { ...idle, label: O.unavailable, status: presetName, sub: S.unavailable.sub, announce: S.unavailable.sub };
    default:
      return idle;
  }
}

/** Platform notes for About and the README: the platform's lines plus the shared headphones line. */
export function limitationsCopy(platform) {
  const lines = STRINGS.limitations[platform];
  return [...(Array.isArray(lines) ? lines : []), STRINGS.limitations.shared];
}

/** Picks a word for a 0..1 intensity from four levels (bands below 0.3, 0.6 and 0.85). */
export function describeLevel(x01, levels) {
  const x = Number.isFinite(x01) ? Math.min(1, Math.max(0, x01)) : 0;
  return levels[x < 0.3 ? 0 : x < 0.6 ? 1 : x < 0.85 ? 2 : 3];
}

/** Rainfall intensity as a word: drizzle, steady, heavy or downpour. */
export function formatRainfall(x01) {
  return describeLevel(x01, STRINGS.fineTuning.rainfallLevels);
}

/** Sea intensity as a word: glassy, gentle, rolling or heavy swell. */
export function formatSea(x01) {
  return describeLevel(x01, STRINGS.fineTuning.seaLevels);
}
