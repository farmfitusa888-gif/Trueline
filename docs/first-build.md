# Your first build, from nothing

This is for a Mac that has never seen this repository. It assumes nothing is
installed and nothing is cloned. `docs/on-the-phone.md` picks up where this
stops — it assumes the repo is already at `~/trueline`, which is the step this
page exists to do.

Total time: about an hour, and **most of it is Xcode downloading.** The part
where you actually type things is ten minutes.

---

## Before you start, three things you need

1. **A Mac.** iOS apps cannot be built anywhere else. There is no way around
   this one.
2. **An iPhone with LiDAR** — iPhone 12 Pro or newer, any Pro or Pro Max — and a
   **cable**. A simulator will not do: it has no LiDAR and no compass, so Scan
   and Measure cannot run on one, and those are the app.
3. **An Apple ID.** Any Apple ID. You do **not** need the $99/year Apple
   Developer Program to put the app on your own phone — a free Apple ID gives
   you a "personal team", and that is enough for everything on this page. You
   need the paid program later, for TestFlight and the App Store.

---

## Step 1 — Xcode

Open the **App Store** on the Mac, search **Xcode**, install it. It is about
7 GB and it is slow. Start it now and read the rest of this while it goes.

When it finishes, **open Xcode once** and let it install the extra components it
asks for. It will not work until you have.

Then, in Terminal (⌘-space, type `terminal`, Return):

```bash
xcode-select --install
```

If it says *"command line tools are already installed"*, good — that is Xcode
having done it for you. If it opens an installer, let it finish.

---

## Step 2 — Get the code

Paste this whole block into Terminal. It clones into `~/trueline`, which is what
every other document here assumes.

```bash
cd ~ && git clone https://github.com/farmfitusa888-gif/trueline.git && cd ~/trueline && ls
```

You should see `README.md`, `build.sh`, `core`, `docs`, `ios`, `web`.

**If it says `git: command not found`:** macOS ships git with the command line
tools from step 1. Finish that first.

**If it asks for a username and password:** the repository is private, so git
needs to know who you are. The simplest fix is to install GitHub's own helper:

```bash
brew install gh && gh auth login
```

and then run the clone again. (If `brew` is not installed either, get it from
<https://brew.sh> — one paste — or download the repository as a ZIP from
GitHub's own page and unzip it to `~/trueline`.)

---

## Step 3 — Signing, once, in Xcode

This is the one step that has to happen in the Xcode window, and it happens
exactly once on this Mac. Every build after it is Terminal only.

```bash
cd ~/trueline && open ios/ScanToBid.xcodeproj
```

In the window that opens:

1. Click the blue **ScanToBid** at the very top of the left sidebar.
2. Middle column, pick the **ScanToBid** target (under TARGETS, not PROJECT).
3. Click the **Signing & Capabilities** tab.
4. Tick **Automatically manage signing**.
5. **Team** → pick yours. If the list is empty: **Xcode → Settings → Accounts →
   `+` → Apple ID**, sign in, come back, and it will be there as
   *"Your Name (Personal Team)"*.

Leave the Bundle Identifier alone. It is `com.sunnyacres.trueline` and it has to
stay that, because the subscription products in App Store Connect are named
after it.

Then **quit Xcode**. You are done with the window.

> **Why this is a one-time step and not part of the script:** your Apple team is
> yours and belongs to this Mac, not to the repository. `setup-mac.sh` lifts it
> out of the tracked project file and into `ios/Signing.local.xcconfig`, which
> git ignores — so from here on no pull can ever stop on it, and a fresh clone
> on somebody else's Mac still works with no team at all.

---

## Step 4 — Plug the phone in

Cable, into the Mac. **Unlock the phone.** A **Trust This Computer?** prompt
appears on the phone — tap **Trust** and type your passcode.

If no prompt appears, unplug and plug in again with the phone unlocked. It only
asks when the screen is on and unlocked.

---

## Step 5 — Build it

```bash
cd ~/trueline && bash build.sh
```

That is the whole loop, now and every time after this. It pulls, checks the
things that have gone wrong before, finds your phone, compiles, installs and
launches. It stops at the first thing that is actually wrong and says what to
do about it.

Expect **two to four minutes** the first time. After that it is much faster.

---

## Step 6 — Trust the app, once

The first install will land on the phone and refuse to open, saying something
about an untrusted developer. That is iOS doing its job — it has never seen a
certificate from your Apple ID before.

On the **phone**: **Settings → General → VPN & Device Management → your Apple
ID → Trust**.

Then run `bash build.sh` again, or just tap ScanToBid on the home screen.

---

## When it goes wrong

The script says which step it stopped on. These are the ones you are most likely
to hit, in the order they happen.

| It says | What it means | What to do |
|---|---|---|
| `bash: build.sh: No such file or directory` | You are not in the repo folder. | `bash ~/trueline/install-command.sh` once, then `trueline` from anywhere. |
| `bash: ~/trueline/install-command.sh: No such file or directory` | The file is in the repo but not on your Mac yet — you have not pulled since it was added. | `cd ~/trueline && bash setup-mac.sh --checks-only` first, then run it. |
| `npm error enoent Could not read package.json` | Same thing. `npm` reads the folder you are standing in, and there is no `package.json` in your home folder. | The same fix — the installed `trueline` command carries the path inside it. |
| `Xcode's command line tools are not on the path` | Step 1 is not finished. | Open Xcode once, then **Xcode → Settings → Locations → Command Line Tools** and pick the version in the dropdown. |
| `No iPhone found` | Cable, lock screen, or Trust. | Unlock the phone, unplug and replug, tap **Trust**. A simulator will not do. |
| `No signing team` | Step 3 has not happened, or did not stick. | Run `bash setup-mac.sh` — it reads the team off your own certificate and writes it down. If it says no certificate exists, redo step 3. |
| `It did not compile` | A real compile error. | The script prints the errors and the file and line of each. The whole log is at `.build/last-build.log`. Send me those lines. |
| `It compiled but would not install` | Almost always step 6. | Trust the developer on the phone, then run it again. |

**A free personal team expires after 7 days.** The app stops opening and says
so. Run `bash build.sh` again — that is the whole fix, and it is one of the
reasons the paid Developer Program is worth $99 once you are handing builds to
Gilbert.

---

## What to do the moment it opens

`docs/first-six-tests.md` — six tests, any room with four walls, one afternoon.
They are the ones that decide whether anything else about this product is worth
doing. The full 22 are in `docs/on-the-phone.md` when you want them.

---

## After the first time

Install the one-word command, once. The first half pulls, because
`install-command.sh` arrived in a commit and a file cannot be run before it has
been fetched — and `setup-mac.sh --checks-only` is the pull that holds your
signing team and the built bundle out of its way:

```bash
cd ~/trueline && bash setup-mac.sh --checks-only && bash install-command.sh
```

Then the whole loop, forever, from any folder:

```bash
trueline
```

`trueline sim` for the simulator, `trueline open` for Xcode, `trueline check` for
every test and check without building, `trueline here` to move this Terminal into
the repo. `trueline help` lists them.

The long way still works from inside the repo:

```bash
cd ~/trueline && bash build.sh
```

Add `--no-pull` to build exactly what is on your Mac right now without fetching.
Add `--open` to open Xcode instead of building.
