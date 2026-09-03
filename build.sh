#!/usr/bin/env bash
# Builds ScanToBid and puts it on the phone. One command, no Xcode window.
#
#   trueline
#
# That word works from any folder, once `bash ~/trueline/install-command.sh` has
# been run the one time. From inside the repo this file is also just:
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
#
# Add `--sim` to run it in the iPhone 17 Pro Max simulator instead of on a
# phone. That needs no cable, no signing team and no device, and it is the
# fastest way to click through every screen -- but read what it CANNOT do,
# under "the simulator" below, before trusting anything it shows you.

set -uo pipefail

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; }

cd "$(dirname "${BASH_SOURCE[0]}")"
root="$(pwd)"

pull=yes
sim=no
simulator="iPhone 17 Pro Max"
for arg in "$@"; do
  case "$arg" in
    --no-pull) pull=no ;;
    --open)    exec bash setup-mac.sh ;;
    --sim)     sim=yes ;;
    --sim=*)   sim=yes; simulator="${arg#--sim=}" ;;
    *)
      bad "I do not know the option $arg. Try --no-pull, --open or --sim."
      # Options are read before the pull, so an old copy of this script rejects
      # a flag that the current one understands -- and pulling is what fixes it.
      # It has happened, with --sim.
      echo "     If you were told this option exists, this script is out of date:"
      echo "       git pull origin main && bash build.sh $arg"
      exit 2 ;;
  esac
done

if [ ! -d ios/Trueline.xcodeproj ]; then
  bad "There is no ios/Trueline.xcodeproj here, so this is not the ScanToBid repo."
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

if ! command -v xcodebuild >/dev/null 2>&1; then
  bad "Xcode's command line tools are not on the path."
  echo "     Open Xcode once, then: Xcode → Settings → Locations → Command Line Tools"
  exit 1
fi

# ---------------------------------------------------------------- the simulator
#
# What it is for: clicking through every screen, fast, with no cable and no
# signing team. The whole web half of this app -- the plan, the takeoff, the
# price, the proposal, the claim, the drawing screen -- runs in a web view and
# is identical on a simulator and on a phone, so a click-through there is a real
# click-through of most of the product.
#
# What it CANNOT do, and none of these is a bug in the simulator:
#
#   - **Scan.** RoomPlan needs LiDAR. `RoomCaptureSession.isSupported` is false
#     and the Scan tab says so.
#   - **Measure.** ARKit world tracking needs a camera. There is none.
#   - **North on the plan.** No magnetometer.
#   - **Apple Intelligence.** A simulator reports the model unavailable, so
#     every draft button is absent -- which is exactly what an older iPhone
#     sees, and worth seeing on purpose.
#   - **StoreKit against the real store.** The scheme's `Trueline.storekit`
#     handles that: local products, real purchase flow, no money.
#
# So: click through everything, and take anything a sensor would have produced
# from a real phone.
if [ "$sim" = yes ]; then
  say "The simulator"
  udid="$(xcrun simctl list devices available \
    | grep -F "$simulator (" | head -1 \
    | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}')"
  if [ -z "$udid" ]; then
    bad "No simulator called \"$simulator\" is installed."
    echo "     Xcode → Settings → Components installs the iOS runtimes, and each"
    echo "     runtime brings its own set of devices."
    echo
    echo "     What this Mac has:"
    xcrun simctl list devices available | grep -E '^\s+iPhone' | sed 's/^/       /' | head -12
    echo
    echo "     Pick one of those with:  bash build.sh --sim=\"iPhone 17 Pro\""
    exit 1
  fi
  ok "$simulator ($udid)"
  xcrun simctl boot "$udid" >/dev/null 2>&1 || true
  open -a Simulator >/dev/null 2>&1 || true

  say "Building for the simulator"
  derived="$root/.build-sim"
  log="$derived/last-build.log"
  mkdir -p "$derived"
  # No signing team and no provisioning: a simulator build needs neither, which
  # is the other reason this path exists.
  if xcodebuild \
    -project ios/Trueline.xcodeproj \
    -scheme ScanToBid \
    -configuration Debug \
    -destination "id=$udid" \
    -derivedDataPath "$derived" \
    CODE_SIGNING_ALLOWED=NO \
    -quiet \
    build >"$log" 2>&1; then
    ok "compiled"
  else
    bad "It did not compile. The errors, in order:"
    grep -E 'error:' "$log" | sed 's/^/       /' | head -20
    echo
    echo "     The whole log:  $log"
    exit 1
  fi

  app="$(find "$derived/Build/Products" -maxdepth 2 -name 'ScanToBid.app' -print -quit)"
  if [ -z "$app" ]; then
    bad "It compiled and I cannot find ScanToBid.app under $derived/Build/Products."
    exit 1
  fi

  say "Installing"
  if xcrun simctl install "$udid" "$app" >"$derived/install.log" 2>&1; then
    ok "installed"
  else
    bad "It would not install."
    sed 's/^/       /' "$derived/install.log" | head -12
    exit 1
  fi

  bundle="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Info.plist" 2>/dev/null)"
  if xcrun simctl launch "$udid" "${bundle:-com.sunnyacres.trueline}" >/dev/null 2>&1; then
    ok "launched"
  else
    warn "It is installed. Tap it on the simulator's home screen."
  fi
  say "Click through it"
  echo "  Rooms → Draw a room → tap four corners → Open it → Plan, Room, Takeoff,"
  echo "  Price (set a rate), Agreement, Work, Insurance, Files."
  echo
  echo "  Scan and Measure will say what they need. That is right: a simulator has"
  echo "  no LiDAR and no camera, so there is nothing for them to do."
  exit 0
fi

say "Your phone"

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

# Ten characters, capitals and digits. Checked rather than merely present,
# because the string that was actually in there was
# `$(TRUELINE_DEVELOPMENT_TEAM)` -- the placeholder pointing at itself -- and
# this line reported it as the team with a green tick. Every check above it
# passed, xcodebuild refused the build, and nothing in the output said why.
if printf '%s' "$team" | grep -qE '^[A-Z0-9]{10}$'; then
  ok "$team"
else
  if [ -n "$team" ]; then
    bad "ios/Signing.local.xcconfig holds \"$team\", which is not a team."
  else
    bad "No signing team, so xcodebuild will refuse to build for a device."
  fi
  echo "     Fix it without opening Xcode:  bash setup-mac.sh"
  echo "     It reads the team off your own signing certificate and writes it"
  echo "     there. If this Mac has no certificate yet, it says so and tells"
  echo "     you the one thing to do in Xcode to create one."
  echo
  echo "     Stopping here rather than compiling for two minutes and failing"
  echo "     on the last step."
  exit 1
fi

say "Building"
derived="$root/.build"
log="$derived/last-build.log"
mkdir -p "$derived"

# `-quiet` because a successful compile has nothing worth reading, and the full
# log is kept in the file named below for the times it does.
if xcodebuild \
  -project ios/Trueline.xcodeproj \
  -scheme ScanToBid \
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

app="$derived/Build/Products/Debug-iphoneos/ScanToBid.app"
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
