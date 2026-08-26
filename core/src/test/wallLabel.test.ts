import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';
import type { Facet } from '../project.ts';
import {
  centreOf,
  fitInside,
  insideTheBox,
  nameOf,
  openingLabels,
  wallLabels,
} from '../wallLabel.ts';

function wall(id: string, x: number, y: number, w: number, h: number): Facet {
  return {
    wallId: id,
    kind: 'wall',
    points: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
    depth: 1,
    shade: 0.5,
  };
}

describe('what a wall is called', () => {
  it('turns the id the scanner made into something a person reads', () => {
    strictEqual(nameOf('wall-1'), 'Wall 1');
    strictEqual(nameOf('wall_12'), 'Wall 12');
    strictEqual(nameOf('Wall 3'), 'Wall 3');
  });

  it('leaves somebody’s own words exactly as they typed them', () => {
    // The whole reason renaming exists. Prettifying this is how a label ends
    // up saying something nobody wrote.
    strictEqual(nameOf('behind the washer'), 'behind the washer');
    strictEqual(nameOf('wall by the stairs'), 'wall by the stairs');
    strictEqual(nameOf('north wall-2'), 'north wall-2');
  });

  it('does not mistake a name that merely starts with wall', () => {
    strictEqual(nameOf('wall-1 (rebuilt)'), 'wall-1 (rebuilt)');
  });
});

describe('where the label sits', () => {
  it('is the centre of a rectangle', () => {
    const { x, y, area } = centreOf([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
      { x: 0, y: 4 },
    ]);
    strictEqual(Math.round(x * 100) / 100, 5);
    strictEqual(Math.round(y * 100) / 100, 2);
    strictEqual(area, 40);
  });

  it('is the polygon centroid, not the average of the corners', () => {
    // A wall seen at a sharp angle: a trapezium with two corners close
    // together at one end. The corner average sits at x = 3.75; the centroid
    // sits further toward the wide end, which is where the room to print is.
    const trapezium = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 5 },
    ];
    const corners = {
      x: trapezium.reduce((s, p) => s + p.x, 0) / 4,
      y: trapezium.reduce((s, p) => s + p.y, 0) / 4,
    };
    const { x } = centreOf(trapezium);
    strictEqual(Math.round(corners.x * 100) / 100, 5);
    ok(x > corners.x, `centroid ${x} should sit toward the wide end, past ${corners.x}`);
  });

  it('a face seen edge on has no area and still gets a place', () => {
    const { x, y, area } = centreOf([
      { x: 4, y: 0 },
      { x: 4, y: 10 },
      { x: 4, y: 10 },
      { x: 4, y: 0 },
    ]);
    strictEqual(area, 0);
    strictEqual(x, 4);
    strictEqual(y, 5);
  });

  it('an empty face does not divide by zero', () => {
    deepStrictEqual(centreOf([]), { x: 0, y: 0, area: 0 });
  });
});

describe('one label per wall', () => {
  const SIZE = 1000;

  it('labels every wall that is on screen', () => {
    const labels = wallLabels(
      [wall('wall-1', 0, 0, 400, 400), wall('behind the washer', 500, 0, 400, 400)],
      SIZE
    );
    deepStrictEqual(
      labels.map((l) => l.text).sort(),
      ['Wall 1', 'behind the washer']
    );
  });

  it('a wall broken into strips by a door is labelled once, on its biggest piece', () => {
    // What a wall with an opening in it actually produces: several `wall`
    // facets. Labelling each would print the same name three times on one wall.
    const labels = wallLabels(
      [
        wall('wall-2', 0, 0, 100, 400),
        wall('wall-2', 300, 0, 500, 400), // the big piece
        wall('wall-2', 100, 0, 200, 90),
      ],
      SIZE
    );
    strictEqual(labels.length, 1);
    strictEqual(labels[0]!.text, 'Wall 2');
    // 300 + 500/2 = 550: the middle of the biggest piece, not of the wall.
    strictEqual(labels[0]!.x, 550);
  });

  it('drops a wall seen so nearly edge on that a label would not fit', () => {
    const labels = wallLabels([wall('wall-1', 0, 0, 3, 400), wall('wall-2', 100, 0, 400, 400)], SIZE);
    deepStrictEqual(labels.map((l) => l.text), ['Wall 2']);
  });

  it('never labels the floor, the ceiling, an opening or a piece of furniture', () => {
    const notAWall = (id: string, kind: Facet['kind']): Facet => ({
      ...wall(id, 0, 0, 400, 400),
      kind,
    });
    const labels = wallLabels(
      [
        notAWall('floor', 'floor'),
        notAWall('ceiling', 'floor'),
        notAWall('wall-1', 'opening'),
        notAWall('sofa', 'object'),
      ],
      SIZE
    );
    deepStrictEqual(labels, []);
  });

  it('comes back biggest first, so a bounded draw keeps the ones being looked at', () => {
    const labels = wallLabels(
      [wall('wall-1', 0, 0, 200, 200), wall('wall-2', 0, 0, 600, 600), wall('wall-3', 0, 0, 400, 400)],
      SIZE
    );
    deepStrictEqual(labels.map((l) => l.text), ['Wall 2', 'Wall 3', 'Wall 1']);
  });

  it('an empty projection produces no labels rather than throwing', () => {
    deepStrictEqual(wallLabels([], SIZE), []);
  });
});

describe('the part of a wall that is actually in the picture', () => {
  const SIZE = 1000;

  it('leaves a face that fits alone', () => {
    const box = [
      { x: 100, y: 100 },
      { x: 400, y: 100 },
      { x: 400, y: 400 },
      { x: 100, y: 400 },
    ];
    deepStrictEqual(insideTheBox(box, SIZE), box);
  });

  it('cuts one that runs off the side', () => {
    const shown = insideTheBox(
      [
        { x: -500, y: 200 },
        { x: 600, y: 200 },
        { x: 600, y: 800 },
        { x: -500, y: 800 },
      ],
      SIZE
    );
    ok(shown.every((p) => p.x >= 0 && p.x <= SIZE), JSON.stringify(shown));
    const { x } = centreOf(shown);
    // Half of it is off the left edge, so what is left runs 0..600 and its
    // middle is 300 -- not 50, which is where the whole face's centre is.
    strictEqual(Math.round(x), 300);
  });

  it('gives nothing back for a face entirely out of shot', () => {
    deepStrictEqual(
      insideTheBox(
        [
          { x: 2000, y: 200 },
          { x: 3000, y: 200 },
          { x: 3000, y: 800 },
        ],
        SIZE
      ),
      []
    );
  });

  it('a wall running thousands of pixels off both sides still gets a label you can see', () => {
    // Measured on this project's own kitchen, standing inside a 386-pixel
    // view: two of three labels landed at x = 3920 and x = -3536. Both were
    // drawn, both were outside the box, and neither was ever seen. One label
    // appeared where there should have been three, and it looked like a
    // feature that worked.
    const enormous = {
      wallId: 'wall-1',
      kind: 'wall' as const,
      points: [
        { x: -6000, y: 300 },
        { x: 7000, y: 300 },
        { x: 7000, y: 700 },
        { x: -6000, y: 700 },
      ],
      depth: 1,
      shade: 0.5,
    };
    const [label] = wallLabels([enormous], SIZE);
    ok(label, 'a wall filling the whole view got no label at all');
    ok(
      label!.x >= 0 && label!.x <= SIZE && label!.y >= 0 && label!.y <= SIZE,
      `label landed at ${Math.round(label!.x)}, ${Math.round(label!.y)} — outside 0..${SIZE}`
    );
  });

  it('every label of every wall lands inside the picture, always', () => {
    // The rule, rather than the case. Whatever a projection produces, a label
    // that cannot be seen is not a label.
    const wild = [
      wall('wall-1', -9000, -9000, 20000, 400),
      wall('wall-2', 800, 800, 5000, 5000),
      wall('wall-3', -200, -200, 500, 500),
      wall('wall-4', 300, 300, 200, 200),
    ];
    for (const label of wallLabels(wild, SIZE)) {
      ok(
        label.x >= 0 && label.x <= SIZE && label.y >= 0 && label.y <= SIZE,
        `${label.text} at ${Math.round(label.x)}, ${Math.round(label.y)}`
      );
    }
  });
});

describe('a label has to fit, not just be centred somewhere real', () => {
  const SIZE = 1000;
  const whole = { left: 0, right: SIZE, top: 0, bottom: SIZE };

  it('leaves a label that already fits alone', () => {
    const at = fitInside({ x: 500, y: 500 }, whole, { width: 60, height: 20 }, SIZE);
    deepStrictEqual(at, { x: 500, y: 500 });
  });

  it('pulls one back off the right edge', () => {
    // The bug: "Wall 1" and a door's size had their middles on screen and both
    // ends cut off, because text is centred on its point and runs half its
    // width either way.
    const at = fitInside({ x: 985, y: 500 }, whole, { width: 60, height: 20 }, SIZE);
    strictEqual(at.x, SIZE - 60);
  });

  it('and off the left, the top and the bottom', () => {
    strictEqual(fitInside({ x: 5, y: 500 }, whole, { width: 60, height: 20 }, SIZE).x, 60);
    strictEqual(fitInside({ x: 500, y: 2 }, whole, { width: 60, height: 20 }, SIZE).y, 20);
    strictEqual(fitInside({ x: 500, y: 999 }, whole, { width: 60, height: 20 }, SIZE).y, SIZE - 20);
  });

  it('keeps it on its own face when the face has room', () => {
    // A label that wandered onto the wall next door names the wrong thing,
    // which is worse than one slightly off-centre.
    const face = { left: 100, right: 300, top: 100, bottom: 300 };
    const at = fitInside({ x: 295, y: 200 }, face, { width: 40, height: 12 }, SIZE);
    strictEqual(at.x, 260);
    ok(at.x >= face.left && at.x <= face.right, `${at.x} is off its own face`);
  });

  it('when the face is narrower than the label, staying on screen wins', () => {
    // The two cannot both be had. Off the edge is unreadable; slightly over a
    // neighbour is not, and the area floor drops theslivers anyway.
    const sliver = { left: 980, right: 1000, top: 400, bottom: 600 };
    const at = fitInside({ x: 990, y: 500 }, sliver, { width: 80, height: 20 }, SIZE);
    strictEqual(at.x, SIZE - 80);
  });
});

describe('doors and windows carry their size', () => {
  const SIZE = 1000;
  const hole = (id: string, kind: 'door' | 'window' | 'cased', x: number, w: number) => ({
    wallId: 'wall-1',
    kind: 'opening' as const,
    openingKind: kind,
    openingId: id,
    points: [
      { x, y: 300 },
      { x: x + w, y: 300 },
      { x: x + w, y: 700 },
      { x, y: 700 },
    ],
    depth: 1,
    shade: 0.9,
  });

  it('labels each opening once, by its own id', () => {
    const found = openingLabels([hole('d1', 'door', 100, 300), hole('w1', 'window', 500, 300)], SIZE);
    deepStrictEqual(
      found.map((f) => [f.openingId, f.kind]).sort(),
      [['d1', 'door'], ['w1', 'window']]
    );
  });

  it('drops one too small to print a measurement on', () => {
    // Two numbers and a cross on something the size of a stamp is a smudge,
    // and a smudge on a drawing somebody prices from is worse than nothing.
    deepStrictEqual(openingLabels([hole('d1', 'door', 100, 8)], SIZE), []);
  });

  it('never labels a wall, a floor or a piece of furniture', () => {
    const notAHole = { ...hole('d1', 'door', 100, 300), kind: 'wall' as const };
    deepStrictEqual(openingLabels([notAHole], SIZE), []);
  });

  it('carries where it may sit, so the view can keep it on screen', () => {
    const [found] = openingLabels([hole('d1', 'door', 100, 300)], SIZE);
    strictEqual(found!.left, 100);
    strictEqual(found!.right, 400);
    strictEqual(found!.top, 300);
    strictEqual(found!.bottom, 700);
  });
});
