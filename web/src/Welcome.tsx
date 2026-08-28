import { useEffect, useState } from 'react';
import { FREE, PAID, TITLE, WHAT_IT_DOES } from '../../core/src/entitlement.ts';
import { STORAGE_PREFIX } from './state.ts';
import {
  type Arrived,
  type Persistence,
  RoomLinkError,
  askToKeep,
  checkUnlockCode,
  forgetUnlock,
  rememberUnlock,
  unlockHere,
  unlockedByCode,
  howLongAgo,
  lastFileCopy,
  markOf,
  noteFileCopy,
  roomFromLink,
  roomLink,
  saveJobFile,
  workIn,
} from './roomLink.ts';

/**
 * What a person with no iPhone is told, and what they are told to do about it.
 *
 * ## The gap this closes
 *
 * These screens have always run in an ordinary browser — the whole audit drives
 * them there — and the root `netlify.toml` has always published them as a static
 * site with no backend. So a browser version was built. What it did not do was
 * **say so**. Somebody arriving without a phone met one box: *"Open a scan ·
 * Drop the room.json from a RoomPlan export"*, and no way of learning that they
 * could draw the room by hand and then do every other thing this app does.
 *
 * Sam, asked directly, put it as plainly as it can be put: somebody with no
 * iPhone should be able to draw a room by hand, price it, and get a proposal
 * signed. That is the free way in and the reason to buy the phone app.
 *
 * ## And the part that is not marketing
 *
 * A browser is not a safe place to keep somebody's work, and this file says so
 * on the front door and goes on saying it inside the app. See `KeepACopy` — the
 * whole of that component is one refusal to let a person believe their work is
 * somewhere it is not.
 */

/* ========================================================================== */
/*  The front door                                                            */
/* ========================================================================== */

export function Welcome() {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-slate-900">
        Trueline, in your browser. All of it but the scan.
      </h2>

      <h3 className="mt-4 text-sm font-semibold text-slate-900">
        What you can do here, with no iPhone
      </h3>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        <strong>Draw a room by hand</strong> — tap its corners the way you would walk round it, or
        type it in wall by wall from the tape readings you already have. Or{' '}
        <strong>open a scan you already have</strong>: the <code>room.json</code> from a RoomPlan
        export, or a Trueline job file somebody sent you.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        That much is <strong>free, with no account and no card</strong>, and it is the same line
        the phone draws — not a smaller browser version of it. <strong>Measuring is free; turning
        a drawing into money is paid.</strong> Every one of these works here for nothing:
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-600">
        {FREE.map((feature) => (
          <li key={feature}>
            <strong>{TITLE[feature]}</strong> — {WHAT_IT_DOES[feature]}
          </li>
        ))}
      </ul>

      <h3 className="mt-4 text-sm font-semibold text-slate-900">
        What is part of the subscription, here and on the phone alike
      </h3>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        These are the same ones the phone asks you to pay for. Opening the app in a browser is not
        a way round that, and it was never meant to be:
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-600">
        {PAID.map((feature) => (
          <li key={feature}>
            <strong>{TITLE[feature]}</strong> — {WHAT_IT_DOES[feature]}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        <strong>If you already pay for Trueline, none of that applies to you here.</strong> The
        phone makes a code; paste it in below, once, and this browser behaves exactly as your
        phone does.
      </p>

      <h3 className="mt-4 text-sm font-semibold text-slate-900">
        What needs the iPhone, and why
      </h3>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        <strong>The LiDAR scan.</strong> Walking a room and having the phone measure it needs the
        depth sensor in the phone. A browser has no such thing and there is no way to fake one — so
        a scan is either taken on an iPhone or measured with a tape.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        <strong>A mark pinned during a capture.</strong> Pointing at a rotten sill plate while the
        scan is running places it in the room as you walk. That needs the capture running
        underneath it. You can mark the same damage here afterwards, on the drawing, and it carries
        the same photograph and the same note.
      </p>

      <h3 className="mt-4 text-sm font-semibold text-slate-900">Nothing is uploaded</h3>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        The room is read in this browser and kept in this browser. There is no Trueline server, no
        account, nothing to sign into and nowhere for one person&rsquo;s house to reach
        another&rsquo;s.
      </p>

      <h3 className="mt-4 text-sm font-semibold text-slate-900">
        And the part nobody else tells you
      </h3>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        <strong>A browser is not a safe place to keep your work.</strong> Safari deletes everything
        a site has stored — this app&rsquo;s rooms included — after seven days of browsing in which
        you have not been back to it. That is its published tracking-prevention rule, not a fault,
        and the exact number is Apple&rsquo;s to change. Any browser may also clear it sooner if the
        machine runs short of space, oldest site first.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        Trueline asks the browser to exempt this site and tells you what it answered. A browser can
        say no, and a yes is a rule it keeps rather than a promise it made. So the moment you have
        done any real work in a room, <strong>save the job file</strong> — the app will keep asking
        until you have. A file on your own disk is the only copy nothing can take back.
      </p>

      <div className="mt-5 border-t border-slate-200 pt-4">
        <UnlockCode />
      </div>
    </section>
  );
}

/* ========================================================================== */
/*  The code from the phone                                                   */
/* ========================================================================== */

/**
 * Where somebody who already pays says so, and is believed.
 *
 * ## What this is, said the same way on screen as in the code
 *
 * It is a **courtesy lock**. A code can be forwarded and it will work; anybody
 * who wants to make one can read how in the page they have already downloaded.
 * `roomLink.ts` says the same thing at more length, and the sentence on screen
 * below says it to the person, because a screen that implied this was security
 * would be the app's first outright false statement about itself.
 *
 * What it is for is narrow and worth having: a contractor who has paid must not
 * meet a paywall in his own browser, and there is no account to ask — the phone
 * asks Apple who paid, and the browser asks the code. Nothing here has a login
 * and nothing here ever will.
 */
export function UnlockCode() {
  const [typed, setTyped] = useState('');
  const [said, setSaid] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(() => unlockHere());

  const on = held !== null && checkUnlockCode(held).ok;

  const take = () => {
    const verdict = checkUnlockCode(typed);
    if (!verdict.ok) {
      setSaid(verdict.why);
      return;
    }
    if (!rememberUnlock(typed)) {
      setSaid(
        'The code is good and this browser would not keep it, so it will ask again next time. ' +
          'That is the same storage the rooms are in — see above.'
      );
      return;
    }
    setHeld(unlockHere());
    setTyped('');
    setSaid('Unlocked. This browser now does what your phone does.');
  };

  if (on) {
    return (
      <div data-unlock="on">
        <h3 className="text-sm font-semibold text-slate-900">This browser is unlocked</h3>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          It is holding the code <code className="rounded bg-slate-100 px-1">{held}</code>, so
          everything that is part of the subscription works here as it does on your phone. The
          code lives in this browser&rsquo;s own storage, which means it can be cleared along with
          everything else — if the paywall comes back one day, paste it again.
        </p>
        <p className="mt-3">
          <button
            type="button"
            onClick={() => {
              forgetUnlock();
              setHeld(null);
              setSaid('The code has been taken off this browser.');
            }}
            className="inline-flex min-h-11 items-center rounded-md border border-slate-300
                       bg-white px-4 font-medium text-slate-800 active:bg-slate-100"
          >
            Forget the code
          </button>
        </p>
        {said && <p className="mt-2 text-sm text-slate-600">{said}</p>}
      </div>
    );
  }

  return (
    <div data-unlock="off">
      <h3 className="text-sm font-semibold text-slate-900">Already paying? Unlock this browser</h3>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        On the phone, under <em>Your business</em>, there is a code. Paste it here once and this
        browser stops asking you to pay for what you have already paid for. There is no account
        and no password anywhere in Trueline, and there is not going to be one.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        <strong>Being straight about what this is:</strong> it is a courtesy lock, not a security
        one. The code can be forwarded and it will work, and anybody determined enough can work
        out how one is made by reading this page. It is here so that somebody who pays is not
        nagged in his own browser — not to stop a thief, which nothing running in a browser can
        do.
      </p>
      <label className="mt-3 block">
        <span className="text-xs font-medium text-slate-600">The code from the phone</span>
        <input
          type="text"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          aria-label="The code from the phone"
          placeholder="TL-XXXX-XXXX-XXXX-XXXX"
          autoComplete="off"
          spellCheck={false}
          className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 font-mono
                     text-sm text-slate-900"
        />
      </label>
      <p className="mt-3">
        <button
          type="button"
          onClick={take}
          className="inline-flex min-h-11 items-center rounded-md bg-slate-900 px-4
                     font-semibold text-white active:bg-slate-700"
        >
          Unlock this browser
        </button>
      </p>
      {said && (
        <p
          role="alert"
          className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm
                     leading-relaxed text-amber-900"
        >
          {said}
        </p>
      )}
    </div>
  );
}

/* ========================================================================== */
/*  The nag                                                                   */
/* ========================================================================== */

/** What the browser said, in the words it earned. Never a claim it did not make. */
function sayPersistence(answer: Persistence | null): string {
  switch (answer) {
    case 'granted':
      return 'This browser agreed to keep this site’s storage rather than clearing it to make ' +
        'room. That is what it answered, not a promise it made — it can still be cleared, by ' +
        'you or by the browser.';
    case 'refused':
      return 'This browser was asked to keep this site’s storage and said no. It may clear this ' +
        'room whenever it wants the space, and it will not warn you.';
    case 'unavailable':
      return 'This browser has no way to be asked to keep this site’s storage, so it has not ' +
        'agreed to anything. It may clear this room whenever it wants the space.';
    default:
      return 'Asking this browser whether it will keep this site’s storage…';
  }
}

/**
 * The line that will not let somebody believe a browser is a filing cabinet.
 *
 * ## Modelled on the one that already exists, deliberately
 *
 * `SaveTrouble` in `state.ts` is typed by **which copy is missing** rather than
 * by its words, and `App.tsx` takes the colour off that type and never off the
 * sentence — because a message somebody rewords is a message that quietly
 * changes colour. This is the same failure one step out: on a phone the copy
 * that survives is the one in the scan's folder and in iCloud; in a browser
 * there is no such copy at all until somebody writes a file. So this is red,
 * sticky, and it does not go until a file has actually been written.
 *
 * ## And quiet when there is nothing to lose
 *
 * `workIn` decides. A scan somebody has opened and not touched can be opened
 * again from the same `room.json`, so nagging about it teaches people to
 * dismiss the line before the day it matters. It nags once a person has put
 * something in that is nowhere else — a tape reading, a scope, a proposal — and
 * it names what that is, so the warning is about their work rather than about
 * storage.
 */
export function KeepACopy({ fileName }: { readonly fileName: string }) {
  const [answer, setAnswer] = useState<Persistence | null>(null);
  const [job, setJob] = useState<{ readonly text: string; readonly mark: string } | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let dropped = false;
    void askToKeep().then((got) => {
      if (!dropped) setAnswer(got);
    });
    return () => {
      dropped = true;
    };
  }, []);

  // After every render, because the job changes on every keystroke and there is
  // no cheaper signal to depend on than the job itself. The updater keeps the
  // old object when the fingerprint has not moved, so this settles rather than
  // re-rendering forever.
  useEffect(() => {
    const read = () => {
      let text = '';
      try {
        text = window.localStorage.getItem(STORAGE_PREFIX + fileName) ?? '';
      } catch {
        // No storage to read. `job` stays null and the panel says so below.
      }
      if (text === '') {
        setJob((was) => (was === null ? was : null));
        return;
      }
      const mark = markOf(text);
      setJob((was) => (was !== null && was.mark === mark ? was : { text, mark }));
    };
    read();
    // And again once every effect in this commit has run. `persist` is called
    // from an effect in `App`, which is this component's PARENT, and React runs
    // a parent's effects AFTER its children's -- so the read above always sees
    // the job as it was one keystroke ago. Measured: a wall taped on a fresh
    // scan left this panel still saying there was nothing here to lose.
    const soon = setTimeout(read, 0);
    return () => clearTimeout(soon);
  });

  // So "4 minutes ago" does not sit there saying 4 minutes for an hour.
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(tick);
  }, []);

  const work = job ? workIn(job.text) : { count: 0, says: '' };
  const copy = lastFileCopy(fileName);
  const inAFile = job !== null && copy !== null && copy.mark === job.mark;
  const nagging = work.count > 0 && !inAFile;

  const save = () => {
    if (!job) return;
    const at = new Date().toISOString();
    const name = saveJobFile(job.text, fileName);
    noteFileCopy(fileName, job.text, at);
    setNow(new Date());
    setSaid(`Written to ${name}, in whatever folder this browser saves to.`);
  };

  const makeLink = () => {
    if (!job) return;
    setSaid(null);
    setRefused(null);
    const base = window.location.origin + window.location.pathname;
    void roomLink(job.text, base).then(
      (made) => setLink(made),
      (error: unknown) =>
        setRefused(
          error instanceof RoomLinkError
            ? error.message
            : 'This room could not be put into a link, and the reason was not one this app knows.'
        )
    );
  };

  const copyLink = () => {
    if (link === null) return;
    void navigator.clipboard?.writeText(link).then(
      () => setSaid('The link is on the clipboard.'),
      () => setSaid('This browser would not let the page reach the clipboard — copy it by hand.')
    );
  };

  // `data-keep` is there so a check can read THIS panel's own words rather than
  // the whole page's: "nothing here calls browser storage safe" is a claim about
  // what this component says, and the app around it legitimately uses the word
  // "saved" about other things.
  return (
    <>
    <section
      data-sheet="no"
      data-keep="job"
      {...(nagging ? { role: 'alert' as const } : {})}
      className={
        nagging
          ? 'sticky top-2 z-40 mb-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm ' +
            'text-red-900 shadow-sm'
          : 'mb-4 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700'
      }
    >
      {nagging ? (
        <p className="font-semibold">
          This room is not in a file anywhere. It is in this browser only.
        </p>
      ) : (
        <p className="font-semibold text-slate-900">Where this room actually is</p>
      )}

      <p className="mt-2 leading-relaxed">
        {work.count === 0
          ? 'Nothing has been put into this room yet that is not in the file it came from, so ' +
            'there is nothing here to lose. That changes the moment you measure a wall.'
          : inAFile
            ? `Everything in it — ${work.says} — is in the job file you wrote ` +
              `${copy ? howLongAgo(copy.at, now) : 'a moment ago'}, and in this browser.`
            : `${work.says.charAt(0).toUpperCase()}${work.says.slice(1)} — none of it is in a ` +
              `file. ${copy === null
                ? 'This room has never been written to one.'
                : `The last job file you wrote was ${howLongAgo(copy.at, now)}, and it is older ` +
                  'than what is on this screen.'}`}
      </p>

      {/* What the browser answered about keeping the storage is the second most
          important sentence here and it is only urgent while something is at
          risk. Shown outright when this is nagging; folded away when it is not,
          because every line above the room is a line the room is pushed down
          by — three of `a41`'s controls went below the fold of an 800-tall
          window the first time this panel was drawn in full at all times. */}
      {nagging ? (
        <p className="mt-2 leading-relaxed">{sayPersistence(answer)}</p>
      ) : (
        <details className="mt-2">
          <summary className="min-h-11 cursor-pointer text-sm text-slate-600">
            What this browser said about keeping it
          </summary>
          <p className="mt-1 leading-relaxed">{sayPersistence(answer)}</p>
        </details>
      )}

      <p className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={save}
          disabled={job === null}
          className={
            'inline-flex min-h-11 items-center rounded-md px-4 font-semibold ' +
            (nagging
              ? 'bg-red-800 text-white active:bg-red-900'
              : 'bg-slate-900 text-white active:bg-slate-700')
          }
        >
          Write the job to a file
        </button>
        <button
          type="button"
          onClick={makeLink}
          disabled={job === null}
          className="inline-flex min-h-11 items-center rounded-md border border-slate-300 bg-white
                     px-4 font-medium text-slate-800 active:bg-slate-100"
        >
          Make a link to this room
        </button>
      </p>

      {said && <p className="mt-2 leading-relaxed">{said}</p>}

      {refused && (
        <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-3 leading-relaxed
                      text-amber-900">
          {refused}
        </p>
      )}

      {link !== null && (
        <div className="mt-3 rounded-md border border-slate-300 bg-slate-50 p-3">
          <p className="leading-relaxed text-slate-700">
            <strong>This link has a customer&rsquo;s room inside it.</strong> The room travels in
            the part of the address after the <code>#</code>, which a browser never sends to any
            server — so nothing is uploaded by making it or by opening it. But anyone who is
            forwarded the link has the room: the measurements, the scope and the prices. Send it
            the way you would send the drawing itself, and not into a group chat.
          </p>
          <p className="mt-2 leading-relaxed text-slate-600">
            It carries no photographs. Their files stay where they were taken.
          </p>
          <label className="mt-3 block">
            <span className="text-xs font-medium text-slate-600">
              The link, {link.length.toLocaleString()} characters
            </span>
            <textarea
              readOnly
              rows={3}
              value={link}
              aria-label="The link to this room"
              className="mt-1 w-full rounded-md border border-slate-300 bg-white p-2 font-mono
                         text-xs text-slate-900"
            />
          </label>
          <p className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copyLink}
              className="inline-flex min-h-11 items-center rounded-md bg-slate-900 px-4
                         font-semibold text-white active:bg-slate-700"
            >
              Copy the link
            </button>
            <button
              type="button"
              onClick={() => {
                setLink(null);
                setSaid(null);
              }}
              className="inline-flex min-h-11 items-center rounded-md border border-slate-300
                         bg-white px-4 font-medium text-slate-800 active:bg-slate-100"
            >
              Done with the link
            </button>
          </p>
        </div>
      )}
    </section>
    {/* And, while a room is open in a browser, the way somebody who already
        pays says so. Only when this browser is not already unlocked: a
        contractor who has pasted his code once must not go on being offered a
        box to paste it into. */}
    {/* `scroll-mt-24` below is not decoration. The panel above is sticky while
        it is nagging, so anything scrolled to the top of the window lands
        underneath it — and a control a thumb cannot see is the same thing as a
        control that does not work. Measured: the audit could not press "Forget
        the code" at all. */}
    {!unlockedByCode() && (
      <details className="mb-4 scroll-mt-24 rounded-lg border border-slate-200 bg-white p-4">
        <summary className="min-h-11 cursor-pointer text-sm font-medium text-slate-700">
          Already paying for Trueline? Unlock this browser
        </summary>
        <div className="mt-2">
          <UnlockCode />
        </div>
      </details>
    )}
    </>
  );
}

/* ========================================================================== */
/*  A room that arrived in a link                                             */
/* ========================================================================== */

/**
 * Opens the room in the address, if there is one, and says so when it will not.
 *
 * Mounted whatever is on screen, because the link has to work on a cold browser
 * where the front door is what is showing. It owns its own failure message: a
 * link that will not open is a fact about the link, and routing it through the
 * reducer's error would have made it look like a fact about a file somebody
 * chose.
 *
 * The fragment is cleared once the room is in. Two reasons, both real: a
 * customer's room stops sitting in the address bar and in this browser's
 * history, and a reload stops re-opening a room the person may since have
 * renamed or moved on from — by then it is in storage under its own name and
 * the ordinary restore has it.
 */
export function RoomFromLink({ onRoom }: { readonly onRoom: (project: string) => void }) {
  const [trouble, setTrouble] = useState<string | null>(null);
  const [renamed, setRenamed] = useState<string | null>(null);

  useEffect(() => {
    let dropped = false;
    const taken = (name: string): boolean => {
      try {
        return window.localStorage.getItem(STORAGE_PREFIX + name) !== null;
      } catch {
        return false;
      }
    };
    const read = () => {
      void roomFromLink(window.location.hash, taken).then(
        (arrived: Arrived | null) => {
          if (dropped || arrived === null) return;
          onRoom(arrived.project);
          setRenamed(arrived.renamedFrom);
          setTrouble(null);
          try {
            window.history.replaceState(
              null,
              '',
              window.location.pathname + window.location.search
            );
          } catch {
            // An address bar that will not be rewritten is not worth losing the
            // room over. The room is open either way.
          }
        },
        (error: unknown) => {
          if (dropped) return;
          setTrouble(
            error instanceof RoomLinkError
              ? error.message
              : 'There is a room in this link and it could not be read.'
          );
        }
      );
    };

    read();

    // And again whenever the address changes, which is not belt and braces:
    // pasting a link into a tab that already has this app open changes only the
    // fragment, and that is a SAME-DOCUMENT navigation. Nothing reloads, React
    // does not remount, and without this the room in the link would simply not
    // appear -- the page would go on showing whatever it was showing. It is the
    // identical failure the route in `App.tsx` was fixed for, and it was found
    // the same way: by a browser that did nothing at all.
    window.addEventListener('hashchange', read);
    return () => {
      dropped = true;
      window.removeEventListener('hashchange', read);
    };
    // Once, and then on every change of address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (trouble !== null) {
    return (
      <div
        role="alert"
        className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
      >
        {trouble}
      </div>
    );
  }
  if (renamed !== null) {
    return (
      <div
        role="note"
        className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm
                   leading-relaxed text-amber-900"
      >
        There was already a room called <strong>{renamed}</strong> in this browser, so the one in
        the link was opened under a name of its own. Nothing you had was overwritten.
      </div>
    );
  }
  return null;
}
