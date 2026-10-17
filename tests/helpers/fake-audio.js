// A minimal fake Web Audio implementation for Node tests of docs/js/audio/*.
//
// createFakeAudioContext({ clock }) builds a context whose currentTime advances with the injected
// clock (seconds) only while the context is 'running', as a real context's does. resume()/suspend()/
// close() change `state`, fire 'statechange' and can be made to hang or reject through `ctx.behaviour`.
// Every node carries its `kind` and records connect/disconnect/start/stop calls; every AudioParam keeps `.value`, records its
// automation calls as { method, value, time, timeConstant } and implements the whole automation API.
// Simplification: setValueAtTime / ramps update `.value` to their target at once (the fake has no
// rendering thread), so code that reads `param.value` sees the last scheduled value.

const SAMPLE_RATE = 48000;

/** A settable clock in seconds: { now(), advance(s), set(s) }. */
export function createFakeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (s) => { t += s; }, set: (s) => { t = s; } };
}

/** An AudioParam double; `holdSupported: false` removes cancelAndHoldAtTime so the fallback path runs. */
export function createFakeParam(defaultValue, { holdSupported = true, name = 'param' } = {}) {
  const calls = [];
  const record = (method, value, time, timeConstant) => {
    calls.push(timeConstant === undefined ? { method, value, time } : { method, value, time, timeConstant });
  };
  const param = {
    name,
    calls,
    defaultValue,
    value: defaultValue,
    minValue: -3.4028234663852886e38,
    maxValue: 3.4028234663852886e38,
    setValueAtTime(value, time) {
      record('setValueAtTime', value, time);
      param.value = value;
      return param;
    },
    linearRampToValueAtTime(value, time) {
      record('linearRampToValueAtTime', value, time);
      param.value = value;
      return param;
    },
    exponentialRampToValueAtTime(value, time) {
      if (!(value > 0)) throw new RangeError(`exponentialRampToValueAtTime: value ${value} must be positive`);
      record('exponentialRampToValueAtTime', value, time);
      param.value = value;
      return param;
    },
    setTargetAtTime(value, time, timeConstant) {
      record('setTargetAtTime', value, time, timeConstant);
      param.value = value;
      return param;
    },
    cancelScheduledValues(time) {
      record('cancelScheduledValues', undefined, time);
      return param;
    },
    /** Calls of one method, oldest first. */
    callsOf(method) {
      return calls.filter((c) => c.method === method);
    },
    /** Calls recorded after index `from`. */
    since(from) {
      return calls.slice(from);
    },
  };
  if (holdSupported) {
    param.cancelAndHoldAtTime = (time) => {
      record('cancelAndHoldAtTime', undefined, time);
      return param;
    };
  }
  return param;
}

function createNode(ctx, kind, params, extra = {}) {
  const node = {
    context: ctx,
    kind,
    connections: [],
    disconnections: [],
    numberOfInputs: kind === 'oscillator' || kind === 'constant' || kind === 'bufferSource' ? 0 : 1,
    numberOfOutputs: 1,
    channelCount: 2,
    connect(target, output = 0, input = 0) {
      node.connections.push({ target, output, input });
      return target;
    },
    disconnect(target) {
      node.disconnections.push(target);
      if (target === undefined) node.connections.length = 0;
      else node.connections = node.connections.filter((c) => c.target !== target);
    },
    /** True when this node is wired (directly) into `target`. */
    isConnectedTo(target) {
      return node.connections.some((c) => c.target === target);
    },
    ...extra,
  };
  for (const [name, value] of Object.entries(params)) node[name] = createFakeParam(value, { holdSupported: ctx.holdSupported, name });
  ctx.nodes.push(node);
  return node;
}

function createSourceNode(ctx, kind, params, extra = {}) {
  const node = createNode(ctx, kind, params, {
    started: null,
    stopped: null,
    onended: null,
    start(when = ctx.currentTime) {
      if (node.started !== null) throw new Error(`InvalidStateError: ${kind} started twice`);
      node.started = when;
    },
    stop(when = ctx.currentTime) {
      if (node.started === null) throw new Error(`InvalidStateError: ${kind} stopped before start`);
      node.stopped = when;
    },
    /** Test helper: fires onended as the renderer would once the source finishes. */
    end() {
      if (typeof node.onended === 'function') node.onended({ target: node });
    },
    ...extra,
  });
  return node;
}

function createFakeBuffer(numberOfChannels, length, sampleRate) {
  const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  return {
    numberOfChannels,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (i) => channels[i],
    copyToChannel(source, channel, startInChannel = 0) {
      channels[channel].set(source.subarray(0, length - startInChannel), startInChannel);
    },
    copyFromChannel(destination, channel, startInChannel = 0) {
      destination.set(channels[channel].subarray(startInChannel, startInChannel + destination.length));
    },
  };
}

/**
 * Fake AudioContext. `behaviour.resume` is 'ok' (default), 'hang' (never settles) or 'fail' (rejects);
 * `behaviour.suspend` and `behaviour.close` accept 'ok' or 'fail'. `holdSupported: false` builds params
 * without cancelAndHoldAtTime (Firefox).
 */
export function createFakeAudioContext({ clock = createFakeClock(), sampleRate = SAMPLE_RATE, holdSupported = true, behaviour = {} } = {}) {
  let base = 0;
  let runningSince = null;
  const listeners = new Set();
  const ctx = {
    sampleRate,
    state: 'suspended',
    holdSupported,
    behaviour: { resume: 'ok', suspend: 'ok', close: 'ok', ...behaviour },
    nodes: [],
    buffers: [],
    onstatechange: null,
    baseLatency: 0.01,
    get currentTime() {
      return runningSince === null ? base : base + (clock.now() - runningSince);
    },
    addEventListener(type, fn) {
      if (type === 'statechange') listeners.add(fn);
    },
    removeEventListener(type, fn) {
      if (type === 'statechange') listeners.delete(fn);
    },
    resume() {
      if (ctx.state === 'closed') return Promise.reject(new Error('InvalidStateError: context closed'));
      if (ctx.behaviour.resume === 'hang') return new Promise(() => {});
      if (ctx.behaviour.resume === 'fail') return Promise.reject(new Error('NotAllowedError'));
      setState('running');
      return Promise.resolve();
    },
    suspend() {
      if (ctx.state === 'closed') return Promise.reject(new Error('InvalidStateError: context closed'));
      if (ctx.behaviour.suspend === 'fail') return Promise.reject(new Error('suspend failed'));
      setState('suspended');
      return Promise.resolve();
    },
    close() {
      if (ctx.behaviour.close === 'fail') return Promise.reject(new Error('close failed'));
      setState('closed');
      return Promise.resolve();
    },
    /** Test helper: an interruption or external suspension, as iOS reports it. */
    forceState(state) {
      setState(state);
    },
    createGain: () => createNode(ctx, 'gain', { gain: 1 }),
    createOscillator: () =>
      createSourceNode(ctx, 'oscillator', { frequency: 440, detune: 0 }, {
        type: 'sine',
        periodicWave: null,
        setPeriodicWave(wave) {
          this.periodicWave = wave;
          this.type = 'custom';
        },
      }),
    createConstantSource: () => createSourceNode(ctx, 'constant', { offset: 1 }),
    createBiquadFilter: () => createNode(ctx, 'biquad', { frequency: 350, Q: 1, gain: 0, detune: 0 }, { type: 'lowpass' }),
    createDynamicsCompressor: () =>
      createNode(ctx, 'compressor', { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 }, { reduction: 0 }),
    createAnalyser: () =>
      createNode(ctx, 'analyser', {}, {
        fftSize: 2048,
        get frequencyBinCount() {
          return this.fftSize / 2;
        },
        getFloatTimeDomainData(array) {
          array.fill(0);
        },
        getByteTimeDomainData(array) {
          array.fill(128);
        },
      }),
    createStereoPanner: () => createNode(ctx, 'panner', { pan: 0 }),
    createBufferSource: () => createSourceNode(ctx, 'bufferSource', { playbackRate: 1, detune: 0 }, { buffer: null, loop: false, loopStart: 0, loopEnd: 0 }),
    createBuffer(numberOfChannels, length, rate) {
      const buffer = createFakeBuffer(numberOfChannels, length, rate);
      ctx.buffers.push(buffer);
      return buffer;
    },
    createPeriodicWave: (real, imag, options = {}) => ({ real: Float32Array.from(real), imag: Float32Array.from(imag), options }),
    /** Nodes of one kind ('gain', 'oscillator', 'constant', 'biquad', 'compressor', 'analyser', 'panner', 'bufferSource', 'destination'), in creation order. */
    nodesOf(kind) {
      return ctx.nodes.filter((n) => n.kind === kind);
    },
  };
  ctx.destination = createNode(ctx, 'destination', {}, { maxChannelCount: 2 });

  function setState(state) {
    if (state === ctx.state) return;
    const now = ctx.currentTime;
    if (state === 'running') runningSince = clock.now();
    else {
      base = now;
      runningSince = null;
    }
    ctx.state = state;
    const event = { type: 'statechange', target: ctx };
    if (typeof ctx.onstatechange === 'function') ctx.onstatechange(event);
    for (const fn of [...listeners]) fn(event);
  }

  return ctx;
}

/** Returns a factory the engine accepts, remembering every context it made in `factory.contexts`. */
export function createContextFactory(options = {}) {
  const factory = () => {
    const ctx = createFakeAudioContext(options);
    factory.contexts.push(ctx);
    return ctx;
  };
  factory.contexts = [];
  return factory;
}

/** Lets pending promise callbacks run (mock timers do not drain microtasks by themselves). */
export async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve));
}
