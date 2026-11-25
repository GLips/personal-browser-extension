import { storage } from "wxt/utils/storage";

/**
 * Fixed: the speed is the playback rate. Relative: the speed means "sound
 * like a typical speaker played at this speed", so the playback rate follows
 * the detected speaker. 1× is always fixed; other speeds are relative unless
 * the user turns on the fixed override.
 */
export type SpeedMode = "fixed" | "relative";

/**
 * Preferences kept across pages. The speed itself is deliberately absent:
 * every page starts at 1× fixed, and only quickSpeed is remembered.
 */
export type VideoSpeedPrefs = {
  /** The last speed other than 1× the user picked, offered as a one-tap choice. */
  quickSpeed: number;
  /** Syllables per second the detector reads for a typical speaker at 1×. */
  typicalRate: number;
  minRate: number;
  maxRate: number;
};

// Chrome mutes audio above 4×, which would also blind the detector.
export const HARD_MAX_RATE = 4;

export const SPEED_CHOICES = [1, 1.5, 2, 2.5, 3];
export const SPEED_STEP = 0.1;
/** The speed the toggle hotkey jumps to from 1×. */
export const HOTKEY_SPEED = 3;

export const videoSpeedPrefsItem = storage.defineItem<VideoSpeedPrefs>(
  "sync:videoSpeed.prefs",
  {
    fallback: {
      quickSpeed: 2.5,
      typicalRate: 4.5,
      minRate: 0.75,
      maxRate: 3.5,
    },
  },
);

/** Play pauses between sentences fast while sped up (any speed but 1×). */
export const skipSilencesItem = storage.defineItem<boolean>(
  "sync:videoSpeed.skipSilences",
  { fallback: true },
);

/** Pill position as fractions of the free space, so it survives window resizes. */
export type PillPosition = { x: number; y: number };

export type PillState = {
  collapsed: boolean;
  /** Last spot the pill was dropped on any site; used where none is saved. */
  defaultPosition: PillPosition;
  positionsByOrigin: Record<string, PillPosition>;
};

export const pillStateItem = storage.defineItem<PillState>(
  "local:videoSpeed.pill",
  {
    fallback: {
      collapsed: false,
      defaultPosition: { x: 0.02, y: 0.9 },
      positionsByOrigin: {},
    },
  },
);
