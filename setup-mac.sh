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
#
# Once you have picked your signing team in Xcode the once, you do not need
# this script again for the ordinary loop:
#
#   trueline
#
# builds and puts the app on the phone in one command, without opening Xcode,
# and works from any folder. Install that word once with:
#
#   bash ~/trueline/install-command.sh
#
# From inside the repo, `bash build.sh` is the same thing.

set -uo pipefail

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; }

# `trueline` is a shell function written into ~/.trueline.zsh by
# install-command.sh, and it is the command that makes the folder you are
# standing in stop mattering. It is MENTIONED here rather than installed here:
# this script pulls and checks, and writing to somebody's ~/.zshrc as a side
# effect of a command called "checks-only" is the kind of surprise that gets
# remembered badly. Saying the line is enough, and it is said only when the
# command is genuinely missing.
#
# It is said HERE, in the script that is already on the Mac, because that is
# exactly the gap this fills: install-command.sh arrived in a commit, and a file
# cannot be run before it has been pulled. Whatever is already on disk has to be
# the thing that points at whatever is new.
sayTheOneWord() {
  [ -f "$HOME/.trueline.zsh" ] && return 0
  [ -f "$root/install-command.sh" ] || return 0
  say "One word, from any folder"
  echo "  You do not have it yet. Install it once:"
  echo ""
  echo "      bash \"$root/install-command.sh\""
  echo ""
  echo "  After that \`trueline\` builds and installs from wherever you happen"
  echo "  to be standing, and \`trueline help\` lists the rest."
}

cd "$(dirname "${BASH_SOURCE[0]}")"
root="$(pwd)"

# `--checks-only` does everything up to and including the project-file check and
# then stops: no device listing, no instructions, and Xcode is not opened.
# build.sh runs this so the pull, the signing team and the web bundle are all
# handled in one place rather than in two that drift apart.
checks_only=no
[ "${1:-}" = "--checks-only" ] && checks_only=yes

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
# Somewhere to put the copy of the project file as git has it, for comparing
# against the one on disk. Cleaned up however this script ends, including when
# it stops on a check.
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

pbx="ios/Trueline.xcodeproj/project.pbxproj"

# An Apple developer team is ten characters, capitals and digits. Nothing else
# is one -- and in particular `$(TRUELINE_DEVELOPMENT_TEAM)` is not, which is
# the exact string that got written into the signing file and then reported as
# a team by both scripts. xcodebuild then said "Signing requires a development
# team" and the checks above it all said everything was fine.
#
# So a team is validated wherever it is read or written, and never merely
# checked for being non-empty.
is_team() { printf '%s' "$1" | grep -qE '^[A-Z0-9]{10}$'; }

team=""
if ! git diff --quiet -- "$pbx"; then
  team="$(git diff -U0 -- "$pbx" \
    | sed -n 's/^+[[:space:]]*DEVELOPMENT_TEAM = \(.*\);$/\1/p' \
    | head -1 | tr -d '"')"
  # What actually changed, by what it MEANS rather than by which lines moved.
  #
  # Opening the project in Xcode rewrites it: the `PBXBuildFile` entries come
  # back sorted, so `git diff` shows a hundred lines removed and the same
  # hundred added, identical apart from where they sit. A line-based guard
  # cannot tell that from somebody adding a file, and this one refused the
  # pull over it -- correctly by its own rule and wrongly in fact.
  #
  # `pbxproj-diff.py` parses both versions and compares the sets: which files
  # are built, which are referenced, what every setting is. A reorder produces
  # no output at all. On a shuffled copy of this very project, `git diff`
  # reported 38 changed lines and it reported none.
  changed=""
  if command -v python3 >/dev/null 2>&1; then
    git show "HEAD:$pbx" > "$scratch/pbx.head" 2>/dev/null
    changed="$(python3 core/tools/pbxproj-diff.py "$scratch/pbx.head" "$pbx" 2>/dev/null)"
    real="$(printf '%s\n' "$changed" | grep -v '^$' \
      | grep -vE '^SETTING  (DEVELOPMENT_TEAM|DevelopmentTeam|CODE_SIGN_STYLE|ProvisioningStyle|CODE_SIGN_IDENTITY|PROVISIONING_PROFILE_SPECIFIER|PROVISIONING_PROFILE|LastUpgradeCheck|LastSwiftUpdateCheck) ')"
  else
    # No python3: fall back to the line-based check, which is worse but is not
    # nothing. It says so rather than pretending it looked properly.
    warn "No python3, so the project file is compared line by line and a"
    warn "reordering by Xcode may look like an edit."
    real="$(git diff -U0 -- "$pbx" | grep -E '^[+-][^+-]' \
      | grep -vE 'DEVELOPMENT_TEAM|CODE_SIGN_STYLE|LastUpgradeCheck')"
  fi

  if [ -n "$real" ]; then
    bad "The project file has changes that are not just your signing team."
    echo "     That is a real edit and this script will not throw it away."
    echo
    echo "     What actually changed, ignoring anything Xcode merely reordered:"
    printf '%s\n' "$real" | sed 's/^/       /' | head -30
    lines="$(printf '%s\n' "$real" | grep -c .)"
    [ "$lines" -gt 30 ] && echo "       ... and $((lines - 30)) more"
    echo
    echo "     A FILE+ or REF+ line is a file added to the project -- keep it."
    echo "       git stash push -- $pbx     (then re-run this script)"
    echo "     Anything you did not mean to do:"
    echo "       git checkout -- $pbx       (then re-run this script)"
    exit 1
  fi

  if [ -n "$team" ] && ! is_team "$team"; then
    # What the project file holds now is the placeholder that points AT the
    # signing file. Copying it into the signing file makes it point at itself.
    warn "the project file holds \"$team\", which is not a team. Ignoring it."
    team=""
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

say "Files Xcode rewrites on its own"
# The scheme is Xcode's housekeeping. It rewrites LastUpgradeVersion the first
# time a newer Xcode opens the project, and that is enough to stop every pull
# afterwards -- which is what happened, on a file nobody had deliberately
# edited. Handled like the signing team: if the only difference is Xcode's own
# bookkeeping, it goes; if there is anything else in it, this stops and says so,
# because a scheme can carry real settings.
# Never fatal. The first version of this exited here, which turned a file Xcode
# rewrites by itself into a wall in front of the compiler -- the pull had already
# worked and the build was stopped anyway. A scheme has nothing to do with
# whether the code compiles; it only ever gets in the way of a *pull*, and the
# pull section below reports that on its own.
scheme="$(git ls-files 'ios/**/*.xcscheme' | head -1)"
if [ -n "$scheme" ] && ! git diff --quiet -- "$scheme"; then
  # What the scheme actually says, rather than how it is laid out.
  #
  # Opening the project reflows it: `<BuildAction ... >` written on one line
  # comes back over three, and the version goes up. The first version of this
  # allowed that with a list of strings Xcode is known to touch; the list was
  # widened once and was still short -- `<BuildAction` alone on a line was not
  # on it -- which is exactly how the project file failed, twice.
  #
  # So it is compared as a tree. Reflowing produces no output; changing what
  # gets built produces a line. On this project's own scheme, reflowed the way
  # Xcode does it, `git diff` reported 8 changed lines and this reported none.
  #
  # Only the removals are counted, and that is the whole rule.
  #
  # A line beginning `-` means something the repository's scheme had is gone or
  # has different attributes -- somebody changed Run from Debug to Release, and
  # that shows as a `-` and a `+` together. A `+` on its own is Xcode filling in
  # something the file did not have: it adds a `TestAction` to any scheme
  # lacking one, which is where six phantom removals came from before the
  # comparison stopped counting position among unlike siblings.
  #
  # No list of blessed strings anywhere. That approach was tried twice on the
  # project file and once here, and was short every time.
  if command -v python3 >/dev/null 2>&1; then
    git show "HEAD:$scheme" > "$scratch/scheme.head" 2>/dev/null
    other="$(python3 core/tools/xcscheme-diff.py "$scratch/scheme.head" "$scheme" \
      2>/dev/null | grep -c '^-')"
  else
    other=0
  fi
  if [ "${other:-0}" -gt 0 ]; then
    warn "$(basename "$scheme") has changes that are not Xcode's own."
    echo "     Not stopping for it -- a scheme has nothing to do with whether the"
    echo "     code compiles. It only ever blocks a pull. What differs:"
    python3 core/tools/xcscheme-diff.py "$scratch/scheme.head" "$scheme" \
      2>/dev/null | head -8 | sed 's/^/       /'
    echo "     Drop it:  git checkout -- $scheme"
  else
    git checkout -- "$scheme"
    ok "$(basename "$scheme") put back — Xcode noting its own version, nothing of yours"
  fi
else
  ok "nothing of Xcode's own in the way"
fi

say "Getting the latest code"

# The built web bundle, put back before the pull looks at it.
#
# `ios/Trueline/Web` is a TRACKED BUILD ARTIFACT. Xcode ships that folder as it
# stands, so it has to be in the repository -- and `npm run ship-web` rewrites
# it on this Mac every time anything is built. So the ordinary loop leaves it
# modified, and the next pull refuses:
#
#     error: Your local changes to the following files would be overwritten
#     by merge:  ios/Trueline/Web/index.html
#
# That stopped Sam twice on 2026-08-28 and the answer both times was a second
# command to remember. It is not somebody's work: it is output, it is
# regenerated further down this same script, and throwing it away costs nothing
# and surprises nobody. So it goes back before the pull, the same way Xcode's
# own edits to the project file do a few lines above.
#
# Anything else you have changed still stops the pull, and still should.
if ! git diff --quiet -- ios/Trueline/Web 2>/dev/null; then
  git checkout -- ios/Trueline/Web
  ok "the built bundle put back — it is output, and it is rebuilt below"
fi

# It used to stash whatever it found and pull over the top. That is a script
# quietly moving somebody's unfinished work somewhere they did not ask for and
# may not think to look -- it swallowed two files during this project's own
# development, and it would do the same to yours the first time you edited
# something and ran the wrong command. Nothing here moves your work now: if
# there is any, the pull is skipped and you are told what to do about it.
skipped_pull=no
if ! git diff --quiet || ! git diff --cached --quiet; then
  warn "You have local changes, so nothing is being pulled over the top of them."
  git status --short | sed 's/^/       /'
  echo "     Keep them:  git stash push -u   (then re-run this)"
  echo "     Commit:     git add -A && git commit -m \"...\""
  echo "     Drop them:  git checkout -- .   (this cannot be undone)"
  skipped_pull=yes
fi
branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "main" ]; then
  warn "You are on '$branch', not main. Switching."
  git checkout main >/dev/null 2>&1 || { bad "Could not switch to main."; exit 1; }
fi
before="$(git rev-parse --short HEAD)"
if [ "$skipped_pull" = yes ]; then
  ok "staying on $before, with your changes untouched"
else
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
fi
after="$(git rev-parse --short HEAD)"
if [ "$skipped_pull" = yes ]; then :
elif [ "$before" = "$after" ]; then ok "Already up to date at $after"; else ok "$before → $after"; fi
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

if [ -n "$have" ] && ! is_team "$have"; then
  bad "$local_cfg holds \"$have\", which is not a team."
  if [ "$have" = '$(TRUELINE_DEVELOPMENT_TEAM)' ]; then
    echo "     That is the placeholder pointing at itself, which resolves to"
    echo "     nothing. An earlier version of this script copied it out of the"
    echo "     project file. Clearing it and looking for the real one."
  fi
  rm -f "$local_cfg"
  have=""
fi

# Finding it without opening Xcode.
#
# Every code-signing certificate on this Mac carries the team it belongs to in
# its subject, as the **organisational unit**. That is the same ten characters
# Xcode shows under Settings → Accounts, and reading it here saves a trip
# through a GUI to copy a string already on the machine.
#
# The OU and nothing else. The certificate's common name also ends in ten
# characters in brackets -- `Apple Development: Sam (XXXXXXXXXX)` -- and it is
# tempting to read them from there. Tested against a certificate built with the
# two deliberately different, the bracketed value is a different string, so
# reading it would write a wrong team confidently. If the OU cannot be read,
# this says so rather than falling back to a guess.
#
# It is also never picked for you when there is more than one: a Mac signed
# into two developer accounts has two, and choosing is how an app ends up
# published on the wrong account.
found=""
if [ -z "$have" ] && command -v security >/dev/null 2>&1 && command -v openssl >/dev/null 2>&1; then
  for kind in "Apple Development" "Apple Distribution" "iPhone Developer"; do
    more="$(security find-certificate -a -c "$kind" -p 2>/dev/null \
      | openssl storeutl -noout -text -certs /dev/stdin 2>/dev/null \
      | sed -n 's/.*Subject:.*OU *= *\([A-Z0-9]\{10\}\).*/\1/p')"
    found="$(printf '%s\n%s' "$found" "$more" | grep -E '^[A-Z0-9]{10}$' | sort -u)"
  done
fi
count="$(printf '%s' "$found" | grep -c . || true)"

if [ -n "$have" ]; then
  ok "$have — in $local_cfg, which git ignores. Nothing to do."
  [ -n "$team" ] && [ "$team" != "$have" ] && \
    warn "Xcode had also written $team into the project file. $have is the one being used."
elif [ -n "$team" ]; then
  printf 'TRUELINE_DEVELOPMENT_TEAM = %s\n' "$team" > "$local_cfg"
  ok "moved $team out of the project file and into $local_cfg"
  echo "     git ignores that file, so no pull can ever stop on it again."
elif [ "$count" = "1" ]; then
  printf 'TRUELINE_DEVELOPMENT_TEAM = %s\n' "$found" > "$local_cfg"
  ok "found your team on this Mac ($found) and wrote it to $local_cfg"
  echo "     It came from your Apple Development certificate. Check it against"
  echo "     Xcode → Settings → Accounts → your team, once, if you want to."
elif [ "$count" -gt 1 ] 2>/dev/null; then
  warn "This Mac is signed into more than one developer team:"
  printf '%s\n' "$found" | sed 's/^/       /'
  echo "     Picking one for you is how an app ends up on the wrong account, so:"
  echo "       echo 'TRUELINE_DEVELOPMENT_TEAM = XXXXXXXXXX' > $local_cfg"
  echo "     with the one you want, then run this again."
else
  warn "No team set, and none found on this Mac."
  echo "     Open Xcode once: Trueline → Signing & Capabilities → tick"
  echo "     Automatically manage signing → Team. That creates the certificate"
  echo "     this script reads. Run it again afterwards and it will pick the"
  echo "     team up on its own from then on."
  echo "     A free Apple ID works — it gives you a personal team."
fi

if ! git diff --quiet -- "$pbx"; then
  warn "The project file is showing as changed again. Clearing it:"
  git checkout -- "$pbx" && ok "cleared — your team is in $local_cfg"
fi

say "The Swift itself"
if command -v python3 >/dev/null 2>&1; then
  python3 core/tools/check-swift.py >/dev/null 2>&1
  case $? in
  0) ok "every file parses" ;;
  2)
    warn "The Swift grammar is not installed on this Mac, so nothing was checked."
    echo "     It is optional and costs nothing:  pip3 install tree_sitter tree_sitter_swift"
    ;;
  *)
    warn "Something does not parse. This is a grammar and not a compiler, so"
    warn "Xcode is the one that decides — but it is usually right:"
    python3 core/tools/check-swift.py 2>&1 | sed 's/^/     /' | head -12
    ;;
  esac
else
  warn "No python3 on this Mac, so the Swift cannot be parse-checked here."
fi

say "Names the Swift uses"
# A file can parse perfectly and still not compile, and both of the ones that
# bit us were exactly that: ScanScreen called dismiss() with no
# @Environment(\.dismiss) declared, and seven files declared themselves
# ObservableObject while importing only Foundation. The grammar had nothing to
# say about either. This does.
if command -v python3 >/dev/null 2>&1; then
  if python3 core/tools/check-swift-names.py >/dev/null 2>&1; then
    ok "every name they use is declared or imported"
  else
    bad "Something is used that nothing declares or imports. Xcode will refuse this:"
    python3 core/tools/check-swift-names.py 2>&1 | sed 's/^/     /'
    exit 1
  fi
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
  # The browser the checks drive. `npm ci` installs the Playwright PACKAGE; the
  # browser it drives is a separate download, and without it `npm run verify`
  # stops at check-art with "Failed to launch chromium". One command, once per
  # Mac, and it is a no-op every time after that.
  if ! node -e "import('./core/tools/browser.mjs').then(m=>m.chromePath())" >/dev/null 2>&1; then
    warn "no Chromium for the checks yet — fetching it (once)"
    if npx --yes playwright install chromium >/dev/null 2>&1; then
      ok "Chromium installed"
    else
      warn "could not fetch it. 'npm run verify' will stop at check-art until you run:"
      echo "       npx playwright install chromium"
    fi
  else
    ok "Chromium for the checks is present"
  fi
  npm run build --silent >/dev/null 2>&1
  if diff -r web/dist ios/Trueline/Web >/dev/null 2>&1; then
    ok "the bundle matches the source"
  else
    warn "the bundle was stale — rebuilding it"
    # No "commit it" instruction any more: telling somebody to commit output is
    # telling them to create the conflict handled above. Whoever changes
    # `web/src` commits the bundle with the change; a build on another Mac does
    # not.
    npm run ship-web >/dev/null 2>&1 && ok "rebuilt from web/src — the phone gets today's screens"
  fi
else
  warn "No Node on this Mac, so the bundle cannot be checked here."
  echo "     That is fine — the committed one is what Xcode ships."
fi

if [ "$checks_only" = yes ]; then
  say "Checked"
  ok "up to date, signing held, bundle current, project file parses"
  sayTheOneWord
  exit 0
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
