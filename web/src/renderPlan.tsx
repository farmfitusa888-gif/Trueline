import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Room } from '../../core/src/room.ts';
import type { Damage } from '../../core/src/damage.ts';
import type { Footprint } from '../../core/src/obstruction.ts';
import { Plan } from './Plan.tsx';
import { UnitsProvider } from './units.tsx';
import { planSvg } from './sheet.ts';

/**
 * A room's plan as standalone SVG, for a room that is not the one on screen.
 *
 * A claim covers a job and a job is several rooms, but only one of them is
 * open. The other drawings have to come from somewhere, and the rule this
 * codebase runs on says where: **the same renderer, or none**. A second
 * drawing function fed by the same model is a second drawing function that will
 * eventually disagree with the first, and the one that would be wrong is the
 * one on the document that left the building.
 *
 * So the real component is rendered into a detached container and the real
 * element is serialised — the same `<svg>` the contractor would be looking at
 * if that room were the open one, through the same `planSvg` the picture and
 * the print already go through.
 *
 * `flushSync` rather than waiting a frame: this runs inside a click handler
 * building a file, and a plan that had not painted yet would serialise as an
 * empty drawing. The container never enters the document, so nothing flashes.
 */
export function planSvgFor(
  room: Room,
  damages: readonly Damage[],
  footprints: readonly Footprint[] = []
): string {
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    flushSync(() => {
      root.render(
        <UnitsProvider>
          <Plan
            room={room}
            north={null}
            selected={null}
            obstructions={[]}
            footprints={footprints}
            damages={damages}
            onSelect={() => {}}
          />
        </UnitsProvider>
      );
    });
    const svg = container.querySelector('svg');
    if (!svg) return '';
    return planSvg(svg as SVGSVGElement);
  } finally {
    // Unmounted synchronously so the container and its React tree go with the
    // function that made them. A root left mounted on a detached node is a leak
    // that grows by one every time somebody builds a claim file.
    flushSync(() => root.unmount());
  }
}
