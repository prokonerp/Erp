import { describe, it, expect } from "vitest";
import { compressImageToLimit } from "../image-compress";
import type { CompressedImage } from "../image-compress";
import { COMPRESS_TARGET_BYTES, MAX_ACCEPTED_BYTES, acceptedUploadMessage } from "../upload-limits";

function fakeBitmap(w: number, h: number): ImageBitmap {
  return { width: w, height: h, close: () => {} } as unknown as ImageBitmap;
}

function fakeDocAndCanvas(makeBlob: (quality: number, w: number, h: number) => Blob): {
  docFake: Document;
  getCtx: () => { lastW: number; lastH: number };
} {
  let lastW = 0;
  let lastH = 0;

  const ctxObj = {
    drawImage: (_src: unknown, _dx: number, _dy: number, dw: number, dh: number) => {
      lastW = dw;
      lastH = dh;
    },
  };

  const fakeCanvas = {
    width: 0,
    height: 0,
    getContext: () => ctxObj,
    toBlob: (cb: (b: Blob | null) => void, _type: string, quality: number) => {
      cb(makeBlob(quality, lastW, lastH));
    },
  } as unknown as HTMLCanvasElement;

  const docFake = {
    createElement: (tag: string) => {
      if (tag === "canvas") return fakeCanvas;
      throw new Error("unexpected element: " + tag);
    },
  } as unknown as Document;

  return { docFake, getCtx: () => ({ lastW, lastH }) };
}

function fakeDocImgFireOnload(): Document {
  return {
    createElement: (tag: string) => {
      if (tag === "img") {
        let onloadFn: (() => void) | null = null;
        let srcVal = "";
        return {
          set src(v: string) {
            srcVal = v;
            if (onloadFn) setTimeout(onloadFn, 0);
          },
          get src() {
            return srcVal;
          },
          set onload(fn: (() => void) | null) {
            onloadFn = fn;
          },
          get onload() {
            return onloadFn;
          },
          set onerror(fn: (() => void) | null) {
            void fn;
          },
          get onerror() {
            return null;
          },
        };
      }
      throw new Error("unexpected");
    },
  } as unknown as Document;
}

function fakeDocImgFireOnerror(): Document {
  return {
    createElement: (tag: string) => {
      if (tag === "img") {
        let onerrorFn: (() => void) | null = null;
        let srcVal = "";
        return {
          set src(v: string) {
            srcVal = v;
            if (onerrorFn) setTimeout(onerrorFn, 0);
          },
          get src() {
            return srcVal;
          },
          set onload(fn: (() => void) | null) {
            void fn;
          },
          get onload() {
            return null;
          },
          set onerror(fn: (() => void) | null) {
            onerrorFn = fn;
          },
          get onerror() {
            return onerrorFn;
          },
        };
      }
      throw new Error("unexpected");
    },
  } as unknown as Document;
}

describe("compressImageToLimit", () => {
  it("ladder picks fitting quality ≤2MB and preserves aspect", async () => {
    const bmp = fakeBitmap(4000, 3000);
    const { docFake } = fakeDocAndCanvas((_q, w, h) => {
      const areaScale = (w * h) / (4000 * 3000);
      return new Blob([new ArrayBuffer(Math.round(3_000_000 * _q * areaScale))], {
        type: "image/jpeg",
      });
    });

    const result: CompressedImage = await compressImageToLimit(
      new File([new Uint8Array(1)], "plate.png", { type: "image/png" }) as File,
      { maxBytes: 2 * 1024 * 1024 },
      { createImageBitmapFn: () => Promise.resolve(bmp), documentRef: docFake },
    );

    expect(result.passthrough).toBe(false);
    expect(result.compressedBytes).toBeLessThanOrEqual(COMPRESS_TARGET_BYTES);
    expect(result.quality).toBeGreaterThanOrEqual(0.85);
    expect(result.name).toMatch(/\.jpg$/);
    expect(result.contentType).toBe("image/jpeg");
    expect(result.height).toBeGreaterThan(0);
  });

  it("default target compresses under 1.5MB", async () => {
    const bmp = fakeBitmap(4000, 3000);
    const { docFake } = fakeDocAndCanvas((_q, w, h) => {
      const areaScale = (w * h) / (4000 * 3000);
      return new Blob([new ArrayBuffer(Math.round(3_000_000 * _q * areaScale))], {
        type: "image/jpeg",
      });
    });

    const result: CompressedImage = await compressImageToLimit(
      new File([new Uint8Array(1)], "plate.png", { type: "image/png" }) as File,
      undefined,
      { createImageBitmapFn: () => Promise.resolve(bmp), documentRef: docFake },
    );

    expect(result.passthrough).toBe(false);
    expect(result.compressedBytes).toBeLessThanOrEqual(COMPRESS_TARGET_BYTES);
    expect(result.quality).toBeGreaterThanOrEqual(0.85);
  });

  it("ladder steps down through qualities until fitting (tautological guard)", async () => {
    const bmp = fakeBitmap(4000, 3000);
    const { docFake } = fakeDocAndCanvas((q) => {
      const size = q >= 0.86 ? 3_000_000 : 1_000_000;
      return new Blob([new ArrayBuffer(size)], { type: "image/jpeg" });
    });

    const result: CompressedImage = await compressImageToLimit(
      new File([new Uint8Array(1)], "plate.png", { type: "image/png" }) as File,
      { maxBytes: 2 * 1024 * 1024 },
      { createImageBitmapFn: () => Promise.resolve(bmp), documentRef: docFake },
    );

    expect(result.passthrough).toBe(false);
    expect(result.compressedBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(result.quality).toBe(0.85);
  });

  it("ladder steps down side when all qualities at a side fail", async () => {
    const bmp = fakeBitmap(4000, 3000);
    const { docFake, getCtx } = fakeDocAndCanvas((_q, w) => {
      const size = w > 1800 ? 3_000_000 : 1_000_000;
      return new Blob([new ArrayBuffer(size)], { type: "image/jpeg" });
    });

    const result: CompressedImage = await compressImageToLimit(
      new File([new Uint8Array(1)], "plate.png", { type: "image/png" }) as File,
      { maxBytes: 2 * 1024 * 1024 },
      { createImageBitmapFn: () => Promise.resolve(bmp), documentRef: docFake },
    );

    expect(result.passthrough).toBe(false);
    expect(result.compressedBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
    const ctx = getCtx();
    expect(ctx.lastW).toBe(1792);
    expect(ctx.lastH).toBe(1344);
  });

  it("reduces resolution while holding quality >= 0.85 for a large bitmap", async () => {
    const bmp = fakeBitmap(4000, 3000);
    const { docFake } = fakeDocAndCanvas((_q, w) => {
      const size = w > 2300 ? 3_000_000 : 1_000_000;
      return new Blob([new ArrayBuffer(size)], { type: "image/jpeg" });
    });

    const result: CompressedImage = await compressImageToLimit(
      new File([new Uint8Array(1)], "plate.png", { type: "image/png" }) as File,
      { maxBytes: 2 * 1024 * 1024 },
      { createImageBitmapFn: () => Promise.resolve(bmp), documentRef: docFake },
    );

    expect(result.passthrough).toBe(false);
    expect(result.compressedBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(result.quality).toBeGreaterThanOrEqual(0.85);
    // 2560px side overflows, so the encoder must step down resolution…
    expect(result.width).toBe(2240);
    expect(result.height).toBe(1680);
    // …instead of dropping quality below 0.85.
    expect(result.width).toBeLessThan(4000);
  });

  it("undecodable + small file → passthrough true, original returned", async () => {
    const small = new File([new Uint8Array(100)], "snap.png", {
      type: "image/png",
    });

    const result = await compressImageToLimit(small, undefined, {
      createImageBitmapFn: () => {
        throw new Error("nope");
      },
      documentRef: fakeDocImgFireOnerror(),
    });

    expect(result.passthrough).toBe(true);
    expect(result.blob).toBe(small);
    expect(result.compressedBytes).toBe(100);
  });

  it("undecodable + over-target file → throws with user-friendly message", async () => {
    const big = new File([new Uint8Array(2 * 1024 * 1024)], "huge.png", {
      type: "image/png",
    });

    await expect(
      compressImageToLimit(big, undefined, {
        createImageBitmapFn: () => {
          throw new Error("no decode");
        },
        documentRef: fakeDocImgFireOnerror(),
      }),
    ).rejects.toThrow("Photo could not be read. Try a JPEG photo under 8 MB.");
  });

  it("input over 5MB rejects with the 5MB message without decoding", async () => {
    const big = new File([new Uint8Array(6 * 1024 * 1024)], "huge.png", {
      type: "image/png",
    });
    expect(big.size).toBeGreaterThan(MAX_ACCEPTED_BYTES);

    let bitmapCalled = false;
    let docTouched = false;
    const docFakeNever = {
      createElement: () => {
        docTouched = true;
        throw new Error("should not decode");
      },
    } as unknown as Document;

    await expect(
      compressImageToLimit(big, undefined, {
        createImageBitmapFn: (() => {
          bitmapCalled = true;
          throw new Error("should not decode");
        }) as unknown as typeof createImageBitmap,
        documentRef: docFakeNever,
      }),
    ).rejects.toThrow(acceptedUploadMessage());

    expect(bitmapCalled).toBe(false);
    expect(docTouched).toBe(false);
  });

  it("HEIC undecodable rejects with the HEIC message", async () => {
    const heic = new File([new Uint8Array(100)], "snap.heic", {
      type: "image/heic",
    });

    await expect(
      compressImageToLimit(heic, undefined, {
        createImageBitmapFn: () => {
          throw new Error("no decode");
        },
        documentRef: fakeDocImgFireOnerror(),
      }),
    ).rejects.toThrow(
      "This photo (HEIC) could not be read on this device. Switch the camera to JPEG / Most Compatible and retake.",
    );
  });

  it("encode-count: photo fitting at the first side uses ≤3 encodes", async () => {
    const bmp = fakeBitmap(4000, 3000);
    let encodes = 0;
    const { docFake } = fakeDocAndCanvas(() => {
      encodes++;
      return new Blob([new ArrayBuffer(1_000_000)], { type: "image/jpeg" });
    });

    const result = await compressImageToLimit(
      new File([new Uint8Array(1)], "plate.png", { type: "image/png" }) as File,
      undefined,
      { createImageBitmapFn: () => Promise.resolve(bmp), documentRef: docFake },
    );

    expect(result.passthrough).toBe(false);
    expect(result.compressedBytes).toBeLessThanOrEqual(COMPRESS_TARGET_BYTES);
    expect(result.quality).toBeGreaterThanOrEqual(0.85);
    expect(encodes).toBeLessThanOrEqual(3);
  });

  it("encode-count: photo needing one step down uses ≤4 encodes", async () => {
    const bmp = fakeBitmap(4000, 3000);
    let encodes = 0;
    const { docFake } = fakeDocAndCanvas((_q, w) => {
      encodes++;
      const size = w > 2300 ? 3_000_000 : 1_000_000;
      return new Blob([new ArrayBuffer(size)], { type: "image/jpeg" });
    });

    const result = await compressImageToLimit(
      new File([new Uint8Array(1)], "plate.png", { type: "image/png" }) as File,
      undefined,
      { createImageBitmapFn: () => Promise.resolve(bmp), documentRef: docFake },
    );

    expect(result.passthrough).toBe(false);
    expect(result.compressedBytes).toBeLessThanOrEqual(COMPRESS_TARGET_BYTES);
    expect(result.quality).toBeGreaterThanOrEqual(0.85);
    expect(result.width).toBe(2240);
    expect(encodes).toBeLessThanOrEqual(4);
  });

  it("compressed output name ends .jpg and contentType is image/jpeg", async () => {
    const bmp = fakeBitmap(3000, 2000);
    const { docFake } = fakeDocAndCanvas((_q, w, h) => {
      const areaScale = (w * h) / (3000 * 2000);
      return new Blob([new ArrayBuffer(Math.round(1_000_000 * _q * areaScale))], {
        type: "image/jpeg",
      });
    });

    const result = await compressImageToLimit(
      new File([new Uint8Array(1)], "screenshot.png", { type: "image/png" }) as File,
      undefined,
      { createImageBitmapFn: () => Promise.resolve(bmp), documentRef: docFake },
    );

    expect(result.name).toMatch(/\.jpg$/);
    expect(result.contentType).toBe("image/jpeg");
    expect(result.originalBytes).toBe(1);
    expect(result.compressedBytes).toBeGreaterThan(0);
    expect(result.compressedBytes).toBeLessThanOrEqual(COMPRESS_TARGET_BYTES);
  });

  it("zero-dimension bitmap → passthrough true", async () => {
    const bmp = fakeBitmap(0, 0);
    const { docFake } = fakeDocAndCanvas(
      () => new Blob([new ArrayBuffer(100)], { type: "image/jpeg" }),
    );

    const small = new File([new Uint8Array(100)], "empty.png", {
      type: "image/png",
    });

    const result = await compressImageToLimit(small, undefined, {
      createImageBitmapFn: () => Promise.resolve(bmp),
      documentRef: docFake,
    });

    expect(result.passthrough).toBe(true);
  });

  it("tiny maxBytes rejects with KB-sized message", async () => {
    const bmp = fakeBitmap(4000, 3000);
    const { docFake } = fakeDocAndCanvas(
      () => new Blob([new ArrayBuffer(3_000_000)], { type: "image/jpeg" }),
    );

    await expect(
      compressImageToLimit(
        new File([new Uint8Array(1)], "plate.png", { type: "image/png" }) as File,
        { maxBytes: 50 * 1024 },
        { createImageBitmapFn: () => Promise.resolve(bmp), documentRef: docFake },
      ),
    ).rejects.toThrow("KB");
  });
});
