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
  /**
   * Loudness of the audio heard over the last `elapsedSeconds`, as RMS per
   * 5 ms block. Slicing the analyser buffer, rather than taking one reading
   * per timer tick, keeps syllable peaks sharp however late the timer fires.
   */
  readBlocks(elapsedSeconds: number): { rms: number; seconds: number }[];
  dispose(): void;
};

type CapturableMedia = HTMLMediaElement & { captureStream?: () => MediaStream };

const BLOCK_SECONDS = 0.005;

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
  // ~43 ms at 48 kHz: covers a poll interval with room for timer lateness.
  const analyser = new AnalyserNode(context, {
    fftSize: 2048,
    smoothingTimeConstant: 0,
  });
  highpass.connect(lowpass).connect(analyser);
  const detach = connectSource(context, media as CapturableMedia, highpass);
  const buffer = new Float32Array(analyser.fftSize);
  const blockSize = Math.round(context.sampleRate * BLOCK_SECONDS);

  return {
    context,
    readBlocks(elapsedSeconds) {
      analyser.getFloatTimeDomainData(buffer);
      const fresh = Math.min(
        buffer.length,
        Math.round(elapsedSeconds * context.sampleRate),
      );
      const blocks: { rms: number; seconds: number }[] = [];
      for (
        let start = buffer.length - fresh;
        start + blockSize <= buffer.length;
        start += blockSize
      ) {
        let sum = 0;
        for (let i = start; i < start + blockSize; i++) {
          const sample = buffer[i] as number;
          sum += sample * sample;
        }
        blocks.push({
          rms: Math.sqrt(sum / blockSize),
          seconds: blockSize / context.sampleRate,
        });
      }
      return blocks;
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
