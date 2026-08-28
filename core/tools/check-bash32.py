#!/usr/bin/env python3
"""No shell script here may need a bash newer than the one macOS ships.

    python3 core/tools/check-bash32.py [root]

## The bug this is the answer to

`install-command.sh` was written with this line in it:

    printf '%s\n' "  local root=${root@Q}"

`${var@Q}` is parameter transformation. It arrived in bash 4.4, in 2016, and it
is the tidy way to single-quote a string. On the Linux container this project is
written in, bash is 5.x and it works.

macOS ships **bash 3.2.57**, from 2007, and has done for fifteen years -- Apple
froze it at the last release under GPLv2. On Sam's Mac that line is not a
feature that degrades. It is a syntax error, and a syntax error in bash is found
when the file is *parsed*, not when the line is reached. The whole script dies
before its first output:

    install-command.sh: line 83: ${root@Q}: bad substitution

So the one command whose entire job is to make the build reachable from any
folder would have failed on the only machine it was ever going to run on. It
was caught by reading, before it shipped. The next one will not be.

This is the same shape as `check-portable.py`, and for the same reason: the
container these scripts are written in is not the machine they run on, and
anything only true of the container is a bug waiting for a plane ticket.

## What it checks

Every `.sh` file in the repository, for constructs bash 3.2 does not have:

  * `${v@Q}` and the rest of the `@` transformations   (4.4)
  * `declare -A`, `local -A`, `typeset -A`             (4.0)
  * `${v,,}` and `${v^^}`, case conversion             (4.0)
  * `mapfile` / `readarray`                            (4.0)
  * `&>>`, appending both streams                      (4.0)
  * `|&`, piping both streams                          (4.0)
  * `coproc`                                           (4.0)
  * `;;&` in a case statement                          (4.0)
  * `wait -n`                                          (4.3)
  * `test -v`                                          (4.2)
  * `printf %(fmt)T`                                   (4.2)
  * `${a[-1]}`, a negative index                       (4.3)
  * `shopt -s globstar` and `**/`                      (4.0)

Comments are stripped first, so a script may name one of these in prose to
explain why it does not use it -- which `install-command.sh` does.

## What it does NOT check

It reads text, so a construct assembled at runtime goes past, and it does not
know bash from zsh: a `.zsh` file would be judged by bash's rules, which is
wrong. There are none, and if one arrives this needs a word about it rather
than a silent pass. It also says nothing about the *behaviour* differences
between 3.2 and 5 -- only about syntax and builtins that do not exist at all.
The check that catches the rest is running the script on the Mac.
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2]

GREEN, RED, DIM, OFF = '\033[32m', '\033[31m', '\033[2m', '\033[0m'

# Each: a name, a pattern, the bash that introduced it, and what to write instead.
FORBIDDEN = [
    ('${v@Q} and the other @ transformations', re.compile(r'\$\{[#!]?[A-Za-z_][A-Za-z0-9_]*(\[[^]]*\])?@[QEPAaKkUuLc]\}'), '4.4',
     "quote it by hand: q=\"'$(printf '%s' \"$v\" | sed \"s/'/'\\\\\\\\''/g\")'\""),
    ('an associative array', re.compile(r'\b(declare|local|typeset)\s+(-[A-Za-z]*A[A-Za-z]*)\b'), '4.0',
     'use two indexed arrays, or a case statement'),
    ('${v,,} / ${v^^} case conversion', re.compile(r'\$\{[A-Za-z_][A-Za-z0-9_]*(\[[^]]*\])?(,,|\^\^|,|\^)'), '4.0',
     "pipe through tr: $(printf '%s' \"$v\" | tr '[:upper:]' '[:lower:]')"),
    ('mapfile / readarray', re.compile(r'\b(mapfile|readarray)\b'), '4.0',
     'read in a while loop: while IFS= read -r line; do ... done < file'),
    ('&>> appending both streams', re.compile(r'&>>'), '4.0',
     'write >>file 2>&1'),
    ('|& piping both streams', re.compile(r'\|&'), '4.0',
     'write 2>&1 |'),
    ('coproc', re.compile(r'\bcoproc\b'), '4.0',
     'use a named pipe, or a temporary file'),
    (';;& falling through a case', re.compile(r';;&'), '4.0',
     'repeat the branch, or restructure as if/elif'),
    ('wait -n', re.compile(r'\bwait\s+-n\b'), '4.3',
     'wait for the pids you care about by name'),
    ('test -v', re.compile(r'\[\[?\s+-v\s'), '4.2',
     'write [ -n "${v+set}" ]'),
    ('printf %(fmt)T', re.compile(r'%\([^)]*\)T'), '4.2',
     'call date'),
    ('a negative array index', re.compile(r'\$\{[A-Za-z_][A-Za-z0-9_]*\[\s*-\d'), '4.3',
     'index from the length: ${a[${#a[@]}-1]}'),
    ('globstar', re.compile(r'shopt\s+(-[a-z]*\s+)*globstar'), '4.0',
     'use find'),
]


def withoutComments(text: str) -> str:
    """Blank out `#` comments, leaving line and column numbers intact.

    A `#` only starts a comment where a word could start -- at the beginning of
    a line, or after whitespace, `;`, `|`, `&`, `(` or a backtick. Inside a
    word it is a literal, which is why `${v#prefix}` and `$#` survive this.
    Quotes are tracked so a `#` inside a string stays put.
    """
    out = []
    for line in text.split('\n'):
        single = double = escaped = False
        cut = None
        for i, ch in enumerate(line):
            if escaped:
                escaped = False
                continue
            if ch == '\\' and not single:
                # Outside single quotes a backslash escapes whatever follows,
                # so `\#` is a literal hash and not the start of a comment.
                escaped = True
                continue
            if ch == "'" and not double:
                single = not single
            elif ch == '"' and not single:
                double = not double
            elif ch == '#' and not single and not double:
                before = line[i - 1] if i else ''
                if before == '' or before in ' \t;|&(`':
                    cut = i
                    break
        out.append(line if cut is None else line[:cut] + ' ' * (len(line) - cut))
    return '\n'.join(out)


def tracked(root: Path) -> list[Path]:
    # `--others --exclude-standard` matters more than it looks. The script that
    # prompted this checker was untracked when the checker was first run against
    # it, so a plain `git ls-files` scanned six files and not the seventh -- the
    # one with the bug in it. A checker that cannot see a file cannot fail on
    # it, and a shell script is runnable the moment it is written, not the
    # moment it is committed. Ignored files stay out: node_modules is full of
    # other people's shell.
    done = subprocess.run(
        ['git', 'ls-files', '--cached', '--others', '--exclude-standard', '*.sh'],
        cwd=root, capture_output=True, text=True)
    if done.returncode != 0:
        return sorted(root.rglob('*.sh'))
    return [root / line for line in done.stdout.split('\n') if line.strip()]


def main() -> int:
    files = tracked(ROOT)
    if not files:
        print(f'{RED}✗{OFF} no shell scripts found under {ROOT}, which cannot be right')
        return 1

    found = []
    for path in files:
        try:
            body = path.read_text(encoding='utf-8')
        except (OSError, UnicodeDecodeError):
            continue
        stripped = withoutComments(body)
        for name, pattern, since, instead in FORBIDDEN:
            for hit in pattern.finditer(stripped):
                line = stripped.count('\n', 0, hit.start()) + 1
                found.append((path.relative_to(ROOT), line, name, since, instead,
                              body.split('\n')[line - 1].strip()))

    if found:
        print(f'{RED}✗{OFF} {len(found)} thing(s) that bash 3.2 cannot parse, and macOS ships 3.2:')
        for rel, line, name, since, instead, source in found:
            print(f'\n  {rel}:{line}  {name}  (bash {since})')
            print(f'    {DIM}{source}{OFF}')
            print(f'    instead: {instead}')
        print(f'\n  A syntax error in bash is found when the file is PARSED, so one of')
        print(f'  these kills the whole script before its first line of output.')
        return 1

    print(f'{GREEN}✓{OFF} {len(files)} shell script(s) stay inside bash 3.2, which is what macOS ships')
    return 0


if __name__ == '__main__':
    sys.exit(main())
