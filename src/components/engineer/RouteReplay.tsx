import { Pause, Play } from "lucide-react";
import { formatISTTime } from "@/lib/time";
import type { ReplayFrame } from "@/lib/routeReplay";

export type RouteReplayProps = {
  frames: ReplayFrame[];
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  clockMs: number | null;
  onClockChange: (ms: number) => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
};

/**
 * Admin-only replay controls for a road-snapped day trail (Movement tab).
 *
 * Never auto-plays — playback starts only on explicit user action, so
 * `prefers-reduced-motion` users are never surprised by movement. The parent
 * (DayRouteView) owns clock/playing state and feeds the map the playhead
 * position derived from these frames.
 */
export function RouteReplay({
  frames,
  playing,
  onPlayingChange,
  clockMs,
  onClockChange,
  speed,
  onSpeedChange,
}: RouteReplayProps) {
  if (frames.length === 0) return null;

  const first = frames[0].clockMs;
  const last = frames[frames.length - 1].clockMs;
  const current = Math.min(Math.max(clockMs ?? first, first), last);

  const toggle = () => {
    if (playing) {
      onPlayingChange(false);
      return;
    }
    if (current >= last) onClockChange(first); // restart from the beginning
    onPlayingChange(true);
  };

  return (
    <div
      role="group"
      aria-label="Day route replay"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2"
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause replay" : "Play replay"}
        className="grid h-8 w-8 place-items-center rounded-md border border-input bg-background hover:bg-muted/60"
      >
        {playing ? (
          <Pause className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Play className="h-4 w-4" aria-hidden="true" />
        )}
      </button>

      <label className="sr-only" htmlFor="route-replay-scrub">
        Replay position
      </label>
      <input
        id="route-replay-scrub"
        type="range"
        min={first}
        max={last}
        step={1000}
        value={current}
        onChange={(e) => onClockChange(Number(e.target.value))}
        className="h-2 min-w-28 flex-1 accent-green-600"
      />

      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {formatISTTime(new Date(current).toISOString())}
        {" / "}
        {formatISTTime(new Date(last).toISOString())}
      </span>

      <label className="sr-only" htmlFor="route-replay-speed">
        Replay speed
      </label>
      <select
        id="route-replay-speed"
        value={speed}
        onChange={(e) => onSpeedChange(Number(e.target.value))}
        className="h-8 shrink-0 rounded-md border border-input bg-background px-1 text-xs"
      >
        <option value={1}>1×</option>
        <option value={2}>2×</option>
        <option value={4}>4×</option>
        <option value={8}>8×</option>
      </select>
    </div>
  );
}
