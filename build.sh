#!/usr/bin/env bash
# Builds Trueline and puts it on the phone. One command, no Xcode window.
#
#   cd ~/trueline && bash build.sh
#
# What it does, in order: pulls, checks the things that have gone wrong before,
# finds your phone, compiles, installs and launches. It stops at the first thing
# that is actually wrong and says what to do about it, rather than opening an
# IDE and leaving you to find out.
#
# Xcode is still there when you want it -- `bash setup-mac.sh` opens the project
# -- and you need it once, at the start, to pick your signing team. After that
# this script is the whole loop.
#
# Add `--no-pull` to build exactly what is on your Mac right now, without
# fetching. Add `--open` to open Xcode instead of building.

set -uo pipefail

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; }

cd "$(dirname "${BASH_SOURCE[0]}")"
root="$(pwd)"

pull=yes
for arg in "$@"; do
  case "$arg" in
    --no-pull) pull=no ;;
    --open)    exec bash setup-mac.sh ;;
    *) bad "I do not know the option $arg. Try --no-pull or --open."; exit 2 ;;
  esac
done

if [ ! -d ios/Trueline.xcodeproj ]; then
  bad "There is no ios/Trueline.xcodeproj here, so this is not the Trueline repo."
  echo "     Find it with:  find ~ -maxdepth 5 -type d -name trueline 2>/dev/null"
  exit 1
fi

# setup-mac.sh already knows how to pull safely, hold your signing team out of
# the tracked project file, check the web bundle and check the project parses.
# Repeating any of that here would be two places to keep right.
if [ "$pull" = yes ]; then
  say "Getting the latest code, and checking it"
  if ! bash setup-mac.sh --checks-only; then
    bad "Something is wrong before the compiler is even reached. See above."
    exit 1
  fi
fi

say "Your phone"
if ! command -v xcodebuild >/dev/null 2>&1; then
  bad "Xcode's command line tools are not on the path."
  echo "     Open Xcode once, then: Xcode → Settings → Locations → Command Line Tools"
  exit 1
fi

# `devicectl` is the modern one and is what Xcode 15 and later use. The older
# `xctrace` listing is kept as the fallback, because a Mac that has only ever
# run an older Xcode still has it.
udid=""
name=""
if xcrun devicectl list devices >/dev/null 2>&1; then
  line="$(xcrun devicectl list devices 2>/dev/null \
    | grep -iE 'connected|available' \
    | grep -viE 'simulator|watch|tv|vision' \
    | head -1)"
  if [ -n "$line" ]; then
    # Three shapes, because Apple has used three. A modern phone reports a
    # plain UUID (8-4-4-4-12); an older one reports 8-16; older still is 40 hex
    # with no dashes. The first version of this only knew the last two, printed
    # "No iPhone found", and then printed the iPhone underneath it.
    udid="$(printf '%s' "$line" | grep -oE \
      '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}|[0-9A-Fa-f]{8}-[0-9A-Fa-f]{16}|[0-9A-Fa-f]{40}' \
      | head -1)"
    name="$(printf '%s' "$line" | awk '{print $1}')"
  fi
fi

if [ -z "$udid" ]; then
  bad "No iPhone found."
  echo "     Plug it in with a cable, unlock it, and tap Trust on the phone."
  echo "     A simulator will not do: it has no LiDAR and no compass, so Measure,"
  echo "     Scan and the compass cannot run on one."
  echo
  echo "     What the Mac can see:"
  xcrun devicectl list devices 2>/dev/null | sed 's/^/       /' | head -12
  exit 1
fi
ok "${name:-your iPhone} ($udid)"

say "Signing"
team=""
[ -f ios/Signing.local.xcconfig ] && team="$(sed -n 's/^[[:space:]]*TRUELINE_DEVELOPMENT_TEAM[[:space:]]*=[[:space:]]*//p' ios/Signing.local.xcconfig | head -1 | tr -d ' \r')"
if [ -n "$team" ]; then
  ok "$team"
else
  warn "No team set, so the build will be refused for a device."
  echo "     Once, in Xcode: bash setup-mac.sh, then Trueline → Signing &"
  echo "     Capabilities → tick Automatically manage signing → pick your team."
  echo "     Then run this script again and it will move it out of the tracked"
  echo "     file for you and never ask again."
fi

say "Building"
derived="$root/.build"
log="$derived/last-build.log"
mkdir -p "$derived"

# `-quiet` because a successful compile has nothing worth reading, and the full
# log is kept in the file named below for the times it does.
if xcodebuild \
  -project ios/Trueline.xcodeproj \
  -scheme Trueline \
  -configuration Debug \
  -destination "id=$udid" \
  -derivedDataPath "$derived" \
  -allowProvisioningUpdates \
  -quiet \
  build >"$log" 2>&1; then
  ok "compiled"
else
  bad "It did not compile. The errors, in order:"
  echo
  # Xcode's log is mostly noise; the lines that matter name a file and a line.
  grep -E '(error|warning):' "$log" | sed 's/^/  /' | head -40
  echo
  echo "     The whole log is at $log"
  echo "     Send me the lines above and I will turn them round."
  exit 1
fi

app="$derived/Build/Products/Debug-iphoneos/Trueline.app"
if [ ! -d "$app" ]; then
  bad "It compiled but produced no app at $app"
  exit 1
fi

say "Onto the phone"
if xcrun devicectl device install app --device "$udid" "$app" >"$derived/install.log" 2>&1; then
  ok "installed"
else
  bad "It compiled but would not install."
  sed 's/^/     /' "$derived/install.log" | tail -20
  echo
  echo "     Almost always this one, the first time: on the phone, Settings →"
  echo "     General → VPN & Device Management → your Apple ID → Trust."
  exit 1
fi

bundle="com.sunnyacres.trueline"
if xcrun devicectl device process launch --device "$udid" "$bundle" >/dev/null 2>&1; then
  ok "launched — look at the phone"
else
  warn "Installed, but would not launch on its own. Tap it on the home screen."
fi

say "What to test"
cat <<'NEXT'
  docs/tests-2-and-20-card.pdf — two pages, the two that decide whether this
  works. Open it on the phone or print it.

    • Test 2  — Measure: lay the phone flat on the floor, tap "Set floor",
                then TOUCH the picture where each corner is.
    • Test 20 — move all four walls and check the app STILL says the room
                has not been measured.

  Then: Agreement → write a proposal, take an option, sign it, and move a
  wall. What changed has to come back as a priced change order.
NEXT
