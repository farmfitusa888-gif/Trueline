# The two films

Both are the real app, running in a real browser at the size of a phone. Nothing
in either is a mock-up, a slideshow of screenshots, or a script acted out over
pictures: every tap is a real tap, every number on screen is one the app worked
out, and if the app breaks the film breaks with it.

| File | What it is | Length |
|---|---|---|
| `demo.mp4` | The work being done, from an empty app: the business and eight rates typed once, a scan opened, two walls put a tape on, the takeoff, the price, the proposal written and signed, a deposit raised, the damage marked and metered, and the files that leave. | 1:42 |
| `tour.mp4` | The guided tour running over the finished job — all twenty stops, every screen in the app, in the order of a job. | 1:54 |

430 × 932, H.264 in mp4, so they play in Safari, in Messages, and on a phone.

## Rebuilding them

    npm run build
    (cd web && npx vite preview --port 4173 --host 127.0.0.1 &)
    node site/tools/film.mjs

The caption strip across the top is drawn by `film.mjs` and is **not** part of
the app. It says its piece and clears, so most of every shot is the app with
nothing on top of it.

The films are only as current as the last time that command was run. Anything
that changes a screen changes what the film should show, and nothing checks
that for you — re-run it.
