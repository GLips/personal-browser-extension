/**
 * Listens to a media element's audio, band-limited to speech, and reports
 * its loudness on demand.
 *
 * Prefers captureStream(): it copies the audio out and leaves playback
 * untouched, so a bug here can never silence the video. The fallback,
 * createMediaElementSource, reroutes playback through our AudioContext for
 * the rest of the element's life, so it is used only when captureStream is
 * missing, and only with a running context.
 */

export class AudioUnavailableError extends Error {}

export type AudioTap = {
  context: AudioContext;
  /** RMS of the latest ~10 ms of speech-band audio. */
  readRms(): number;
  dispose(): void;
};

type CapturableMedia = HTMLMediaElement & { captureStream?: () => MediaStream };

let sharedContext: AudioContext | undefined;
const elementSources = new WeakMap<
  HTMLMediaElement,
  MediaElementAudioSourceNode
>();

export function sharedAudioContext(): AudioContext {
  sharedContext ??= new AudioContext({ latencyHint: "playback" });
  return sharedContext;
}

export function tapMediaAudio(media: HTMLMediaElement): AudioTap {
  const context = sharedAudioContext();
  const highpass = new BiquadFilterNode(context, {
    type: "highpass",
    frequency: 300,
  });
  const lowpass = new BiquadFilterNode(context, {
    type: "lowpass",
    frequency: 3000,
  });
  const analyser = new AnalyserNode(context, {
    fftSize: 512,
    smoothingTimeConstant: 0,
  });
  highpass.connect(lowpass).connect(analyser);
  const detach = connectSource(context, media as CapturableMedia, highpass);
  const buffer = new Float32Array(analyser.fftSize);

  return {
    context,
    readRms() {
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (const sample of buffer) sum += sample * sample;
      return Math.sqrt(sum / buffer.length);
    },
    dispose() {
      detach();
      highpass.disconnect();
      lowpass.disconnect();
    },
  };
}

function connectSource(
  context: AudioContext,
  media: CapturableMedia,
  input: AudioNode,
): () => void {
  if (typeof media.captureStream === "function") {
    let stream: MediaStream;
    try {
      stream = media.captureStream();
    } catch (error) {
      // Cross-origin media without CORS, and DRM, refuse capture outright.
      throw new AudioUnavailableError(String(error));
    }
    let source: MediaStreamAudioSourceNode | undefined;
    // The stream's tracks are replaced whenever the element loads new media.
    const connect = () => {
      source?.disconnect();
      source = undefined;
      if (stream.getAudioTracks().length === 0) return;
      source = context.createMediaStreamSource(stream);
      source.connect(input);
    };
    connect();
    stream.addEventListener("addtrack", connect);
    stream.addEventListener("removetrack", connect);
    return () => {
      stream.removeEventListener("addtrack", connect);
      stream.removeEventListener("removetrack", connect);
      source?.disconnect();
      for (const track of stream.getTracks()) track.stop();
    };
  }

  if (context.state !== "running") {
    throw new AudioUnavailableError("audio context is not running");
  }
  let source = elementSources.get(media);
  if (!source) {
    source = context.createMediaElementSource(media);
    // Keeps the media audible: once sourced, it plays only through this graph.
    source.connect(context.destination);
    elementSources.set(media, source);
  }
  const elementSource = source;
  elementSource.connect(input);
  return () => elementSource.disconnect(input);
}
