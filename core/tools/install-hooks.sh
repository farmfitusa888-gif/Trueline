#!/usr/bin/env bash
# Runs the same checks CI runs, before a push, on your own machine, for nothing.
#
#   bash core/tools/install-hooks.sh
#
# Why bother: a free GitHub account gets 2,000 Actions minutes a month, and the
# expensive way to find out that a typecheck fails is to push, wait, get an
# email, fix it and push again — three runs to land one commit. This suite takes
# a few seconds locally. The minutes are for proving what landed on main.
#
# The hook refuses a push that would fail CI, and says which check failed. To
# push anyway — a work-in-progress branch, say — use `git push --no-verify`.

set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
hooks="$(cd "$root" && git rev-parse --git-path hooks)"
mkdir -p "$hooks"

cat > "$hooks/pre-push" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
cd "$root"

echo "→ tests, typecheck, build (the same three CI runs)"
if ! npm run verify --silent; then
  echo
  echo "✗ This would fail CI. Fixing it here costs nothing; finding out from"
  echo "  Actions costs minutes you only get 2,000 of a month."
  echo "  To push anyway: git push --no-verify"
  exit 1
fi

# The paywall's gate is generated from the TypeScript that defines it.
if ! node --experimental-strip-types core/tools/gen-entitlement.mjs --check; then
  echo
  echo "\u2717 ios/Trueline/Entitlement.swift is out of date. Regenerate it."
  exit 1
fi

# No Swift compiler on this machine, so this is the only thing between a typo
# and a Mac. A grammar, not a compiler -- see the file's own header.
if command -v python3 >/dev/null 2>&1 && ! python3 core/tools/check-swift.py; then
  echo
  echo "\u2717 Some Swift does not parse. See above."
  exit 1
fi

# The Xcode project file is hand-edited here -- there is no Xcode on the machine
# this is written on -- and a pbxproj that does not parse is an app that will not
# open, found out on the Mac rather than here.
if ! python3 core/tools/check-pbxproj.py; then
  echo
  echo "\u2717 ios/Trueline.xcodeproj/project.pbxproj would not open in Xcode."
  exit 1
fi

# The built web app is committed into the iOS project so a Mac with no Node on
# it still produces a working app. CI fails when it goes stale; catching it
# here saves the round trip.
if ! diff -r web/dist ios/Trueline/Web >/dev/null 2>&1; then
  echo
  echo "✗ ios/Trueline/Web is not the current web build, so the phone app would"
  echo "  ship a screen you have already changed."
  echo "  Fix it with: npm run ship-web && git add ios/Trueline/Web"
  exit 1
fi

# ---------------------------------------------------------------- the compiler
#
# This is the important one, and it only exists on a Mac.
#
# There is no Swift compiler on the machine most of this is written on --
# SwiftUI, ARKit, RoomPlan and StoreKit are not on Linux -- so everything above
# READS the Swift and none of it compiles the Swift. Three build errors have
# reached the Mac that way. The last was a `Hashable` conformance that stopped
# being synthesisable three files from where it broke, and no amount of reading
# would have found it before `check-swift-conform.py` was written for it
# afterwards.
#
# On a Mac there IS a compiler, it is free, and it is right here. So on a Mac,
# this compiles.
#
# It only does so when the push contains Swift or the project file: the web
# bundle is committed under ios/Trueline/Web and a React screen cannot break a
# Swift build, so a web-only push should not cost anybody four minutes.
if command -v xcodebuild >/dev/null 2>&1; then
  base="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"
  if [ -n "$base" ]; then
    changed="$(git diff --name-only "$base"...HEAD 2>/dev/null || true)"
  else
    # No upstream yet -- a new branch. Everything in it is new, so compile.
    changed="ios/"
  fi
  native="$(printf '%s\n' "$changed" | grep '^ios/' | grep -v '^ios/Trueline/Web/' || true)"
  if [ -n "$native" ]; then
    echo "→ compiling for the simulator (Swift changed in this push)"
    log="$root/.build-hook/last-build.log"
    mkdir -p "$(dirname "$log")"
    if xcodebuild \
      -project ios/Trueline.xcodeproj \
      -scheme Trueline \
      -configuration Debug \
      -destination 'generic/platform=iOS Simulator' \
      -derivedDataPath "$root/.build-hook" \
      CODE_SIGNING_ALLOWED=NO \
      -quiet \
      build >"$log" 2>&1; then
      echo "  ✓ it compiles"
    else
      echo
      echo "✗ The app does not compile. The errors, in order:"
      grep -E 'error:' "$log" | sed 's/^/    /' | head -20
      echo
      echo "  The whole log: $log"
      echo "  To push anyway: git push --no-verify"
      exit 1
    fi
  fi
fi

echo "✓ everything CI checks, checked"
HOOK

chmod +x "$hooks/pre-push"
echo "Installed $hooks/pre-push"
echo "It runs: npm run verify, and checks the bundle shipped in the iOS app."
if command -v xcodebuild >/dev/null 2>&1; then
  echo "This is a Mac, so it also COMPILES the app whenever a push contains Swift."
  echo "That is the only real Swift compiler this project has, and it is free."
else
  echo "No xcodebuild here, so the Swift is read and not compiled. On a Mac this"
  echo "same hook compiles it."
fi
echo "Skip it once with: git push --no-verify"
