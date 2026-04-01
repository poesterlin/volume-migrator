import cliProgress from "cli-progress";
import type { LogMode } from "./log";

// ---------------------------------------------------------------------------
// Size parsing & formatting
// ---------------------------------------------------------------------------

const SIZE_SUFFIXES: Record<string, number> = {
  B: 1,
  K: 1024,
  M: 1024 ** 2,
  G: 1024 ** 3,
  T: 1024 ** 4,
};

/**
 * Parse a human-readable size string (e.g. "142M", "1.5G", "980K") into bytes.
 * Returns undefined if the format is not recognised.
 */
export function parseHumanSize(size: string): number | undefined {
  const match = size.trim().match(/^([\d.]+)\s*([BKMGT])/i);
  if (!match) return undefined;
  const value = parseFloat(match[1]!);
  const suffix = match[2]!.toUpperCase();
  const multiplier = SIZE_SUFFIXES[suffix];
  if (isNaN(value) || !multiplier) return undefined;
  return Math.round(value * multiplier);
}

/**
 * Format a byte count as a human-readable string (e.g. "142.0 MB").
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / 1024 ** 4).toFixed(1)} TB`;
}

// ---------------------------------------------------------------------------
// Counting transform stream
// ---------------------------------------------------------------------------

/**
 * Create a TransformStream that passes data through unchanged but invokes
 * `onProgress` with the cumulative byte count after each chunk.
 */
export function createCountingStream(
  onProgress: (totalBytes: number) => void,
): TransformStream<Uint8Array, Uint8Array> {
  let transferred = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      transferred += chunk.byteLength;
      onProgress(transferred);
      controller.enqueue(chunk);
    },
  });
}

// ---------------------------------------------------------------------------
// Progress bar factory
// ---------------------------------------------------------------------------

export type TransferProgressBar = {
  /** Update with the current number of bytes transferred. */
  update(bytes: number): void;
  /** Stop the bar and finalise the output line. */
  stop(): void;
};

/**
 * Create a transfer progress bar.
 *
 * - If `totalBytes` is provided and `compressed` is false, renders a full bar
 *   with percentage and ETA.
 * - Otherwise renders a simpler bytes + speed + elapsed display.
 * - In JSON log mode a silent no-op bar is returned.
 */
export function createTransferProgressBar(opts: {
  logMode: LogMode;
  totalBytes?: number;
  compressed: boolean;
}): TransferProgressBar {
  // In JSON mode, return a silent stub so callers don't need conditionals.
  if (opts.logMode === "json") {
    return { update() {}, stop() {} };
  }

  const showFullBar = opts.totalBytes != null && !opts.compressed;
  const total = opts.totalBytes ?? 0;

  const bar = new cliProgress.SingleBar(
    {
      stream: process.stderr,
      // 6-space indent to align with "    Streaming ..." log lines
      format: showFullBar
        ? "      {bar} {percentage}% | {transferred} / {totalFormatted} | {speed} | ETA {eta_formatted}"
        : "      {transferred} | {speed} | {duration_formatted}",
      barsize: 20,
      hideCursor: true,
      clearOnComplete: false,
      stopOnComplete: false,
      // Throttle redraws to avoid excessive terminal writes
      fps: 8,
      formatValue(v, _options, type) {
        // The default formatter truncates to integer — we want decimals for
        // the custom payload fields but not for the built-in numeric fields.
        if (type === "value" || type === "total") return String(v);
        return String(v);
      },
    },
    cliProgress.Presets.shades_classic,
  );

  const startTime = Date.now();

  bar.start(showFullBar ? total : 100, 0, {
    transferred: formatBytes(0),
    totalFormatted: showFullBar ? formatBytes(total) : "",
    speed: "-- MB/s",
  });

  return {
    update(bytes: number) {
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0 ? bytes / elapsed : 0;

      bar.update(showFullBar ? bytes : 0, {
        transferred: formatBytes(bytes),
        totalFormatted: showFullBar ? formatBytes(total) : "",
        speed: `${formatBytes(speed)}/s`,
      });
    },

    stop() {
      bar.stop();
    },
  };
}
