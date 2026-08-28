#!/usr/bin/env bash
# A click-through of every screen, in the simulator, that leaves evidence.
#
#   cd ~/trueline && bash clickthrough.sh
#
# `build.sh --sim` already gets the app running. What this adds is the part that
# was always the weak half: remembering what you saw.
#
# Four screens in two days turned out to have a control that existed and could
# not be found -- the paywall the app could never present, the mark button that
# was refusing 280px above your thumb, the photograph control hidden inside a
# row that gave no sign it opened, and the tapped wall with 73% of it rubbed
# out. Every one of those looked fine to whoever wrote it and wrong to somebody
# holding a phone. A click-through is how the second kind of person finds them,
# and it is worth nothing if what they saw is gone by the time they describe it.
#
# So this walks you through the app one screen at a time, and takes the
# screenshot for you at each stop, named after the step. At the end you have a
# folder to send back. Nobody has to remember anything.
#
# It does NOT tap for you. Driving a real UI needs a UI-test target, and adding
# one means hand-editing `project.pbxproj`, which is the file `check-pbxproj.py`
# exists to protect. Your thumb is also the point: the bugs above are all about
# what a person can see and reach.
#
# What the simulator cannot do, and why some steps say so: it has no LiDAR
# camera, so RoomPlan will not scan; no real photographs; and StoreKit runs in a
# local sandbox rather than against the App Store.

set -uo pipefail

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; }

cd "$(dirname "${BASH_SOURCE[0]}")"

simulator="${TRUELINE_SIM:-iPhone 17 Pro Max}"
out="clickthrough-$(date +%Y%m%d-%H%M)"

udid="$(xcrun simctl list devices booted 2>/dev/null \
  | grep -Eo '[0-9A-F-]{36}' | head -1)"

if [ -z "$udid" ]; then
  bad "No simulator is running."
  echo "     Start the app first, then come back:"
  echo
  echo "       bash build.sh --sim"
  echo
  exit 1
fi

mkdir -p "$out"
ok "Simulator $udid"
ok "Screenshots will go in  $out/"

shot() {
  local n="$1" name="$2"
  local file
  file="$out/$(printf '%02d' "$n")-$name.png"
  if xcrun simctl io "$udid" screenshot "$file" >/dev/null 2>&1; then
    ok "kept $file"
  else
    warn "could not take that screenshot -- carry on, it is not fatal"
  fi
}

step() {
  local n="$1" name="$2" what="$3" look="$4"
  say "$n. $what"
  printf '   Look for: %s\n' "$look"
  printf '\n   \033[2mDo it in the simulator, then press Return here.\033[0m '
  read -r _
  shot "$n" "$name"
}

say "A click-through of Trueline"
echo "  Press Return at each step once the screen is showing. Screenshots are"
echo "  automatic. Ctrl-C to stop -- what you have so far is already saved."

step 1 rooms "Rooms tab. Look at the list." \
  "Does each room show ITS OWN NAME, not \"Room 2026-...\"? That is the bug that cost you a scan."

step 2 room-open "Open a room. Stay on Plan." \
  "The drawing, its dimensions, and the line underneath saying whether anything has had a tape on it."

step 3 wall-white "Tap a wall on the blueprint." \
  "The WHOLE wall goes white, end to end, including across its doors and windows. Everything else steps back."

step 4 wall-panel "Scroll to the panel under the drawing." \
  "The wall's length, its openings, and \"What is being done to\" it."

step 5 ceiling "Tap the empty middle of the plan." \
  "The ceiling opens like a wall does, with its area and a way to close it."

step 6 mark "Open a wall, then + a spot. Press Mark it with the description EMPTY." \
  "It refuses NEXT TO the button you pressed, and the cursor jumps into the empty box."

step 7 mark-listed "Now type a description and mark it." \
  "The mark is listed, and the closed row says \"No photograph yet - open it to take one\"."

step 8 mark-photo "Tap that row to open it." \
  "\"Photograph it\" is there. On a simulator there is no camera, so it opens a file picker -- that is expected."

step 9 takeoff "Takeoff tab." \
  "Quantities, and where each one came from."

step 10 price "Price tab." \
  "Every line, and a total. Anything with no rate set is LEFT OUT rather than priced at nothing."

step 11 agree "Agreement tab." \
  "Writing a proposal, where it gets signed, and the signature pad."

step 12 work "Work tab." \
  "Changes to what was signed, invoices, and money in."

step 13 claim "Claim tab. Make the claim document." \
  "It opens with a REAL DRAWING in it, not a black square."

step 14 files "Files tab." \
  "Everything the room can be sent as."

step 15 tour "Back to Rooms, then Take the tour." \
  "How much of the screen the card covers, and whether you can see what it is pointing at."

step 16 business "Business tab." \
  "Your details, your rates, and the stores you buy from."

step 17 paywall "Business or Rooms -- find the subscription row." \
  "It opens. Until launch it says everything is free; it must never be a dead end."

step 18 scan-start "Scan tab." \
  "The camera view. In a simulator there is no LiDAR, so it should SAY so rather than sit black."

say "Done"
echo "  $(ls "$out" | wc -l | tr -d ' ') screenshots in  $out/"
echo
echo "  Zip it and send it back:"
echo
echo "    zip -r $out.zip $out"
echo
