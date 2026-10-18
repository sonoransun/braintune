# Brain Tune

Set your head straight

Brain Tune plays a soft tone that carries a slow beat in one of the classic brainwave bands, from delta to gamma, under rain and ocean that are synthesised on the spot, in front of an animated sea whose colours follow the band. Cats wander by now and then. It is one static page: vanilla HTML, CSS and ES modules, no build step, no dependencies, no accounts, no analytics. It installs as a home-screen app, works offline, and nothing leaves the device.

Live: [https://braintune.org/](https://braintune.org/) (a fork publishes at `https://<your-github-user>.github.io/braintune/`; see [Publish to GitHub Pages](#publish-to-github-pages)).

## What it does

### Three ways to make a beat

- **Binaural** (headphones). Each ear hears a slightly different tone and the difference is the beat. It needs stereo, so it is used for beats below 30 Hz when you choose Headphones.
- **Pulsing** (isochronic, speakers). One tone swells and softens at the beat rate. It works out loud and is always used from 30 Hz up, so Clarity pulses on headphones too.
- **Wavering** (monaural). Both tones are summed in the centre, so the beat is audible on anything. It is offered under Fine tuning as a Beat style.

On first run a single card asks "How are you listening right now?" with **Speakers** highlighted, and "What would help right now?" with Drift off (Sleep), Settle (Calm) and Focus; Drift off is highlighted from 20:00 to 05:59 and Settle the rest of the day. Speakers is the safe default: a binaural beat played through speakers produces no beat at all, while a pulsing tone works either way. "Let's begin" starts the chosen preset quietly. If you pick Headphones, a short check plays first: a quiet tone (−30 dBFS whatever the Volume slider says) for 1.5 seconds in the left ear, half a second of silence, then 1.5 seconds in the right, so you know the channels are the right way round; the session fades in after it. Switch any time with the mode button in the header, in Settings, or with the H key.

### Presets

A fresh start opens on Sleep with a soft tone, a moderate purr, rain and ocean on, the volume low and no timer, and Sleep starts by itself ("Play on open" in Settings). Browsers only allow sound after a tap unless their autoplay policy says otherwise, so where the browser does not report it as allowed, the scene, the glowing orb and a caption under the status, "Tap anywhere to begin Sleep", wait instead. Every control stays live: the first tap or key press anywhere starts the session and also does what it was aimed at, so a tap on another preset starts that preset. With more than a minute left on a stored timer the caption reads "Tap anywhere to continue Sleep · 12 min left". Turning Play on open off from that screen starts nothing.

A new session comes in layer by layer, by mood. The sleepy presets bring in the sea first, then the purr, the tone at 2.5 s and the rain at 4 s, all in place by 6.5 s; Meditate and Calm take 4.2 s and the alert presets 2 s. The pad's voices then enter one at a time over the first minute (see [The pad](#the-pad)).

Updating from 0.3 keeps your preset, timers, Play on open choice, fine tuning, Rainfall and Sea, mutes, volume and any stored session, along with your listening choice, theme and cat count. A Sleep or Deep sleep layer mix still on its 0.3 values moves to the new one; a mix you set yourself stays.

**Deep sleep** is the extra-low setting: a 1 Hz beat reached by a slow glide from 3 Hz, on A2 = 110 Hz on headphones (near the lowest carrier binaural beats allow) and 176 Hz through desktop speakers, with the pad's sub an octave lower at 55 Hz, largely below hearing at the default volume. Its Amber timbre is rich in octaves (strong second and fourth partials), chosen so the pitch can still be heard on small speakers, which reproduce those partials better than the fundamental. Phone speakers cannot reproduce that range, so on a phone through speakers the carrier lifts to 400 Hz while the beat stays at 1 Hz.

| Preset | Band | Beat | Carrier, headphones / speakers | Timbre | Layers on | Timer | For |
|---|---|---|---|---|---|---|---|
| Sleep | delta | 2 Hz, starting at 6 Hz and gliding down over 12 min | 198 / 440 Hz | Velvet | rain, ocean, purr | ∞ | drifting off; the default |
| Deep sleep | delta | 1 Hz, starting at 3 Hz and gliding down over 20 min | 110 / 176 Hz, with a 55 Hz sub beneath | Amber | rain, ocean, purr | ∞ | the deepest, slowest setting |
| Rest | delta | 3.5 Hz | 220 / 440 Hz | Velvet | rain, ocean, purr | ∞ | winding down |
| Meditate | theta | 6 Hz | 264 / 440 Hz | Bell | rain, ocean, purr | ∞ | sitting quietly |
| Cat nap | theta | 5.5 Hz | 220 / 440 Hz | Velvet | rain, purr (the most purr) | ∞ | a short doze |
| Calm | alpha | 10 Hz | 264 / 440 Hz | Velvet | rain, ocean, purr | ∞ | settling |
| Focus | beta | 15 Hz | 330 / 528 Hz | Glass | rain, purr | ∞ | steady work |
| Energise | beta | 20 Hz | 440 / 660 Hz | Amber | rain, ocean, purr | ∞ | getting going |
| Clarity | gamma | 40 Hz | 440 / 528 Hz, pulsing on both | Warm | rain, purr | ∞ | alert work |

The table is `docs/js/core/presets.js`. Every carrier sits on one just-intoned grid over A = 110 Hz (198 Hz is G3, 264 Hz C4, 440 Hz A4), so the carrier, the pad and the chime share one harmonic series; no particular key or frequency is claimed to be special. Each preset also sets whether the pad plays, its end fade (20 to 90 s) and whether a soft chime closes the session (Meditate, Focus, Energise and Clarity). In Sleep, Deep sleep, Rest and Cat nap the pulsing tone is gentler: at beats up to 12 Hz its dips are about 8 dB deep instead of about 16. Keys 1 to 9 pick presets in this order. On a touch device playing through speakers the carrier never drops below 400 Hz, because small speakers reproduce little beneath it.

### Fine tuning

A collapsed section below the timer. Any change here turns the preset chip to Custom; choosing a preset clears it again.

- **Beat** 0.5 to 40 Hz in 0.5 Hz steps (Shift moves 5 Hz). From 30 Hz up the beat is always Pulsing, and a note says that at 40 Hz the pulse is a fast flutter by nature.
- **Pitch** 120 to 800 Hz with a note name: "264 Hz · C4" on the just grid, otherwise the nearest equal-tempered note, for example "256 Hz · near C4". Pitch carries the beat and does not change the tuning.
- **Timbre** Sine, Velvet, Warm, Amber, Glass or Bell. Sine is plain, Velvet and Warm are rounder, Amber is octave-rich, Glass and Bell are sparse and clear.
- **Pad** a quiet octave and fifth above the tone and a sub below it, in pure ratios (see [The pad](#the-pad)).
- **Pad style** Auto, Drone or Canon. Drone holds the harmony and lets it breathe; Canon adds two slow voices that answer each other (see [Canon](#canon)). Auto uses Canon in Meditate and Calm and Drone everywhere else. The Pad switch still turns the whole pad off.
- **Beat style** Auto, Binaural, Wavering or Pulsing.
- **Rainfall** drizzle, steady, heavy or downpour: how hard the rain falls. The Rain slider in Mix sets how loud it is, and the rain on screen follows this setting.
- **Sea** glassy, gentle, rolling or heavy swell: how big the waves are, on screen and in the sound. The Ocean slider sets how loud they are.
- **Find your pitch** while sound plays, the pitch sweeps slowly between 180 and 520 Hz, a minute each way. Tap the orb when it feels right and that pitch is kept. "Never mind" or Esc cancels.

### The pad

The pad is up to five quiet voices under and over the tone, each a whole-number multiple of the lowest one: a sub an octave below, the fifth (1.5 times the carrier), the octave, the twelfth (an octave and a fifth) and the double octave. Which of them sound depends on the pitch. Below 240 Hz a fifth above the tone would rub: the two sit less than about 120 Hz apart, within one critical band, where Plomp and Levelt (1965) found pairs of tones sound rough, so low pitches take the twelfth instead; below 150 Hz the double octave fills in, a choice made for fullness. In Sethares's roughness model the low voicings come out at about 0.2 to 0.5 times the roughness of the 0.3 pad, depending on the weighting, and the tests hold them under 0.6. A change of register crossfades over 6 seconds. At the start of a session the voices enter one at a time: the octave with the tone, the fifth or the twelfth 12 seconds later, the sub after 24 seconds and the double octave after 40.

The pad no longer wobbles on two fixed slow cycles. Its level drifts between full and 3 dB below along a random 1/f ("pink") curve, the kind of fluctuation Voss and Clarke (1975) measured in the loudness of music, with a new target every 4 to 8 seconds reached over a couple of seconds, and its brightness drifts along a slower fractal curve. It never rises above its nominal level, nothing in it repeats, and it stays far slower and shallower than any beat. Whether this sounds more pleasant is a matter of listening, not a claim.

### Canon

With Pad style on Canon (Auto does this in Meditate and Calm), the pad's upper voices give way to two slow voices that sing a round. The leader draws a short subject of 5 to 8 notes from a five-note just scale on the carrier (1, 5/4, 4/3, 3/2 and 5/3, repeated over the octaves) by a 1/f walk of small steps; the follower imitates it 2 or 3 notes later, at the same pitch or an octave lower (below a 240 Hz carrier it keeps to the leader's octave, so no canon note falls within a critical band of the beat tones), and from the second episode on sometimes upside down, slower or sooner (inversion, augmentation, stretto). Every pair of notes heard together forms a consonant interval: a third, a fourth, a fifth, a sixth or an octave. A subject that would break the rule is drawn again, and if that keeps failing the leader sings alone for that episode. Each note lasts 7 to 12 seconds (twice that when the follower slows down), each phrase swells in over 2.5 seconds, episodes are separated by 10 to 30 seconds of rest, the first begins 20 to 40 seconds into the session, and no note goes above 1200 Hz. Both voices are the same in both ears and exact ratios of the carrier, so the beat is untouched, and they take over the level of the pad voices they replace, so the overall level is unchanged. Canon needs the pad: with Pad style on Canon, Focus and Energise play it only once you turn their pad on, and Clarity never does.

## Rain, ocean and cats

Every sound is generated in the browser when you press play. There are no audio files. Rain is filtered noise with individual drops; the ocean is a slow surf bed with waves that swell, crash and wash out, and every crash rolls a wave across the scene; the purr is a 26 Hz rumble shaped by a breath cycle. Rain comes and goes in gusts that drift over about a minute, the sea arrives in sets of larger waves with lulls between, the purr slowly changes pace, and the pad under the tone breathes slowly and never on a fixed cycle. The gusts and the surf follow slow fractal curves, and the sets follow three slow cycles of about 70, 113 and 183 seconds in golden-ratio proportion, mixed with a slower random drift, so the pattern never quite repeats. The sets are a sound-design reading of how ocean swell groups into sets (Longuet-Higgins 1984, Goda 2010), not a simulation; they only ever make waves smaller than the usual peak, never bigger, so the level limits still hold.

**Mix.** A Volume slider, then Tone, Rain, Ocean and Purr, each with a mute button. Presets set the sliders and also how heavy the rain falls and how big the waves are; those two live under Fine tuning as Rainfall and Sea. The sliders set how loud each layer is. The Purr row carries its own note: "A low purr near 26 Hz, there for comfort. It plays no part in the beat." Every preset purrs; Cat nap purrs most.

**The scene.** The sea's colours follow the band, under a limb-shaded moon, or a sun in the Light theme, with a mist on the horizon and paler far waves. The light lays a reflection pillar on the water, and on the higher quality tiers a glitter path of brief glints whose timing follows a 1/f process: random one-shots of 1.6 to 3.4 seconds, at most three new ones a second, never a rhythm. The picture answers the sound only through the slow textures: the horizon glow follows the pad's breathing, the haze the rain's gusts and the near swell the ocean's sets, each by less than a hundredth of brightness and at most once a second.

**Cats.** Now and then a cat arrives along the bottom edge: black, orange tabby, grey, calico or tuxedo (black with a white bib, socks and muzzle); sitting, loafing, sleeping, walking across, or peeking in over the ledge with only its head and paws showing. Cats come in company: the first visit comes 4 to 9 seconds into a session and brings a friend a moment later, so two or more are usually about; later visits come every 20 seconds to a minute, with longer gaps when nothing is playing and shorter ones during Cat nap. During Sleep, Deep sleep, Rest and Cat nap sessions more of them doze and loaf, though four in ten still walk. Walking cats chase each other across with a little hop, and now and then one gets the zoomies and dashes past. Settled cats are never quite still: every few seconds one looks around, flicks its tail, twitches an ear, grooms or stretches, and sometimes pounces to a new spot along the ledge; sleepers only twitch an ear. Up to three are present at once, two on narrow screens. While a purr is audible, two large cell-shaded cats also frolic quietly in the background behind the controls (batting a ball of yarn, swishing tails, kneading, now and then a hop, a stretch or a pounce); in the sleepy presets they lie or sit instead, act less often, never pounce and swish their tails at half speed. They fade in with the purr, fade out when it stops, rest in Still mode, and hide with Scene off or Cats off. Tap or click a cat to pet it: it narrows its eyes, hearts rise, a short purr sounds if you are playing, and it stays a little longer. Press C to pet the newest cat, or to call one when none is about. About & safety keeps a count of cats spotted, with a small toast at 1, 10, 25, 50 and 100. Cats always sit beneath the controls and never cover them.

**Turning things off.** Rain, Ocean or Purr: slide to zero or tap mute (M mutes everything, again restores). Cats: Settings, Cats. The animated sea: Settings, More settings, Scene, Off. Motion only: Settings, Still mode. To keep the ambience after the tone has finished, choose "After the timer: Keep rain and ocean".

## Reassuring by design

- **Quiet by default.** Volume starts at 45 %. At every preset's defaults the tone peaks between about −30 and −40 dBFS (Sleep and Deep sleep are the softest), the pad stays at least 7.5 dB under the tone, and everything together, pad included, peaks below −19 dBFS; the tests hold every preset's tone between −42 and −26. A limiter and a −1 dBFS ceiling mean nothing clips even with every slider at the top.
- **Long fades.** Play fades in over 1.5 s while the layers enter one by one, pause over 0.6 s, stop over 2 s; preset changes glide over about 2 s; every slider move is a ramp. The timer ends with the preset's 20 to 90 s fade and, where set, a soft two-note chime at the session's own pitch (the octave and the twelfth of the carrier, an octave lower when they would pass 1 kHz). The chime follows the Volume slider and is about 14 dB quieter at the default volume than in 0.3.
- **One rhythm.** Apart from the purr's low rumble, only the beat keeps a steady rhythm; the slow textures never settle into a cycle.
- **No modals** except the first-run card. Everything else is a toast or an inline note. A plain veil, "Tap anywhere to let sound through", appears only when the browser blocks sound until a tap, and "Sound paused while you were away. Tap to continue." after an interruption.
- **Timer.** Every preset plays until you stop it (∞) by default. The long choices come first, 12 h, 6 h and 2 h, then 10, 15, 20, 30, 45, 60 or 90 minutes, or Custom from 1 minute to 12 hours. The choice is remembered per preset. "After the timer" is Fade out or Keep rain and ocean. Quiet announcements at five minutes and one minute. If you reload with more than a minute left, Play on open offers to continue it; with Play on open off, a toast offers "Resume your session? 12 min left". Nothing plays until you tap.
- **Night dim.** In Sleep, Deep sleep and Rest the screen dims after a minute of stillness and settles further after five. After a minute the controls fade to 30 %, the scene to 55 % and the cats to 70 %; after five minutes the controls settle to 20 %, the scene to 35 % and the cats to 30 %, and then the scene stops drawing and keeps its last frame. Any touch or key restores everything at once. A notice that would stay on screen, such as an update, waits for your next touch during a sleepy session or the dim. On by default; off in Settings.
- **Still mode** stops the waves, the rain streaks, the glints and walking cats. By default it follows your device's reduced-motion setting, live.
- **Scene off** removes the animated sky and sea. Nothing on screen is driven by the beat or the carrier, nothing flashes, and no periodic change of colour or brightness is faster than ten seconds. The only quicker movement is a cat's tail or walk and the random glints on the water, and Still mode stops those.
- **Theme** dark by default, with Light and Auto.
- **Settings** shows Listening, Cats, Play on open, Theme, Still mode, Night dim and Keyboard shortcuts; More settings holds Scene, Keep screen awake, Haptics, Add to home screen and Reset all settings.
- **Settings persist** in this browser and nothing leaves the device: the page's content security policy allows only its own origin, there are no requests after load, no analytics and no accounts.

Keyboard shortcuts (a switch in Settings turns them off):

| Key | Does |
|---|---|
| Space or K | Play or pause, when focus is not on a control |
| 1 to 9 | Choose a preset, in table order |
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

- **Add to Home Screen.** In Safari on iPhone or iPad: Share, then Add to Home Screen. On Android, Chrome offers Install app or Add to Home screen, and Brain Tune shows an Install button under More settings when the browser allows it. Desktop Chrome and Edge show an install icon in the address bar.
- **Offline after the first visit.** A service worker stores the whole app on first load and shows "Brain Tune works offline now." Later visits load from that copy. New versions are fetched in the background and offered with "A gentle update is ready. Reload when you like."
- **Separate storage.** On iOS a home-screen web app has its own storage, apart from the Safari tab, so each keeps its own settings, cat count and offline copy.
- **Safari and unused sites.** WebKit documents that Safari may delete a site's script-writable storage, which includes these settings and the offline copy, after seven days of Safari use without interaction with the site. A home-screen web app keeps its own counter of days of use, so WebKit does not expect its data to be removed this way. If your settings reset after a long break, this is the likely cause.

## Platform notes

About & safety shows one of these blocks, chosen by feature detection only; no behaviour depends on the choice.

**iPhone and iPad.** Brain Tune asks iOS to treat it like music, so it keeps playing when the screen locks and with the silent switch on (this pauses other apps' audio). If sound stops after a call or alarm, tap Play again or use Restart sound.

**Android.** Brain Tune keeps playing while you switch apps. There is no lock-screen control for this kind of audio — open Brain Tune to pause. If sound stops when the screen turns off, turn on Keep screen awake.

**Desktop.** Works in a background tab. Keep screen awake stops the display sleeping.

**Everywhere.** Binaural needs headphones; on speakers Brain Tune uses a pulsing tone.

There are no lock-screen or media-key controls in this version. Web Audio on its own does not get a media notification, and Brain Tune uses no undocumented workarounds to obtain one. Open the app to pause. "Keep screen awake" appears only where the browser supports the Screen Wake Lock API and is off by default. No audio context is created before your first tap or key press; when Play on open is on or a session can be resumed, only the rain, sea and purr loops are prepared in advance, so the first layers can start without waiting for them. Once sound has played for 20 seconds, a quiet "Restart sound" link appears under the status line; it rebuilds the audio graph from your current settings.

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

The suite uses `node:test` with zero dependencies and needs Node 22.5 or newer. It runs in about a second. It covers the pure maths and DSP (seeded random, noise spectra measured with Goertzel, biquads, levels, timbres, the gate, entrainment ranges, the attune sweep); the pad's register voicing, its roughness against 0.3 and a guard that no pad partial lands near a beat voice; the fractal generators (their spectra, smoothness and slowest rates), the texture plans and the entrance plans; the canon's counterpoint rules over thousands of episodes; the glitter pacing; the presets and the level budget every preset must sit inside, pad included; the timer core, the chime and the end fade that survives a volume change; the settings store, its migration and the resume plan; the microcopy (every state, no exclamation marks, never the word "error"); toast and announcement queues and the night-dim stages; the keyboard map; palette contrast; the scene and cat models and the cat SVG art; the icon rasteriser and the committed PNGs; the audio engine, automation, texture and canon layers against a fake Web Audio context, including that the slow textures never touch the beat's own parameters; the service worker inside a `node:vm` host (atomic precache, cleanup of old caches, navigation handling, offline 503, SKIP_WAITING); structural site checks (relative URLs only, the precache list equals the `docs/` file set, one version in three files, manifest and head order, CSP before any script, the page's copy matching the microcopy, keyframes only in `scene.css` and `cats.css`, infinite animations of at least 10 s, size budgets of 512 KB for `docs/` without icons, 48 KB per text file and 100 KB of icons); and architecture purity (`core/` has no browser globals and imports only `core/`, the other folders import only `core/` or themselves, every import is relative and ends in `.js`, and the visual modules never mention the beat, the carrier or an analyser).

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
│       │                     pad voicing, gate, noise, fractal and texture models, rain, ocean and purr
│       │                     models, entrance plans, canon, timer, state, microcopy, palette, scene,
│       │                     glitter and cat models, cat art, night-dim stages, sweep; all unit-tested
│       ├── audio/            Web Audio: graph, automation, buffers, tone, texture, canon, rain, ocean,
│       │                     purr, session timer, lifecycle, engine
│       ├── scene/            canvas sky, sea, rain and glitter; takes a palette and slow textures,
│       │                     knows nothing about the beat
│       ├── cats/             arrivals, placement clear of the controls, petting, the background pair
│       └── ui/               controls, orb, scroll sheet, toasts, first run, night dim, shortcuts, ui.js
├── tests/                    node:test suites and helpers (fake Web Audio, fake storage, vm worker host)
├── tools/                    serve.mjs, make-icons.mjs, bump-version.mjs, viewports.html
├── .github/workflows/        test.yml
├── package.json              scripts only, zero dependencies, "type": "module"
└── LICENSE                   MIT
```

## Troubleshooting

- **An old version will not go away.** Open the site with `?nosw`, for example `https://<your-github-user>.github.io/braintune/?nosw`. It unregisters the worker, deletes the `braintune-*` caches and reloads the plain page, where a fresh worker installs the current version. `#nosw` works too.
- **Settings in a muddle.** Settings, More settings, Reset all settings. It returns to the quiet defaults and offers Undo in a toast; the offline copy is kept, and the worker refills any shell file it finds missing while online.
- **Sound stopped** after a call, an alarm or a change of output. Tap Play again, or use "Restart sound" under the status line (it appears once sound has played for 20 seconds).
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
