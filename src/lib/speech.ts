// Offline dictation via Vosk (a WASM build of Kaldi — github.com/ccoreilly/vosk-browser).
//
// Everything here is reached through a dynamic import. vosk-browser is ~5.6 MB
// on its own because it inlines both its worker and the Kaldi WASM as base64,
// and none of that belongs in the bundle every user downloads for a button most
// sessions never press.
//
// Recognition needs a language model: a ~40 MB gzipped tar, fetched once, kept
// in Cache Storage and handed to Vosk as a blob URL. So the download happens on
// the first dictation per language per device and never again — after that,
// dictation works with no network at all, which is the whole reason for picking
// Vosk over a cloud recogniser.

import type { Language } from "./i18n";

type ModelSpec = {
  url: string;
  /** Fallback for the progress bar when the host sends no content-length. */
  bytes: number;
};

// Hosted by the vosk-browser author, correct format, and CORS-open. Override
// VITE_VOSK_MODEL_URL_EN to serve it from somewhere you control instead.
const DEFAULT_EN_MODEL =
  "https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz";

const PL_MODEL_URL = (import.meta.env.VITE_VOSK_MODEL_URL_PL as string | undefined) || "";

const MODELS: Record<Language, ModelSpec | null> = {
  en: {
    url: (import.meta.env.VITE_VOSK_MODEL_URL_EN as string | undefined) || DEFAULT_EN_MODEL,
    bytes: 41_184_862,
  },
  // Vosk publishes a Polish model, but only as a .zip, and vosk-browser wants a
  // tar — so it has to be repacked and self-hosted (docs/VOICE_INPUT.md has the
  // recipe and the verified checksum). Until VITE_VOSK_MODEL_URL_PL points at
  // one the mic stays hidden in Polish, rather than running Polish speech
  // through an English acoustic model.
  pl: PL_MODEL_URL ? { url: PL_MODEL_URL, bytes: 52_980_237 } : null,
};

/** Stop this long after the recogniser last picked up a word. */
const SILENCE_MS = 2_000;
/** Give up when the first word never arrives at all. */
const NO_SPEECH_MS = 8_000;
/** Ceiling, in case a session is left running in a pocket. */
const MAX_SESSION_MS = 60_000;
/** How long to wait for the decoder's flushed tail after we stop feeding it. */
const FLUSH_MS = 700;
/** The loaded model holds ~50 MB in its worker — let it go once it's idle. */
const MODEL_IDLE_RELEASE_MS = 3 * 60_000;

const MODEL_CACHE = "ff-vosk-models-v1";

export type DictationErrorKind =
  /** getUserMedia was refused or no mic exists. */
  | "permission"
  /** The model couldn't be fetched. */
  | "download"
  /** No model for this language, or the browser can't run Vosk. */
  | "unsupported"
  /** Vosk itself failed to start. */
  | "engine";

export class DictationError extends Error {
  constructor(readonly kind: DictationErrorKind) {
    super(kind);
    this.name = "DictationError";
  }
}

type VoskModel = Awaited<ReturnType<typeof import("vosk-browser").createModel>>;

type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext };

function audioContextCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext ?? null;
}

export function modelFor(lang: Language): ModelSpec | null {
  return MODELS[lang] ?? null;
}

/** Whether the mic button should exist at all for this language + browser. */
export function isDictationAvailable(lang: Language): boolean {
  if (typeof window === "undefined") return false;
  if (!modelFor(lang)) return false;
  if (!navigator.mediaDevices?.getUserMedia) return false;
  if (typeof WebAssembly === "undefined") return false;
  return !!audioContextCtor();
}

/** Approximate download size, for warning about the one-time fetch. */
export function modelSizeMb(lang: Language): number {
  const spec = modelFor(lang);
  return spec ? Math.round(spec.bytes / 1_000_000) : 0;
}

// ---------------------------------------------------------------------------
// Model loading
// ---------------------------------------------------------------------------

let loaded: { lang: Language; model: VoskModel } | null = null;
let loading: { lang: Language; promise: Promise<VoskModel> } | null = null;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;

function cancelRelease() {
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
}

function scheduleRelease() {
  cancelRelease();
  releaseTimer = setTimeout(() => {
    releaseTimer = null;
    if (!loaded) return;
    try {
      loaded.model.terminate();
    } catch {
      /* worker already gone */
    }
    loaded = null;
  }, MODEL_IDLE_RELEASE_MS);
}

async function openModelCache(): Promise<Cache | null> {
  // Absent in private mode and on insecure origins; the model then re-downloads
  // every session, which is worth it over failing outright.
  try {
    return typeof caches === "undefined" ? null : await caches.open(MODEL_CACHE);
  } catch {
    return null;
  }
}

/** True once the model is on the device, so the UI can skip the size warning. */
export async function isModelCached(lang: Language): Promise<boolean> {
  if (loaded?.lang === lang) return true;
  const spec = modelFor(lang);
  if (!spec) return false;
  const cache = await openModelCache();
  if (!cache) return false;
  try {
    return !!(await cache.match(spec.url));
  } catch {
    return false;
  }
}

async function fetchModel(spec: ModelSpec, onProgress: (fraction: number) => void): Promise<Blob> {
  const cache = await openModelCache();
  if (cache) {
    try {
      const hit = await cache.match(spec.url);
      if (hit) return await hit.blob();
    } catch {
      /* fall through to the network */
    }
  }

  let res: Response;
  try {
    res = await fetch(spec.url);
  } catch {
    throw new DictationError("download");
  }
  if (!res.ok) throw new DictationError("download");

  const total = Number(res.headers.get("content-length")) || spec.bytes;
  const reader = res.body?.getReader();

  let blob: Blob;
  if (!reader) {
    // No streaming support: same result, just no progress to report.
    blob = await res.blob();
  } else {
    const chunks: BlobPart[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value as BlobPart);
      received += value.byteLength;
      onProgress(Math.min(0.99, received / total));
    }
    blob = new Blob(chunks, { type: "application/gzip" });
  }

  try {
    await cache?.put(spec.url, new Response(blob));
  } catch {
    // Over quota, most likely. The model still works this session.
  }
  return blob;
}

async function getModel(
  lang: Language,
  onProgress: (fraction: number) => void,
): Promise<VoskModel> {
  cancelRelease();
  if (loaded?.lang === lang) return loaded.model;
  if (loading?.lang === lang) return loading.promise;

  if (loaded) {
    // Language switched — the old model is dead weight.
    try {
      loaded.model.terminate();
    } catch {
      /* already gone */
    }
    loaded = null;
  }

  const spec = modelFor(lang);
  if (!spec) throw new DictationError("unsupported");

  const promise = (async () => {
    const { createModel } = await import("vosk-browser");
    const blob = await fetchModel(spec, onProgress);
    onProgress(1);

    const blobUrl = URL.createObjectURL(blob);
    let model: VoskModel;
    try {
      model = await createModel(blobUrl);
    } catch {
      throw new DictationError("engine");
    } finally {
      // createModel resolves only once the worker has unpacked the archive, so
      // the blob has served its purpose by here.
      URL.revokeObjectURL(blobUrl);
    }
    loaded = { lang, model };
    return model;
  })();

  loading = { lang, promise };
  try {
    return await promise;
  } finally {
    loading = null;
  }
}

// ---------------------------------------------------------------------------
// Dictation session
// ---------------------------------------------------------------------------

export type DictationCallbacks = {
  /** Model download progress, 0–1. Only ever fires on the first use per language. */
  onProgress?: (fraction: number) => void;
  /** The mic is live and Vosk is decoding. */
  onListening?: () => void;
  /** Best transcript so far. Replaces whatever the last call produced. */
  onPartial?: (text: string) => void;
  /** Everything heard, delivered exactly once. Empty when nothing was said. */
  onFinal: (text: string) => void;
  onError: (error: DictationError) => void;
};

export type Dictation = {
  /** Stops early. Safe at any point, including mid-download. */
  stop: () => void;
};

/**
 * Starts listening and returns immediately, so the caller can cancel while the
 * model is still downloading. The session ends on its own once the recogniser
 * has been quiet for SILENCE_MS.
 */
export function startDictation(lang: Language, cb: DictationCallbacks): Dictation {
  let cancelled = false;
  let stopSession: (() => void) | null = null;

  void (async () => {
    try {
      const model = await getModel(lang, cb.onProgress ?? (() => {}));
      if (cancelled) {
        scheduleRelease();
        return;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
        });
      } catch {
        throw new DictationError("permission");
      }
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        scheduleRelease();
        return;
      }

      const AudioCtor = audioContextCtor();
      if (!AudioCtor) throw new DictationError("unsupported");
      const ctx = new AudioCtor();
      if (ctx.state === "suspended") await ctx.resume();

      const recognizer = new model.KaldiRecognizer(ctx.sampleRate);

      let finalText = "";
      let partial = "";
      let heardSomething = false;
      let lastActivity = Date.now();
      let finishing = false;
      let delivered = false;
      let flushTimer: ReturnType<typeof setTimeout> | null = null;

      const combined = () => [finalText, partial].filter(Boolean).join(" ").trim();
      const activity = () => {
        heardSomething = true;
        lastActivity = Date.now();
      };

      const deliver = () => {
        if (delivered) return;
        delivered = true;
        if (flushTimer) clearTimeout(flushTimer);
        const text = combined();
        try {
          recognizer.remove();
        } catch {
          /* worker already tore it down */
        }
        scheduleRelease();
        cb.onFinal(text);
      };

      recognizer.on("partialresult", (message) => {
        const next = (message as { result?: { partial?: string } }).result?.partial ?? "";
        if (next === partial) return;
        partial = next;
        // A changed partial means Vosk just heard another word — that, rather
        // than raw loudness, is what "still talking" means here. It keeps the
        // silence timer honest in a noisy room, where an RMS threshold would
        // never trip.
        if (next) activity();
        cb.onPartial?.(combined());
      });

      recognizer.on("result", (message) => {
        const text = (message as { result?: { text?: string } }).result?.text ?? "";
        partial = "";
        if (text) {
          finalText = finalText ? `${finalText} ${text}` : text;
          activity();
        }
        if (finishing) {
          deliver();
          return;
        }
        cb.onPartial?.(combined());
      });

      recognizer.on("error", () => {
        // A rejected chunk shouldn't end the session; the next one usually works.
      });

      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      // A ScriptProcessorNode only ticks while it reaches the destination, so
      // route it through a muted gain node — wiring the mic straight to the
      // speakers would feed back.
      const mute = ctx.createGain();
      mute.gain.value = 0;

      processor.onaudioprocess = (event) => {
        if (finishing) return;
        try {
          recognizer.acceptWaveform(event.inputBuffer);
        } catch {
          /* dropped chunk */
        }
      };
      source.connect(processor);
      processor.connect(mute);
      mute.connect(ctx.destination);

      const startedAt = Date.now();
      const watchdog = setInterval(() => {
        const now = Date.now();
        if (now - startedAt > MAX_SESSION_MS) return finish();
        const idleFor = heardSomething ? now - lastActivity : now - startedAt;
        if (idleFor > (heardSomething ? SILENCE_MS : NO_SPEECH_MS)) finish();
      }, 250);

      function finish() {
        if (finishing) return;
        finishing = true;
        clearInterval(watchdog);

        processor.onaudioprocess = null;
        try {
          source.disconnect();
          processor.disconnect();
          mute.disconnect();
        } catch {
          /* already disconnected */
        }
        stream.getTracks().forEach((track) => track.stop());
        void ctx.close().catch(() => {});

        // Flush the decoder's tail, but don't hang on an event that may never
        // arrive when the audio held no speech.
        flushTimer = setTimeout(deliver, FLUSH_MS);
        try {
          recognizer.retrieveFinalResult();
        } catch {
          deliver();
        }
      }

      stopSession = finish;
      cb.onListening?.();
    } catch (err) {
      scheduleRelease();
      cb.onError(err instanceof DictationError ? err : new DictationError("engine"));
    }
  })();

  return {
    stop: () => {
      cancelled = true;
      stopSession?.();
    },
  };
}
