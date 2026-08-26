import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';
import type { Facet } from '../project.ts';
import { centreOf, nameOf, wallLabels } from '../wallLabel.ts';

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
