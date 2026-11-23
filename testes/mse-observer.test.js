const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'mse-observer.js'), 'utf8');

class EventTargetFixture {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) {
      listener({ ...event, type, target: event.target || this });
    }
  }
}

function box(type, payload = Buffer.alloc(0)) {
  const bytes = Buffer.alloc(8 + payload.length);
  bytes.writeUInt32BE(bytes.length, 0);
  bytes.write(type, 4, 4, 'ascii');
  payload.copy(bytes, 8);
  return new Uint8Array(bytes);
}

const initSegment = () => Buffer.concat([Buffer.from(box('ftyp')), Buffer.from(box('moov'))]);
const mediaSegment = (sequence = 0) => {
  const sample = Buffer.from([sequence & 0xff]);
  return Buffer.concat([Buffer.from(box('moof', sample)), Buffer.from(box('mdat', sample))]);
};

function setup({ duration = 2, ranges = [[0, 2]], pathname = '/p/post-1' } = {}) {
  const pageListeners = new Map();
  const documentListeners = new Map();
  const videos = [];
  const responses = [];
  let objectUrlId = 0;
  let now = 0;

  class FakeSourceBuffer extends EventTargetFixture {
    constructor(bufferedRanges) {
      super();
      this.mode = 'segments';
      this.timestampOffset = 0;
      this.appendWindowStart = 0;
      this.appendWindowEnd = Infinity;
      this.updating = false;
      this.appended = [];
      this.bufferedRanges = bufferedRanges;
    }
    get buffered() {
      const current = this.bufferedRanges;
      return {
        length: current.length,
        start: index => current[index][0],
        end: index => current[index][1],
      };
    }
    appendBuffer(input) {
      if (this.updating) throw new Error('InvalidStateError');
      this.updating = true;
      this.appended.push(input.byteLength);
      queueMicrotask(() => {
        this.updating = false;
        this.dispatch('updateend');
      });
    }
  }

  class FakeMediaSource {
    constructor() { this.sourceBuffers = []; }
    addSourceBuffer(mime) {
      const buffer = new FakeSourceBuffer(ranges);
      buffer.mime = mime;
      this.sourceBuffers.push(buffer);
      return buffer;
    }
  }

  class FakeMediaElement extends EventTargetFixture {
    constructor(src) {
      super();
      this.currentSrc = src;
      this.src = src;
      this.duration = duration;
      this.mediaKeys = null;
      this.isConnected = true;
    }
  }

  class FakeURL {
    static createObjectURL() { return `blob:media-collector-${++objectUrlId}`; }
  }

  const document = {
    documentElement: {},
    addEventListener(type, listener) {
      const listeners = documentListeners.get(type) || [];
      listeners.push(listener);
      documentListeners.set(type, listeners);
    },
    querySelectorAll(selector) { return selector === 'video' ? videos : []; },
    dispatch(type, target) {
      for (const listener of documentListeners.get(type) || []) listener({ type, target });
    },
  };
  const location = { pathname, origin: 'https://www.instagram.com' };
  const fakeWindow = { postMessage: data => responses.push(data) };
  const context = vm.createContext({
    URL: FakeURL,
    MediaSource: FakeMediaSource,
    SourceBuffer: FakeSourceBuffer,
    HTMLMediaElement: FakeMediaElement,
    document,
    location,
    Date: { now: () => now },
    MutationObserver: class { observe() {} },
    addEventListener(type, listener) {
      const listeners = pageListeners.get(type) || [];
      listeners.push(listener);
      pageListeners.set(type, listeners);
    },
    setInterval() { return 1; },
    clearInterval() {},
  });
  context.window = fakeWindow;
  vm.runInContext(source, context, { filename: 'mse-observer.js' });

  const mediaSource = new FakeMediaSource();
  // Use the wrapped URL method so the observer records the MediaSource.
  const recordedBlob = context.URL.createObjectURL(mediaSource);
  const video = new FakeMediaElement(recordedBlob);
  videos.push(video);

  return {
    blob: recordedBlob,
    context,
    document,
    mediaSource,
    video,
    location,
    async request(overrides = {}) {
      const before = responses.length;
      const event = {
        source: fakeWindow,
        data: {
          channel: 'media-collector-mse-request',
          id: `request-${before + 1}`,
          blob: recordedBlob,
          pathname: location.pathname,
          ...overrides,
        },
      };
      for (const listener of pageListeners.get('message') || []) listener(event);
      return responses.at(-1);
    },
    async settle() { await new Promise(resolve => setTimeout(resolve, 0)); },
    advanceTime(milliseconds) { now += milliseconds; },
  };
}

async function append(page, buffer, bytes, bufferedRanges) {
  if (bufferedRanges) buffer.bufferedRanges = bufferedRanges;
  buffer.appendBuffer(bytes);
  await page.settle();
}

test('captura segmentos MP4 completos e mantém os bytes da trilha de vídeo', async () => {
  const page = setup();
  const buffer = page.mediaSource.addSourceBuffer('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
  const init = initSegment();
  const media = mediaSegment();
  await append(page, buffer, init);
  await append(page, buffer, media);

  const result = await page.request();
  assert.equal(result.duration, 2);
  assert.equal(result.tracks.length, 1);
  assert.equal(result.tracks[0].mime, 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
  assert.deepEqual(Buffer.from(result.tracks[0].chunks[0]), init);
  assert.deepEqual(Buffer.from(result.tracks[0].chunks[1]), media);
});

test('captura vídeo e áudio em SourceBuffers separados na ordem esperada pelo processador', async () => {
  const page = setup();
  const video = page.mediaSource.addSourceBuffer('video/mp4; codecs="avc1.42E01E"');
  const audio = page.mediaSource.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
  await append(page, video, initSegment());
  await append(page, video, mediaSegment());
  await append(page, audio, initSegment());
  await append(page, audio, mediaSegment());

  const result = await page.request();
  assert.deepEqual(Array.from(result.tracks, track => track.mime.split('/')[0]), ['video', 'audio']);
  assert.ok(result.tracks.every(track => track.chunks.length === 2));
});

test('aguarda quando a cobertura ainda não alcança a duração do player', async () => {
  const page = setup({ duration: 4, ranges: [[0, 2.5]] });
  const buffer = page.mediaSource.addSourceBuffer('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
  await append(page, buffer, initSegment());
  await append(page, buffer, mediaSegment());

  const result = await page.request();
  assert.equal(result.retry, true);
  assert.match(result.error, /todos os trechos/);
  assert.equal(result.tracks, undefined);
});

test('não declara completa uma transmissão com lacuna temporal entre buffers', async () => {
  const page = setup({ duration: 2, ranges: [[0, 0.8], [1.2, 2]] });
  const buffer = page.mediaSource.addSourceBuffer('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
  await append(page, buffer, initSegment());
  await append(page, buffer, mediaSegment());

  const result = await page.request();
  assert.equal(result.retry, true);
  assert.match(result.error, /todos os trechos/);
});

test('mantém a cobertura e os bytes já capturados quando o player remove ranges antigos', async () => {
  const page = setup({ duration: 3, ranges: [[0, 1]] });
  const buffer = page.mediaSource.addSourceBuffer('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
  const init = initSegment();
  const first = mediaSegment(1);
  const second = mediaSegment(2);
  const third = mediaSegment(3);
  await append(page, buffer, init, [[0, 1]]);
  await append(page, buffer, first, [[0, 1]]);
  await append(page, buffer, second, [[1, 2]]);
  await append(page, buffer, third, [[2, 3]]);

  const result = await page.request();
  assert.equal(result.tracks.length, 1);
  assert.equal(result.tracks[0].chunks.length, 4);
  assert.deepEqual(Buffer.from(result.tracks[0].chunks[1]), first);
  assert.deepEqual(Buffer.from(result.tracks[0].chunks[2]), second);
  assert.deepEqual(Buffer.from(result.tracks[0].chunks[3]), third);
});

test('ignora repetições confirmadas de init e fragmento no modo segments', async () => {
  const page = setup();
  const buffer = page.mediaSource.addSourceBuffer('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
  const init = initSegment();
  const media = mediaSegment();
  for (const bytes of [init, init, media, media]) await append(page, buffer, bytes);

  const result = await page.request();
  assert.equal(result.tracks[0].chunks.length, 2);
  assert.deepEqual(Buffer.from(result.tracks[0].chunks[0]), init);
  assert.deepEqual(Buffer.from(result.tracks[0].chunks[1]), media);
});

test('marca como falha um fragmento interrompido antes da confirmação', async () => {
  const page = setup();
  const buffer = page.mediaSource.addSourceBuffer('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
  buffer.appendBuffer(initSegment());
  buffer.dispatch('abort');
  await page.settle();

  const result = await page.request();
  assert.match(result.error, /interrompeu a leitura/);
  assert.equal(result.tracks, undefined);
});

test('não aceita um fragmento acima do limite de memória por captura', async () => {
  const page = setup();
  const buffer = page.mediaSource.addSourceBuffer('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
  await append(page, buffer, initSegment());
  await append(page, buffer, mediaSegment());
  const oversized = Buffer.alloc(48 * 1024 * 1024 + 1);
  await append(page, buffer, oversized);

  const result = await page.request();
  assert.match(result.error, /limite de memória/);
  assert.equal(result.tracks, undefined);
});

test('expira a captura local depois do TTL e informa que os trechos venceram', async () => {
  const page = setup();
  const buffer = page.mediaSource.addSourceBuffer('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
  await append(page, buffer, initSegment());
  await append(page, buffer, mediaSegment(1));
  page.advanceTime(180001);

  const result = await page.request();
  assert.match(result.error, /trechos guardados expiraram/);
  assert.equal(result.tracks, undefined);
});

test('rejeita a captura se o post muda ou se o player usa mediaKeys', async () => {
  const changed = setup();
  const wrongPost = await changed.request({ pathname: '/p/other-post' });
  assert.match(wrongPost.error, /mudou durante a captura/);

  const protectedPage = setup();
  protectedPage.video.mediaKeys = {};
  const protectedResult = await protectedPage.request();
  assert.match(protectedResult.error, /proteção/);

  const replaced = setup();
  replaced.video.currentSrc = 'blob:replacement-player';
  const replacedResult = await replaced.request();
  assert.match(replacedResult.error, /player mudou/);
});
