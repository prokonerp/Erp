import { useMemo } from "react";
import { EyeOff } from "lucide-react";
import { useScreenGuard } from "@/hooks/useScreenGuard";
import { guardWatermarkLabel, watermarkSvgDataUri } from "@/lib/screen-guard";

/**
 * Visual half of the engineer-portal screen-capture deterrents.
 *
 * HONEST SCOPE: these are deterrents, not a block. A browser cannot prevent
 * OS-level screenshots or screen recording; the watermark identifies who was
 * looking at the screen, and the shield covers content while the tab is hidden.
 */
export function ScreenGuard({ identity }: { identity?: string }) {
  const { hidden } = useScreenGuard();

  const { backgroundImage } = useMemo(() => {
    const label = guardWatermarkLabel(identity ?? "", Date.now());
    return { backgroundImage: `url("${watermarkSvgDataUri(label)}")` };
  }, [identity]);

  return (
    <>
      <div
        className="screen-guard-watermark"
        aria-hidden="true"
        data-testid="screen-guard-watermark"
        style={{ backgroundImage, backgroundRepeat: "repeat" }}
      />
      <div
        className="screen-guard-shield"
        data-testid="screen-guard-shield"
        role="status"
        aria-live="polite"
        hidden={!hidden}
      >
        <EyeOff className="h-6 w-6" aria-hidden="true" />
        <p>Content hidden — screen capture is disabled</p>
      </div>
    </>
  );
}
