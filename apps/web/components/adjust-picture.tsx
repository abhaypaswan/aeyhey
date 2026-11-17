"use client";
// SPDX-License-Identifier: AGPL-3.0-only
// Placing a picked picture in the circle before it is saved: drag (or arrow keys) to move
// it, the slider or the mouse wheel to zoom. It always covers the circle, so there is
// never an empty edge. Done hands back a 512 pixel square JPEG as a data URL.

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@ui-sdk/react/dialog";
import { Button, Field } from "./ui";
import { SliderBox } from "./form";

const SIDE = 280;
const OUTPUT = 512;
const MAX_ZOOM = 4;

interface Fit {
  zoom: number;
  x: number;
  y: number;
}

/** Scale from picture pixels to screen pixels at zoom 1: the short side fills the circle. */
const baseScale = (width: number, height: number) => SIDE / Math.min(width, height);

/** Pushes the picture back so it still covers the circle. */
function clamp(fit: Fit, width: number, height: number): Fit {
  const scale = baseScale(width, height) * fit.zoom;
  return {
    zoom: fit.zoom,
    x: Math.min(0, Math.max(SIDE - width * scale, fit.x)),
    y: Math.min(0, Math.max(SIDE - height * scale, fit.y)),
  };
}

function centred(width: number, height: number): Fit {
  const scale = baseScale(width, height);
  return { zoom: 1, x: (SIDE - width * scale) / 2, y: (SIDE - height * scale) / 2 };
}

/** Zooms to [zoom] keeping the point at (fx, fy) in the circle where it is. */
function zoomAround(fit: Fit, zoom: number, fx: number, fy: number, w: number, h: number): Fit {
  const next = Math.min(MAX_ZOOM, Math.max(1, zoom));
  const ratio = next / fit.zoom;
  return clamp({ zoom: next, x: fx - (fx - fit.x) * ratio, y: fy - (fy - fit.y) * ratio }, w, h);
}

export function AdjustPicture({
  file,
  onDone,
  onCancel,
}: {
  /** The picked file. The dialog is open while there is one. */
  file: File | null;
  onDone: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [fit, setFit] = useState<Fit>({ zoom: 1, x: 0, y: 0 });
  const [failed, setFailed] = useState(false);
  const drag = useRef<{ x: number; y: number; fit: Fit } | null>(null);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setImage(img);
      setFit(centred(img.naturalWidth, img.naturalHeight));
      setFailed(false);
    };
    img.onerror = () => setFailed(true);
    img.src = url;
    return () => {
      URL.revokeObjectURL(url);
      setImage(null);
    };
  }, [file]);

  const w = image?.naturalWidth ?? 1;
  const h = image?.naturalHeight ?? 1;
  const scale = baseScale(w, h) * fit.zoom;

  function done() {
    if (!image) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const context = canvas.getContext("2d");
    if (!context) return;
    const side = SIDE / scale;
    context.drawImage(image, -fit.x / scale, -fit.y / scale, side, side, 0, 0, OUTPUT, OUTPUT);
    onDone(canvas.toDataURL("image/jpeg", 0.86));
  }

  const placed = {
    left: fit.x,
    top: fit.y,
    width: w * scale,
    height: h * scale,
  };

  return (
    <Dialog open={file !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogBackdrop />
      <DialogContent className="aeyhey-dialog">
        <DialogTitle>Adjust picture</DialogTitle>
        <DialogDescription>
          Drag to move the picture, or use the arrow keys. Zoom with the slider or the mouse wheel.
        </DialogDescription>

        {failed ? (
          <p className="text-danger text-sm">
            That file could not be read as a picture. Try a JPEG or PNG.
          </p>
        ) : (
          <div className="flex flex-col items-center gap-4 pt-2">
            <div
              role="group"
              aria-label="Picture position. Drag, or use the arrow keys, to move it."
              tabIndex={0}
              className="relative cursor-grab touch-none select-none overflow-hidden rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] active:cursor-grabbing"
              style={{ width: SIDE, height: SIDE }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = { x: event.clientX, y: event.clientY, fit };
              }}
              onPointerMove={(event) => {
                const start = drag.current;
                if (!start) return;
                setFit(
                  clamp(
                    {
                      zoom: start.fit.zoom,
                      x: start.fit.x + event.clientX - start.x,
                      y: start.fit.y + event.clientY - start.y,
                    },
                    w,
                    h,
                  ),
                );
              }}
              onPointerUp={() => {
                drag.current = null;
              }}
              onWheel={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                setFit(
                  zoomAround(
                    fit,
                    fit.zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08),
                    event.clientX - box.left,
                    event.clientY - box.top,
                    w,
                    h,
                  ),
                );
              }}
              onKeyDown={(event) => {
                const step = event.shiftKey ? 30 : 8;
                const moves: Record<string, [number, number]> = {
                  ArrowLeft: [step, 0],
                  ArrowRight: [-step, 0],
                  ArrowUp: [0, step],
                  ArrowDown: [0, -step],
                };
                const move = moves[event.key];
                if (!move) return;
                event.preventDefault();
                setFit(clamp({ ...fit, x: fit.x + move[0], y: fit.y + move[1] }, w, h));
              }}
            >
              {image ? (
                <>
                  {/* The whole square, faint, so what falls outside the circle shows. */}
                  <img
                    src={image.src}
                    alt=""
                    draggable={false}
                    className="pointer-events-none absolute max-w-none opacity-35"
                    style={placed}
                  />
                  <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full ring-2 ring-white/90">
                    <img
                      src={image.src}
                      alt=""
                      draggable={false}
                      className="absolute max-w-none"
                      style={placed}
                    />
                  </div>
                </>
              ) : null}
            </div>

            <div className="w-full max-w-[280px]">
              <Field label="Zoom">
                <SliderBox
                  value={fit.zoom}
                  min={1}
                  max={MAX_ZOOM}
                  step={0.01}
                  onValueChange={(zoom) => setFit(zoomAround(fit, zoom, SIDE / 2, SIDE / 2, w, h))}
                />
              </Field>
            </div>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button tone="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button tone="primary" disabled={!image || failed} onClick={done}>
            Use this picture
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
