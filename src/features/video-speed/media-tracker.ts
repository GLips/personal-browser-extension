/**
 * Finds the media element worth controlling, at almost no cost while there
 * is none: media events are caught by capture listeners on the document,
 * so there is no MutationObserver walking every DOM change.
 */

const MEDIA_EVENTS = [
  "play",
  "playing",
  "pause",
  "loadedmetadata",
  "emptied",
  "ended",
];

export function trackActiveMedia(
  onChange: (media: HTMLMediaElement | null) => void,
): () => void {
  let current: HTMLMediaElement | null = null;
  const reevaluate = () => {
    const next = pickActiveMedia();
    if (next !== current) {
      current = next;
      onChange(next);
    }
  };
  for (const type of MEDIA_EVENTS) {
    document.addEventListener(type, reevaluate, true);
  }
  // Catches the element being removed or resized, which fire no media event.
  const sweep = window.setInterval(() => {
    if (current) reevaluate();
  }, 2000);
  reevaluate();
  return () => {
    for (const type of MEDIA_EVENTS) {
      document.removeEventListener(type, reevaluate, true);
    }
    window.clearInterval(sweep);
  };
}

function pickActiveMedia(): HTMLMediaElement | null {
  let best: HTMLMediaElement | null = null;
  let bestScore = 0;
  for (const media of document.querySelectorAll<HTMLMediaElement>(
    "video, audio",
  )) {
    const score = scoreMedia(media);
    if (score > bestScore) {
      best = media;
      bestScore = score;
    }
  }
  return best;
}

// Zero means "not something a person is listening to": tiny or hidden
// videos, muted loops used as backgrounds, unloaded audio tags.
function scoreMedia(media: HTMLMediaElement): number {
  if (!media.isConnected || media.readyState === 0) return 0;
  if (media.loop && media.muted) return 0;
  const long =
    media.duration > 10 || media.duration === Number.POSITIVE_INFINITY;
  if (!long) return 0;
  let score: number;
  if (media instanceof HTMLVideoElement) {
    const rect = media.getBoundingClientRect();
    if (rect.width < 200 || rect.height < 112) return 0;
    score = rect.width * rect.height;
  } else {
    if (media.paused && !media.controls) return 0;
    score = 50_000;
  }
  if (!media.paused) score *= 10;
  if (!media.muted) score *= 2;
  return score;
}
