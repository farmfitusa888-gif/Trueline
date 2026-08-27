import { useEffect, useRef, useState } from 'react';

/**
 * Somewhere to sign, with a finger.
 *
 * Lifted out of `Agree.tsx` when the change order needed one too. A signed
 * change order is a signed agreement — see `core/src/change.ts` — so it gets
 * the same pad, the same strokes and the same PNG, rather than a second
 * implementation that could drift into being slightly less of a signature.
 */
export function SignaturePad({
  onChange,
  disabled,
}: {
  readonly onChange: (dataUrl: string) => void;
  readonly disabled: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const strokes = useRef<{ x: number; y: number }[][]>([]);
  const drawing = useRef(false);
  const [marked, setMarked] = useState(false);

  const redraw = () => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    context.clearRect(0, 0, element.width, element.height);
    context.lineWidth = 2.5;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = 'rgb(var(--c-ink))';
    for (const stroke of strokes.current) {
      if (stroke.length < 2) continue;
      context.beginPath();
      context.moveTo(stroke[0]!.x, stroke[0]!.y);
      for (const point of stroke.slice(1)) context.lineTo(point.x, point.y);
      context.stroke();
    }
  };

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const fit = () => {
      const box = element.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      element.width = Math.round(box.width * ratio);
      element.height = Math.round(box.height * ratio);
      const context = element.getContext('2d');
      context?.setTransform(ratio, 0, 0, ratio, 0, 0);
      redraw();
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const at = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const finish = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const element = canvas.current;
    if (!element) return;
    setMarked(true);
    onChange(element.toDataURL('image/png'));
  };

  return (
    <div>
      <canvas
        ref={canvas}
        className={`h-40 w-full touch-none rounded-md border-2 border-dashed bg-white
                    ${disabled ? 'border-slate-200 opacity-50' : 'border-slate-400'}`}
        aria-label="Sign here with your finger"
        role="img"
        onPointerDown={(event) => {
          if (disabled) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drawing.current = true;
          strokes.current.push([at(event)]);
          redraw();
        }}
        onPointerMove={(event) => {
          if (!drawing.current || disabled) return;
          strokes.current[strokes.current.length - 1]?.push(at(event));
          redraw();
        }}
        onPointerUp={finish}
        onPointerLeave={finish}
        onPointerCancel={finish}
      />
      <div className="mt-1 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          {marked ? 'Signed above.' : 'Sign above with a finger.'}
        </p>
        <button
          type="button"
          onClick={() => {
            strokes.current = [];
            setMarked(false);
            onChange('');
            redraw();
          }}
          className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-medium
                     text-slate-700 active:bg-slate-100"
        >
          Start again
        </button>
      </div>
    </div>
  );
}

