#!/usr/bin/env bash
# Gets this repository ready to open in Xcode, and says what it found.
#
# Run it in Terminal on the Mac:
#
#   cd ~/trueline && bash setup-mac.sh
#
# It does not install anything and it does not change any of your code. It
# pulls, checks the things that have gone wrong before, and opens the project.

set -uo pipefail

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; }

cd "$(dirname "${BASH_SOURCE[0]}")"
root="$(pwd)"

say "Where you are"
ok "$root"
if [ ! -d ios/Trueline.xcodeproj ]; then
  bad "There is no ios/Trueline.xcodeproj here, so this is not the Trueline repo."
  echo "     Find it with:  find ~ -maxdepth 5 -type d -name trueline 2>/dev/null"
  exit 1
fi

say "Getting the latest code"
if ! git diff --quiet || ! git diff --cached --quiet; then
  warn "You have local changes. They are being put aside so the pull is clean."
  git stash push -u -m "setup-mac $(date +%Y-%m-%d-%H%M)" >/dev/null
  warn "Get them back later with:  git stash pop"
fi
branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "main" ]; then
  warn "You are on '$branch', not main. Switching."
  git checkout main >/dev/null 2>&1 || { bad "Could not switch to main."; exit 1; }
fi
before="$(git rev-parse --short HEAD)"
for try in 1 2 3 4; do
  if git pull --ff-only origin main; then break; fi
  warn "Pull failed (try $try). Waiting $((2 ** try))s."
  sleep $((2 ** try))
done
after="$(git rev-parse --short HEAD)"
if [ "$before" = "$after" ]; then ok "Already up to date at $after"; else ok "$before → $after"; fi
echo "     $(git log -1 --format='%s')"

say "The web screens inside the app"
# This is the one that bit us: the correction screens live in a web bundle
# committed into the iOS project, so a Mac with no Node still builds a working
# app. When it goes stale the phone shows screens from weeks ago and nothing
# says so — which is exactly what happened.
if [ ! -f ios/Trueline/Web/index.html ]; then
  bad "ios/Trueline/Web is missing. The app would open to a blank screen."
  echo "     If Node is installed:  npm ci && npm run ship-web"
  exit 1
fi
ok "present ($(find ios/Trueline/Web -type f | wc -l | tr -d ' ') files)"
if command -v node >/dev/null 2>&1; then
  ok "node $(node -v) — checking the bundle is current"
  npm ci --silent >/dev/null 2>&1 || npm install --silent >/dev/null 2>&1
  npm run build --silent >/dev/null 2>&1
  if diff -r web/dist ios/Trueline/Web >/dev/null 2>&1; then
    ok "the bundle matches the source"
  else
    warn "the bundle was stale — rebuilding it"
    npm run ship-web >/dev/null 2>&1 && ok "rebuilt. Commit it: git add ios/Trueline/Web"
  fi
else
  warn "No Node on this Mac, so the bundle cannot be checked here."
  echo "     That is fine — the committed one is what Xcode ships."
fi

say "Xcode"
if ! command -v xcodebuild >/dev/null 2>&1; then
  bad "Xcode's command line tools are not on the path."
  echo "     Open Xcode once, then: Xcode → Settings → Locations → Command Line Tools"
  echo "     Or run:  xcode-select --install"
else
  ok "$(xcodebuild -version | head -1)"
  sdk="$(xcodebuild -showsdks 2>/dev/null | grep -o 'iphoneos[0-9.]*' | tail -1)"
  [ -n "$sdk" ] && ok "iOS SDK $sdk"
fi

say "Your iPhone"
devices="$(xcrun xctrace list devices 2>/dev/null | sed -n '/^== Devices ==/,/^== /p' | grep -v '^==' | grep -v '^$' | grep -v Simulator || true)"
if [ -z "$devices" ]; then
  warn "No phone seen. Plug it in with a cable, unlock it, and tap Trust."
  echo "     A simulator will not do: it has no LiDAR and no compass, and"
  echo "     Measure, Scan and the compass all need real hardware."
else
  echo "$devices" | sed 's/^/  • /'
fi

say "What to do next"
cat <<'NEXT'
  1. Xcode opens now. Top of the window, next to "Trueline", click the
     destination dropdown and pick YOUR IPHONE BY NAME — not a simulator.
  2. Press ⌘R.
  3. First time only, on the phone:
     Settings → General → VPN & Device Management → your Apple ID → Trust
     Then ⌘R again.

  If Xcode complains about signing: click the blue "Trueline" at the top of
  the left sidebar → Signing & Capabilities → tick "Automatically manage
  signing" and pick your team. Bundle ID stays com.sunnyacres.trueline.

  Then walk docs/on-the-phone.md. Tests 2 and 20 matter most:
    • 2  — Measure: lay the phone flat on the floor and tap "Set floor"
    • 20 — move all four walls and check the app STILL says unmeasured
NEXT

say "Opening Xcode"
open ios/Trueline.xcodeproj 2>/dev/null && ok "opened" || warn "Could not open it. Run: open ios/Trueline.xcodeproj"
