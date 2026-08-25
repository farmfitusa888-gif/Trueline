#!/usr/bin/env bash
# Gets this repository ready to open in Xcode, and says what it found.
#
# Run it in Terminal on the Mac:
#
#   cd ~/trueline && bash setup-mac.sh
#
# The very first time, the script is not on your Mac yet, so pull once by hand:
#
#   cd ~/trueline && git pull && bash setup-mac.sh
#
# If that pull stops with "your local changes would be overwritten by merge"
# and names the project file, that is Xcode having written your signing team
# into it. Throw that one line away and pull again — from then on this script
# holds on to it for you and the pull never stops again:
#
#   git checkout -- ios/Trueline.xcodeproj/project.pbxproj && git pull
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

say "Your signing team"
# Xcode writes your Apple developer team into the project file the moment you
# pick it, and that file is tracked. So the next pull says "your local changes
# would be overwritten" and stops — which is exactly what happened. The team is
# yours and belongs to your Mac, not to the repository, so it is lifted out
# before the pull and put back after it.
pbx="ios/Trueline.xcodeproj/project.pbxproj"
team=""
if ! git diff --quiet -- "$pbx"; then
  team="$(git diff -U0 -- "$pbx" \
    | sed -n 's/^+[[:space:]]*DEVELOPMENT_TEAM = \(.*\);$/\1/p' \
    | head -1 | tr -d '"')"
  other="$(git diff -U0 -- "$pbx" | grep -E '^[+-][^+-]' \
    | grep -vcE 'DEVELOPMENT_TEAM|CODE_SIGN_STYLE|LastUpgradeCheck')"
  if [ "${other:-0}" -gt 0 ]; then
    bad "The project file has changes that are not just your signing team."
    echo "     That is a real edit and this script will not throw it away."
    echo "     Look at it with:  git diff -- $pbx"
    echo "     Keep it:   git stash push -- $pbx     (then re-run this script)"
    echo "     Drop it:   git checkout -- $pbx       (then re-run this script)"
    exit 1
  fi
  if [ -n "$team" ]; then
    ok "found your team ($team) — holding it while we pull"
  else
    ok "the only change is signing — setting it aside"
  fi
  git checkout -- "$pbx"
else
  ok "nothing of yours in the project file"
fi

say "Getting the latest code"
if ! git diff --quiet || ! git diff --cached --quiet; then
  warn "You have other local changes. They are being put aside so the pull is clean."
  git stash push -u -m "setup-mac $(date +%Y-%m-%d-%H%M)" >/dev/null
  warn "Get them back later with:  git stash pop"
fi
branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "main" ]; then
  warn "You are on '$branch', not main. Switching."
  git checkout main >/dev/null 2>&1 || { bad "Could not switch to main."; exit 1; }
fi
before="$(git rev-parse --short HEAD)"
# Only a network failure is worth waiting out. Anything the pull refuses on
# grounds of the working tree will refuse again in four seconds, and in
# sixteen, so it is reported at once with what to do about it.
pulled=no
for try in 1 2 3 4; do
  out="$(git pull --ff-only origin main 2>&1)"
  if [ $? -eq 0 ]; then printf '%s\n' "$out"; pulled=yes; break; fi
  printf '%s\n' "$out" | sed 's/^/     /'
  if printf '%s' "$out" | grep -qiE 'could not resolve|connection|timed out|network is unreachable|unable to access|ssl|tls|502|503|504'; then
    warn "That looks like the network (try $try of 4). Waiting $((2 ** try))s."
    sleep $((2 ** try))
    continue
  fi
  bad "The pull stopped, and waiting will not change it."
  echo "     Read the lines above — they name the file and the reason."
  break
done
after="$(git rev-parse --short HEAD)"
if [ "$before" = "$after" ]; then ok "Already up to date at $after"; else ok "$before → $after"; fi
echo "     $(git log -1 --format='%s')"

say "Your signing team, off the tracked file for good"
# The project file no longer carries a team: it reads
# $(TRUELINE_DEVELOPMENT_TEAM), which comes from ios/Signing.local.xcconfig --
# a file git ignores. So a team picked in Xcode survives every pull without
# anything having to hold it, and a fresh clone still builds with no team at
# all. Anything found in the project file gets moved there once, here.
local_cfg="ios/Signing.local.xcconfig"
have=""
[ -f "$local_cfg" ] && have="$(sed -n 's/^[[:space:]]*TRUELINE_DEVELOPMENT_TEAM[[:space:]]*=[[:space:]]*//p' "$local_cfg" | head -1 | tr -d ' \r')"

if [ -n "$have" ]; then
  ok "$have — in $local_cfg, which git ignores. Nothing to do."
  [ -n "$team" ] && [ "$team" != "$have" ] && \
    warn "Xcode had also written $team into the project file. $have is the one being used."
elif [ -n "$team" ]; then
  printf 'TRUELINE_DEVELOPMENT_TEAM = %s\n' "$team" > "$local_cfg"
  ok "moved $team out of the project file and into $local_cfg"
  echo "     git ignores that file, so no pull can ever stop on it again."
else
  warn "No team set yet. Pick yours once in Xcode:"
  echo "     Trueline → Signing & Capabilities → tick Automatically manage"
  echo "     signing → Team. Run this script again afterwards and it will move"
  echo "     it out of the tracked file for you."
fi

if ! git diff --quiet -- "$pbx"; then
  warn "The project file is showing as changed again. Clearing it:"
  git checkout -- "$pbx" && ok "cleared — your team is in $local_cfg"
fi

say "The Xcode project file itself"
if command -v python3 >/dev/null 2>&1; then
  if python3 core/tools/check-pbxproj.py >/dev/null 2>&1; then
    ok "parses, and every reference in it resolves"
  else
    bad "It does not parse. Xcode will refuse to open the project."
    python3 core/tools/check-pbxproj.py 2>&1 | sed 's/^/     /'
    exit 1
  fi
else
  warn "No python3 on this Mac, so the project file cannot be checked here."
fi

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
