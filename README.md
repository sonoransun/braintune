# Brain Tune

Set your head straight

Brain Tune plays a soft tone that carries a slow beat in one of the classic brainwave bands, from delta to gamma, under rain and ocean that are synthesised on the spot, in front of an animated sea whose colours follow the band. Cats wander by now and then. It is one static page: vanilla HTML, CSS and ES modules, no build step, no dependencies, no accounts, no analytics. It installs as a home-screen app, works offline, and nothing leaves the device.

Live: `https://<your-github-user>.github.io/braintune/` (replace the placeholder once you have published; see [Publish to GitHub Pages](#publish-to-github-pages)).

## What it does

### Three ways to make a beat

- **Binaural** (headphones). Each ear hears a slightly different tone and the difference is the beat. It needs stereo, so it is used for beats below 30 Hz when you choose Headphones.
- **Pulsing** (isochronic, speakers). One tone swells and softens at the beat rate. It works out loud and is always used from 30 Hz up, so Clarity pulses on headphones too.
- **Wavering** (monaural). Both tones are summed in the centre, so the beat is audible on anything. It is offered under Fine tuning as a Beat style.

On first run a single card asks "How are you listening right now?" with **Speakers** highlighted. Speakers is the safe default: a binaural beat played through speakers produces no beat at all, while a pulsing tone works either way. If you pick Headphones, the first time sound plays you hear a short check, one second in the left ear and one in the right, so you know the channels are the right way round. Switch any time with the mode button in the header, in Settings, or with the H key.

### Presets

| Preset | Band | Beat | Carrier, headphones / speakers | Layers on | Timer | For |
|---|---|---|---|---|---|---|
| Sleep | delta | 2 Hz, starting at 6 Hz and gliding down over 12 min | 200 / 420 Hz | ocean | 45 min | drifting off |
| Rest | delta | 3.5 Hz | 210 / 420 Hz | rain, ocean | 20 min | winding down |
| Meditate | theta | 6 Hz | 256 / 420 Hz | ocean | 20 min | sitting quietly |
| Cat nap | theta | 5.5 Hz | 220 / 420 Hz | rain, purr | 20 min | a short doze |
| Calm | alpha | 10 Hz | 256 / 420 Hz | rain, ocean | 20 min | settling; the default |
| Focus | beta | 15 Hz | 320 / 520 Hz | rain | 45 min | steady work |
| Energise | beta | 20 Hz | 400 / 640 Hz | rain, ocean | 15 min | getting going |
| Clarity | gamma | 40 Hz | 400 / 520 Hz, pulsing on both | rain | 20 min | alert work |

The table is `docs/js/core/presets.js`. Each preset also sets its timbre, whether the pad plays, its end fade (20 to 90 s) and whether a soft chime closes the session (Meditate, Focus, Energise and Clarity). Keys 1 to 8 pick presets in this order. On a touch device playing through speakers the carrier never drops below 400 Hz, because small speakers reproduce little beneath it.

### Fine tuning

A collapsed section below the timer. Any change here turns the preset chip to Custom; choosing a preset clears it again.

- **Beat** 0.5 to 40 Hz in 0.5 Hz steps (Shift moves 5 Hz). From 30 Hz up the beat is always Pulsing, and a note says that at 40 Hz the pulse is a fast flutter by nature.
- **Pitch** 120 to 800 Hz with a nearest-note hint, for example "256 Hz · near C4" or "440 Hz · A4". Pitch carries the beat and does not change the tuning.
- **Timbre** Sine, Velvet, Glass or Warm.
- **Pad** a quiet fifth, octave and sub beneath the tone.
- **Beat style** Auto, Binaural, Wavering or Pulsing.
- **Find your pitch** while sound plays, the pitch sweeps slowly between 180 and 520 Hz, a minute each way. Tap the orb when it feels right and that pitch is kept. "Never mind" or Esc cancels.

## Rain, ocean and cats

Every sound is generated in the browser when you press play. There are no audio files. Rain is filtered noise with individual drops; the ocean is a slow surf bed with waves that swell, crash and wash out, and every crash rolls a wave across the scene; the purr is a 26 Hz rumble shaped by a breath cycle.

**Mix.** A Volume slider, then Tone, Rain, Ocean and Purr, each with a mute button. Presets set the sliders and also how heavy the rain falls and how big the waves are. The sliders set how loud each layer is. The Purr row carries its own disclosure: "A ~26 Hz comfort rumble, not part of the tuning." It sits at zero in every preset except Cat nap.

**Cats.** Now and then a cat arrives along the bottom edge: black, orange tabby, grey or calico; sitting, loafing, sleeping or walking across. The first visit comes 20 to 40 seconds into a session, later ones every 45 seconds to two and a half minutes, with longer gaps when nothing is playing and shorter ones during Cat nap. At most two are present at once, one on narrow screens. Tap or click a cat to pet it: it narrows its eyes, hearts rise, a short purr sounds if you are playing, and it stays a little longer. Press C to pet the newest cat, or to call one when none is about. About & safety keeps a count of cats spotted, with a small toast at 1, 10, 25, 50 and 100. Cats always sit beneath the controls and never cover them.

**Turning things off.** Rain, Ocean or Purr: slide to zero or tap mute (M mutes everything, again restores). Cats: Settings, Cats. The animated sea: Settings, Scene, Off. Motion only: Settings, Still mode. To keep the ambience after the tone has finished, choose "After the timer: Keep rain and ocean".

## Reassuring by design

- **Quiet by default.** At every preset's defaults the tone peaks around −22 dBFS, and the tests hold every preset between −26 and −18. A limiter and a −1 dBFS ceiling mean nothing clips even with every slider at the top. Volume starts at 70 %.
- **Long fades.** Play fades in over 1.5 s, pause over 0.6 s, stop over 2 s; preset changes glide over about 2 s; every slider move is a ramp. The timer ends with the preset's 20 to 90 s fade and, where set, a soft two-note chime.
- **No modals** except the first-run card. Everything else is a toast or an inline note. A full-screen "Tap anywhere to let sound through" appears only when the browser blocks sound until a tap.
- **Timer.** None, 10, 15, 20, 30, 45, 60 or 90 minutes, or Custom from 1 to 480. The choice is remembered per preset. "After the timer" is Fade out or Keep rain and ocean. Quiet announcements at five minutes and one minute. If you reload with more than a minute left, a toast offers "Resume your session? 12 min left"; nothing plays until you tap.
- **Night dim.** During Sleep and Rest the screen dims after a minute without input. Any touch or key restores it. On by default; off in Settings.
- **Still mode** stops the waves, the rain streaks and walking cats. By default it follows your device's reduced-motion setting, live.
- **Scene off** removes the animated sky and sea. Nothing on screen is driven by the beat or the carrier, nothing flashes, and no periodic change of colour or brightness is faster than ten seconds. The only quicker movement is a cat's tail or walk, and Still mode stops those.
- **Theme** dark by default, with Light and Auto.
- **Settings persist** in this browser and nothing leaves the device: the page's content security policy allows only its own origin, there are no requests after load, no analytics and no accounts.

Keyboard shortcuts (a switch in Settings turns them off):

| Key | Does |
|---|---|
| Space or K | Play or pause, when focus is not on a control |
| 1 to 8 | Choose a preset, in table order |
| M | Mute everything; again to restore |
| H | Switch between Speakers and Headphones |
| T | Cycle the theme |
| C | Pet the newest cat, or call one |
| ? | Open About & safety |
| Esc | Cancel Find your pitch, or collapse the panel |

## Safety note

The first-run card and About & safety carry this text:

> Brain Tune is for relaxation, not medical treatment. Don't use it while driving. If you have a seizure disorder, a pacemaker, are pregnant or have a hearing condition, ask a professional first. Keep the volume moderate and stop if anything feels uncomfortable.

Evidence for brainwave entrainment is mixed; treat it as a relaxation aid. Preset names describe when you might use them, not what they will do.

## Install and offline

- **Add to Home Screen.** In Safari on iPhone or iPad: Share, then Add to Home Screen. On Android, Chrome offers Install app or Add to Home screen, and Brain Tune shows an Install button in Settings when the browser allows it. Desktop Chrome and Edge show an install icon in the address bar.
- **Offline after the first visit.** A service worker stores the whole app on first load and shows "Brain Tune works offline now." Later visits load from that copy. New versions are fetched in the background and offered with "A gentle update is ready. Reload when you like."
- **Separate storage.** On iOS a home-screen web app has its own storage, apart from the Safari tab, so each keeps its own settings, cat count and offline copy.
- **Safari and unused sites.** WebKit documents that Safari may delete a site's script-writable storage, which includes these settings and the offline copy, after seven days of Safari use without interaction with the site. A home-screen web app keeps its own counter of days of use, so WebKit does not expect its data to be removed this way. If your settings reset after a long break, this is the likely cause.

## Platform notes

About & safety shows one of these blocks, chosen by feature detection only; no behaviour depends on the choice.

**iPhone and iPad.** Brain Tune asks iOS to treat it like music, so it keeps playing when the screen locks and with the silent switch on (this pauses other apps' audio). If sound stops after a call or alarm, tap Play again or use Restart sound.

**Android.** Brain Tune keeps playing while you switch apps. There is no lock-screen control for this kind of audio — open Brain Tune to pause. If sound stops when the screen turns off, turn on Keep screen awake.

**Desktop.** Works in a background tab. Keep screen awake stops the display sleeping.

**Everywhere.** Binaural needs headphones; on speakers Brain Tune uses a pulsing tone.

There are no lock-screen or media-key controls in this version. Web Audio on its own does not get a media notification, and Brain Tune uses no undocumented workarounds to obtain one. Open the app to pause. "Keep screen awake" appears only where the browser supports the Screen Wake Lock API and is off by default. While sound plays, a "Sound stopped? Restart sound" link sits under the status line; it rebuilds the audio graph from your current settings.

## Run locally

```sh
npm run dev           # http://localhost:8080/           node tools/serve.mjs --dir docs --port 8080
npm run dev:subpath   # http://localhost:8080/braintune/ the published shape, catches root-absolute URLs
python3 -m http.server 8080 --directory docs             # without Node
```

Opening `docs/index.html` from `file://` does not work: ES modules and service workers need an http or https origin. The dev server sends `Cache-Control: no-store`, but an installed worker still serves the files it cached until its own script changes. While editing, open `http://localhost:8080/?nosw`: it unregisters the worker, deletes its caches and reloads clean, and the worker installs again on that reload with the current files. Chrome's "Update on reload" under Application, Service Workers does the same job continuously.

- **Android phone.** Run `adb reverse tcp:8080 tcp:8080`, then open `http://localhost:8080/` in Chrome on the phone. Localhost counts as a secure context, so the service worker and installation work.
- **iPhone or iPad.** The service worker, Wake Lock and installation need HTTPS, so test those on the published URL.
- **Viewports.** `node tools/serve.mjs --dir . --port 8081`, then open `http://localhost:8081/tools/viewports.html?sizes=phone,short&scale=0.8`. Named sizes are phone 390×844, short 844×390, tablet 768×1024 and desktop 1280×800; any `WxH` works too. Each frame loads `../docs/?nosw`.
- **Cat gallery.** `?gallery=cats` shows every pose and coat in both themes.
- **Icons.** `npm run icons` regenerates `docs/icons/*.png` from the favicon geometry with nothing but `node:zlib`. The PNGs are committed.

## Tests

```sh
npm test              # node --test "tests/**/*.test.js"
npm run test:watch
```

The suite uses `node:test` with zero dependencies and needs Node 22.5 or newer. It runs in about a second. It covers the pure maths and DSP (seeded random, noise spectra measured with Goertzel, biquads, levels, timbres, the gate, entrainment ranges, the attune sweep); the presets and the level budget every preset must sit inside; the timer core and the end fade that survives a volume change; the settings store and its migration; the microcopy (every state, no exclamation marks, never the word "error"); toast and announcement queues; the keyboard map; palette contrast; the scene and cat models and the cat SVG art; the icon rasteriser and the committed PNGs; the audio engine and automation against a fake Web Audio context; the service worker inside a `node:vm` host (atomic precache, cleanup of old caches, navigation handling, offline 503, SKIP_WAITING); structural site checks (relative URLs only, the precache list equals the `docs/` file set, one version in three files, manifest and head order, CSP before any script, keyframes only in `scene.css` and `cats.css`, infinite animations of at least 10 s, size budgets of 450 KB for `docs/` without icons, 48 KB per text file and 100 KB of icons); and architecture purity (`core/` has no browser globals and imports only `core/`, the other folders import only `core/` or themselves, every import is relative and ends in `.js`, and the visual modules never mention the beat, the carrier or an analyser).

`.github/workflows/test.yml` runs the same command on every push and pull request on Node 22. It is optional; delete it if you do not want Actions.

## Publish to GitHub Pages

1. Create a repository named `braintune` (public, unless your plan includes Pages for private repositories) and push `main`:

   ```sh
   git init -b main
   git add -A
   git commit -m "Brain Tune 0.1.0"
   gh repo create braintune --public --source . --push
   ```

2. On GitHub open Settings, then Pages. Under Build and deployment set Source to "Deploy from a branch", choose `main` and the `/docs` folder, and Save.
3. The site is usually live within a minute or two at `https://<your-github-user>.github.io/braintune/`; GitHub says to allow up to ten minutes. Check with `curl -I` that the page, `manifest.webmanifest` and `sw.js` return 200, and in DevTools under Application that the manifest has no installability errors and the service worker is activated.
4. `docs/.nojekyll` tells Pages to publish the folder as it is instead of running it through Jekyll.
5. **Updates.** Pages serves files with `Cache-Control: max-age=600`, a ten-minute cache. The worker precaches with `cache: 'reload'` and registers with `updateViaCache: 'none'`, so its own fetches skip that cache, and its cache name is `braintune-v<version>`, so every release replaces the old copy whole. To release, run `npm run bump -- 0.2.0`, which writes the version into `package.json`, `docs/js/version.js` and `docs/sw.js` (the site test checks the three agree), then commit and push. Open tabs see the update toast at the next hourly check or load; installed apps pick it up on the next launch.
6. **Custom domain.** Put the domain in `docs/CNAME`, the root of the publishing source, and set it under Settings, Pages. The file is excluded from the precache list and the size budgets.

## Project structure

```
braintune/
├── docs/                     the site: GitHub Pages serves this folder as-is
│   ├── index.html            one page, CSP in a meta tag, no inline script or style
│   ├── manifest.webmanifest  app identity; favicon.svg and icons/ hold the generated icons
│   ├── sw.js                 classic service worker: versioned atomic precache, cache-first
│   ├── .nojekyll             publish without Jekyll
│   ├── css/                  tokens, base, layout, components, scene, cats
│   └── js/
│       ├── boot.js           classic pre-paint script: theme and motion attributes from saved settings
│       ├── app.js            mediator: store to engine, scene, cats and UI; media queries; debug hooks
│       ├── sw-register.js    registration, update toast, hourly check, ?nosw kill switch, reset
│       ├── version.js        APP_VERSION
│       ├── core/             pure modules with no browser globals: presets, entrainment and level maths,
│       │                     gate, noise, rain, ocean and purr models, timer, state, microcopy, palette,
│       │                     scene and cat models, cat art, sweep; everything here is unit-tested
│       ├── audio/            Web Audio: graph, automation, buffers, tone, rain, ocean, purr,
│       │                     session timer, lifecycle, engine
│       ├── scene/            canvas sky, sea and rain; takes a palette, knows nothing about the beat
│       ├── cats/             arrivals, placement clear of the controls, petting
│       └── ui/               controls, orb, scroll sheet, toasts, first run, night dim, shortcuts, ui.js
├── tests/                    node:test suites and helpers (fake Web Audio, fake storage, vm worker host)
├── tools/                    serve.mjs, make-icons.mjs, bump-version.mjs, viewports.html
├── .github/workflows/        test.yml
├── package.json              scripts only, zero dependencies, "type": "module"
└── LICENSE                   MIT
```

## Troubleshooting

- **An old version will not go away.** Open the site with `?nosw`, for example `https://<your-github-user>.github.io/braintune/?nosw`. It unregisters the worker, deletes the `braintune-*` caches and reloads the plain page, where a fresh worker installs the current version. `#nosw` works too.
- **Settings in a muddle.** Settings, Reset all settings. It returns to the quiet defaults and offers Undo in a toast; the offline copy is kept, and the worker refills any shell file it finds missing while online.
- **Sound stopped** after a call, an alarm or a change of output. Tap Play again, or use "Sound stopped? Restart sound" under the status line.
- **"Tap anywhere to let sound through."** The browser is waiting for a tap before it allows sound. Tap once.
- **No beat on headphones.** Binaural tones need stereo. If your device plays Mono Audio, choose Speakers.
- **Settings do not persist.** When the browser blocks site data, About & safety says "This browser is not keeping site data, so settings last until you close the page."
- **Emergency: a published worker misbehaves.** Replace `docs/sw.js` with the worker below, publish, and leave it in place for a while. It removes the app's caches and itself from every visitor who loads the page or passes an hourly update check; `updateViaCache: 'none'` means the ten-minute Pages cache does not delay it. The site and worker tests fail while this file is in place, which is expected.

  ```js
  // docs/sw.js, emergency version: removes this app's caches and then itself.
  'use strict';
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith('braintune-')).map((name) => caches.delete(name)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) client.navigate(client.url);
    })());
  });
  ```

## License

MIT. See [LICENSE](LICENSE).
