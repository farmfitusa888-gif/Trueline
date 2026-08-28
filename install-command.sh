#!/usr/bin/env bash
# Puts one word on your Mac: `trueline`. It works from any folder, so a command
# can never again fail because you were in the wrong one.
#
# Run it once. The first half pulls, because this file arrives in a commit and
# a file cannot be run before it has been fetched:
#
#   cd ~/trueline && bash setup-mac.sh --checks-only && bash install-command.sh
#
# After the first time, `bash <wherever-the-repo-is>/install-command.sh` on its
# own is enough -- it is only the very first run that needs the pull in front
# of it.
#
# After that, from any folder at all:
#
#   trueline          build it and put it on the phone
#   trueline sim      run it in the simulator, no cable and no phone
#   trueline open     open the project in Xcode
#   trueline site     build the website and show you the folder to drag
#   trueline check    run every test and check, without building
#   trueline here     move this Terminal into the repo
#
# ## The bug this is the answer to
#
# `npm run catch-up && bash build.sh`, run from the home folder:
#
#   npm error enoent Could not read package.json:
#   ENOENT: no such file or directory, open '/Users/…/package.json'
#
# Nothing was broken. npm looks for package.json in the folder you are standing
# in, and the repo was one folder away. Every command in this project began with
# `cd ~/trueline &&` for exactly that reason -- which makes the `cd` the load-
# bearing part of the command, and the part most easily lost when a line is
# copied. A command that only works from one folder will keep doing this.
#
# So the folder stops being something you have to get right. The function this
# writes carries the path to the repo inside it, and every command it runs, it
# runs from there.

set -uo pipefail

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; }

# Where this script is, is where the repo is -- however it was called, and
# whatever folder the Terminal happened to be in when it was called.
cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1
root="$(pwd)"

build=yes
for arg in "$@"; do
  case "$arg" in
    --no-build) build=no ;;
    *)
      bad "I do not know the option $arg. The only one is --no-build."
      exit 2 ;;
  esac
done

say "The repo"
if [ ! -d "$root/ios/Trueline.xcodeproj" ]; then
  bad "There is no ios/Trueline.xcodeproj next to this script, so this is not"
  echo "     the Trueline repo. Find it with:"
  echo "       find ~ -maxdepth 5 -type d -name trueline 2>/dev/null"
  exit 1
fi
ok "$root"

command_file="$HOME/.trueline.zsh"

# Single-quote the path the portable way. ${root@Q} would be shorter and it is
# what this said first -- but that is bash 4.4, and the bash macOS ships is
# 3.2, where it is a syntax error. Nothing here may need a bash newer than the
# one already on the Mac.
quoted_root="'$(printf '%s' "$root" | sed "s/'/'\\\\''/g")'"

say "Writing the command"
# The repo path is baked in at install time rather than searched for at run
# time: a search can find the wrong copy, and being wrong quietly is worse than
# being broken loudly. If the repo ever moves, run this script again from its
# new home and the path is rewritten.
{
  printf '%s\n' "# Written by install-command.sh in the Trueline repo. Re-run that"
  printf '%s\n' "# script to update this file; editing it by hand will be overwritten."
  printf '%s\n' "trueline() {"
  printf '%s\n' "  local root=$quoted_root"
  printf '%s\n' "  if [ ! -d \"\$root\" ]; then"
  printf '%s\n' "    printf 'The Trueline repo is not at %s any more.\\n' \"\$root\" >&2"
  printf '%s\n' "    printf 'Find it, then run: bash <where-it-is>/install-command.sh\\n' >&2"
  printf '%s\n' "    return 1"
  printf '%s\n' "  fi"
  printf '%s\n' "  case \"\${1-}\" in"
  printf '%s\n' "    ''|phone|build) bash \"\$root/build.sh\" ;;"
  printf '%s\n' "    sim)            bash \"\$root/build.sh\" --sim ;;"
  printf '%s\n' "    open|xcode)     bash \"\$root/setup-mac.sh\" ;;"
  printf '%s\n' "    check|verify)   ( cd \"\$root\" && npm run verify ) ;;"
  printf '%s\n' "    site)           ( cd \"\$root\" && npm run site ) && open -R \"\$root/site/dist\" ;;"
  printf '%s\n' "    here|cd)        cd \"\$root\" ;;"
  printf '%s\n' "    help|-h|--help) trueline--say-what-it-does ;;"
  printf '%s\n' "    *)"
  printf '%s\n' "      printf 'trueline: I do not know \"%s\".\\n\\n' \"\$1\" >&2"
  printf '%s\n' "      trueline--say-what-it-does >&2"
  printf '%s\n' "      return 2 ;;"
  printf '%s\n' "  esac"
  printf '%s\n' "}"
  printf '%s\n' ""
  printf '%s\n' "trueline--say-what-it-does() {"
  printf '%s\n' "  printf 'trueline          build it and put it on the phone\\n'"
  printf '%s\n' "  printf 'trueline sim      run it in the simulator, no cable and no phone\\n'"
  printf '%s\n' "  printf 'trueline open     open the project in Xcode\\n'"
  printf '%s\n' "  printf 'trueline site     build the website and show you the folder to drag\\n'"
  printf '%s\n' "  printf 'trueline check    run every test and check, without building\\n'"
  printf '%s\n' "  printf 'trueline here     move this Terminal into the repo\\n'"
  printf '%s\n' "}"
} > "$command_file"
ok "$command_file"

say "Wiring it into your shell"
# One guarded block, rewritten in place. Running this script twice must leave
# one copy, not two -- a second `source` line is harmless but it is the kind of
# mess that makes a file nobody wants to open.
rc="$HOME/.zshrc"
top='# >>> trueline >>>'
end='# <<< trueline <<<'
touch "$rc"
if grep -qF "$top" "$rc" 2>/dev/null; then
  # Cut the old block out, keep everything else exactly as it was.
  awk -v top="$top" -v end="$end" '
    $0 == top { skip = 1 }
    skip != 1 { print }
    $0 == end { skip = 0 }
  ' "$rc" > "$rc.trueline-tmp" && mv "$rc.trueline-tmp" "$rc"
  ok "the old block taken out of ~/.zshrc"
fi
{
  printf '%s\n' "$top"
  printf '%s\n' '[ -f "$HOME/.trueline.zsh" ] && source "$HOME/.trueline.zsh"'
  printf '%s\n' "$end"
} >> "$rc"
ok "~/.zshrc sources it"

say "Use it"
echo "  In THIS window, once:"
echo ""
echo "      source ~/.trueline.zsh"
echo ""
echo "  Every new Terminal window has it already. Then, from any folder:"
echo ""
echo "      trueline"
echo ""

if [ "$build" = no ]; then
  say "Not building"
  warn "--no-build was given, so the command is installed and nothing was built."
  exit 0
fi

say "Building now, since that is what you were trying to do"
exec bash "$root/build.sh"
