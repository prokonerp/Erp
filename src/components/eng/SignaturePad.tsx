import { useCallback, useEffect, useRef, useState } from "react";
import { compressImageToLimit } from "@/lib/image-compress";
import { supabase } from "@/integrations/supabase/client";

// Points are stored NORMALIZED (0..1 of the pad box) so a resize/rotation
// between strokes (or before save) rescales the signature instead of
// skewing it — the old code stored CSS pixels of whatever box was live.
type Point = { x: number; y: number };
type Stroke = Point[];

type SignaturePadProps = {
  ticketId: string;
  value: string | null;
  onChange: (path: string) => void;
};

const MAX_BYTES = 2 * 1024 * 1024;
const INK = "oklch(0.20 0.03 260)";
const PAPER = "oklch(1 0 0)";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      const base64 = url.split(",")[1];
      if (!base64) reject(new Error("Could not read signature image. Try again."));
      else resolve(base64);
    };
    reader.onerror = () => reject(new Error("Could not read signature image. Try again."));
    reader.readAsDataURL(blob);
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not export signature. Try again."));
    }, "image/png");
  });
}

export function SignaturePad({ ticketId, value, onChange }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const redoRef = useRef<Stroke[]>([]);
  const drawingRef = useRef(false);
  // Ref-based save lock: `busy` state commits on re-render, so a same-tick
  // double-tap would upload the signature twice (orphaning the first file).
  const saveRef = useRef(false);
  const [strokeCount, setStrokeCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  // Show the already-saved signature as an image (not a raw storage path).
  // Reads go through a signed URL; engineers hold read access on this bucket.
  useEffect(() => {
    let active = true;
    setSignedUrl(null);
    if (!value || preview) return;
    (async () => {
      try {
        const { data, error: signErr } = await supabase.storage
          .from("ticket-attachments")
          .createSignedUrl(value, 3600);
        if (!active || signErr || !data?.signedUrl) return;
        setSignedUrl(data.signedUrl);
      } catch {
        // Offline/sign failure: badge-only ("Saved"), no raw path text.
      }
    })();
    return () => {
      active = false;
    };
  }, [value, preview]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of strokesRef.current) {
      if (stroke.length === 1) {
        const p = stroke[0];
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, 1.25, 0, Math.PI * 2);
        ctx.fillStyle = INK;
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(stroke[0].x * w, stroke[0].y * h);
      for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x * w, stroke[i].y * h);
      ctx.stroke();
    }
    ctx.restore();
  }, []);

  const fitCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = wrap.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(192 * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = "192px";
    redraw();
  }, [redraw]);

  useEffect(() => {
    fitCanvas();
    window.addEventListener("resize", fitCanvas);
    return () => window.removeEventListener("resize", fitCanvas);
  }, [fitCanvas]);

  const posFromEvent = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    // Normalized 0..1 (guard against zero-size rects on hidden pads).
    return {
      x: rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0,
      y: rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (busy) return;
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    redoRef.current = [];
    setRedoCount(0);
    strokesRef.current.push([posFromEvent(e)]);
    setError(null);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || busy) return;
    e.preventDefault();
    const current = strokesRef.current[strokesRef.current.length - 1];
    current.push(posFromEvent(e));
    redraw();
  };

  const endStroke = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    redraw();
    setStrokeCount(strokesRef.current.length);
  };

  const handleClear = () => {
    if (busy) return;
    strokesRef.current = [];
    redoRef.current = [];
    setStrokeCount(0);
    setRedoCount(0);
    setError(null);
    redraw();
  };

  const handleUndo = () => {
    if (busy || strokesRef.current.length === 0) return;
    const last = strokesRef.current.pop()!;
    redoRef.current.push(last);
    setStrokeCount(strokesRef.current.length);
    setRedoCount(redoRef.current.length);
    redraw();
  };

  const handleRedo = () => {
    if (busy || redoRef.current.length === 0) return;
    strokesRef.current.push(redoRef.current.pop()!);
    setStrokeCount(strokesRef.current.length);
    setRedoCount(redoRef.current.length);
    redraw();
  };

  const handleSave = async () => {
    const canvas = canvasRef.current;
    if (!canvas || busy || saveRef.current) return;
    if (strokesRef.current.length === 0) {
      setError("Please ask the customer to sign before saving.");
      return;
    }
    if (!navigator.onLine) {
      setError("No internet connection. Reconnect and retry — nothing was uploaded.");
      return;
    }
    saveRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const png = await canvasToPngBlob(canvas);
      let payload: Blob = png;
      let filename = `signature-${Date.now()}.png`;
      let contentType = "image/png";
      if (png.size > MAX_BYTES) {
        const compressed = await compressImageToLimit(
          new File([png], filename, { type: "image/png" }),
          { maxBytes: MAX_BYTES },
        );
        payload = compressed.blob;
        filename = compressed.name;
        contentType = compressed.contentType;
      }
      if (payload.size > MAX_BYTES) {
        throw new Error("Signature is over 2 MB even after compression. Clear and sign smaller.");
      }
      const dataBase64 = await blobToBase64(payload);
      const { uploadPublicTicketAttachment } =
        await import("@/lib/public-ticket-uploads.functions");
      const result = await uploadPublicTicketAttachment({
        data: {
          ticket_id: ticketId,
          filename,
          content_type: contentType,
          kind: "customer_signature",
          data_base64: dataBase64,
        },
      });
      setPreview(canvas.toDataURL("image/png"));
      onChange(result.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signature upload failed. Try again.");
    } finally {
      saveRef.current = false;
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="Customer signature"
      className="rounded-xl border border-border bg-card p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-card-foreground">Customer signature</h3>
        {value ? (
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            Saved
          </span>
        ) : (
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            Not signed
          </span>
        )}
      </div>

      <div ref={wrapRef} className="mt-3 overflow-hidden rounded-lg border border-input bg-white">
        <canvas
          ref={canvasRef}
          aria-label="Signature canvas. Draw with finger or mouse."
          className="block touch-none cursor-crosshair"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onPointerLeave={endStroke}
        />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Sign inside the box with finger or mouse.
      </p>

      {preview || signedUrl ? (
        <div className="mt-3 flex items-center gap-3">
          {preview ? (
            <img
              src={preview}
              alt="Saved signature preview"
              className="h-12 w-32 rounded-md border border-border bg-white object-contain"
            />
          ) : null}
          {!preview && signedUrl ? (
            <img
              src={signedUrl}
              alt="Saved customer signature"
              className="h-12 w-32 rounded-md border border-border bg-white object-contain"
            />
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-sm font-medium text-[oklch(0.58_0.22_27)]">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleClear}
          disabled={busy || strokeCount === 0}
          className="min-h-[44px] min-w-[44px] rounded-lg border border-border bg-card px-4 text-sm font-semibold text-card-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={handleUndo}
          disabled={busy || strokeCount === 0}
          className="min-h-[44px] min-w-[44px] rounded-lg border border-border bg-card px-4 text-sm font-semibold text-card-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={handleRedo}
          disabled={busy || redoCount === 0}
          className="min-h-[44px] min-w-[44px] rounded-lg border border-border bg-card px-4 text-sm font-semibold text-card-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          Redo
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={busy || strokeCount === 0}
          className="min-h-[44px] rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save signature"}
        </button>
      </div>
    </section>
  );
}
