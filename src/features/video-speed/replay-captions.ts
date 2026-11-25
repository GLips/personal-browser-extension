/**
 * Turns captions on while a skip back replays, like Netflix does, and puts
 * them back afterwards. Returns the restore function. Captions the user
 * already had on, or toggled themselves during the replay, are left alone.
 */
export function showCaptionsDuringReplay(media: HTMLMediaElement): () => void {
  return (
    showYouTubeCaptions(media) ?? showTrackCaptions(media) ?? (() => undefined)
  );
}

// YouTube draws captions itself; its <video> carries no TextTracks. The
// player's own API lives in the page's JS world, out of the content script's
// reach, so the caption button is the way in. Its aria-label says
// "unavailable" even when captions exist, so availability is read from
// whether a click actually turns aria-pressed on (it flips synchronously).
function showYouTubeCaptions(media: HTMLMediaElement) {
  const button = media
    .closest(".html5-video-player")
    ?.querySelector<HTMLElement>(".ytp-subtitles-button");
  if (!button) return undefined;
  const pressed = () => button.getAttribute("aria-pressed") === "true";
  if (pressed()) return () => undefined;
  button.click();
  if (!pressed()) return () => undefined;
  let userToggled = false;
  const observer = new MutationObserver(() => {
    userToggled = true;
  });
  observer.observe(button, { attributeFilter: ["aria-pressed"] });
  return () => {
    observer.disconnect();
    if (!userToggled && pressed()) button.click();
  };
}

function showTrackCaptions(media: HTMLMediaElement) {
  const tracks = [...media.textTracks].filter(
    (track) => track.kind === "subtitles" || track.kind === "captions",
  );
  if (tracks.length === 0) return undefined;
  if (tracks.some((track) => track.mode === "showing")) return () => undefined;
  const language = navigator.language.split("-")[0];
  const track =
    tracks.find((t) => t.language.split("-")[0] === language) ?? tracks[0];
  if (!track) return undefined;
  const previous = track.mode;
  track.mode = "showing";
  return () => {
    // A user who changed the track during the replay keeps their choice.
    if (track.mode === "showing") track.mode = previous;
  };
}
