export interface ClockSource {
  now(): number;
  trusted: boolean;
}

export const systemClock: ClockSource = {
  now: () => Date.now(),
  trusted: false,
};

/** 保守下限：避免重启后单调时钟与墙钟混淆 */
export const WALL_CLOCK_EPOCH_FLOOR_MS = Date.UTC(2001, 0, 1);

export const DEFAULT_FUTURE_SKEW_MS = 5 * 60 * 1000;

