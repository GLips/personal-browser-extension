import { storage } from "wxt/utils/storage";

export type VideoSpeedSettings = {
  /** Manual: the playback rate. Auto: "sound like a typical speaker at this speed". */
  speed: number;
  auto: boolean;
  /** Syllables per second the detector reads for a typical speaker at 1×. */
  typicalRate: number;
  minRate: number;
  maxRate: number;
};

// Chrome mutes audio above 4×, which would also blind the detector.
export const HARD_MAX_RATE = 4;

export const videoSpeedSettingsItem = storage.defineItem<VideoSpeedSettings>(
  "sync:videoSpeed.settings",
  {
    fallback: {
      speed: 2.5,
      auto: false,
      typicalRate: 4.5,
      minRate: 0.75,
      maxRate: 3.5,
    },
  },
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
