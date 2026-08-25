#!/usr/bin/env python3
"""Checks that every button the handbook quotes is a button the app actually has.

A guide that tells somebody to tap a button which is not there is worse than no
guide: they conclude the app is broken and stop. So every string the handbook
puts in <b> -- which is how it marks "this is what the screen says" -- is looked
for in the app's own source before the guide is published.

It is a text search on purpose. Anything cleverer would need to compile Swift,
and no Swift compiler is reachable from here.

    python3 docs/build/check-guide.py docs/handbook.html

Exit 0 when every quoted label is found, 1 when any is not.
"""
import html
import os
import re
import sys

# Words the guide bolds for emphasis rather than to quote a control. Each one
# is here because it is prose, not a label, and every addition needs that
# justification -- the list is the only way a wrong quote can hide.
NOT_LABELS = {
    'Black', 'Amber', 'Violet', 'Grey', 'Red',      # the plan's colour key
    'measured', 'scanned', 'not', 'never', 'no',    # emphasis in a sentence
    'Agree to',                                     # prefix; the rest is the option's own name
}

CODE = ('.tsx', '.ts', '.swift')
SKIP = ('/.git', '/node_modules', '/.build', '/dist', '/docs')


def app_text(root: str) -> str:
    """Every line of app source, as one string, with typography flattened."""
    parts = []
    for here, _dirs, files in os.walk(root):
        if any(s in here.replace(os.sep, '/') for s in SKIP):
            continue
        for name in files:
            if name.endswith(CODE):
                try:
                    parts.append(open(os.path.join(here, name), encoding='utf-8').read())
                except OSError:
                    pass
    return flatten(''.join(parts))


def flatten(text: str) -> str:
    """Curly quotes and em dashes differ between the guide and the source."""
    return (text.replace('’', "'").replace('‘', "'")
                .replace('“', '"').replace('”', '"')
                .replace('—', '--').replace('–', '-'))


def quoted(guide: str) -> list[str]:
    start = guide.index('const GUIDE')
    # Only the data. Past the closing `];` is the renderer, whose own <b> tags
    # are markup rather than anything the app says.
    body = guide[start:guide.index('\n];', start)]
    found = []
    for match in re.finditer(r'<b>(.*?)</b>', body, re.S):
        label = html.unescape(match.group(1)).strip()
        if label and label not in NOT_LABELS:
            found.append(label)
    return sorted(set(found))


def main() -> int:
    guide_path = sys.argv[1] if len(sys.argv) > 1 else 'docs/handbook.html'
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(guide_path))))
    root = root if os.path.isdir(os.path.join(root, 'web')) else '.'

    guide = open(guide_path, encoding='utf-8').read()
    source = app_text(root)

    labels = quoted(guide)
    missing = [l for l in labels if flatten(l) not in source]

    print(f'{len(labels)} quoted labels checked against the app source')
    if not missing:
        print('  every one of them exists')
        return 0
    for label in missing:
        print(f'  NOT IN THE APP: {label!r}')
    print('\nEither the guide quotes a button that does not exist, or the button was')
    print('renamed and the guide was not. Fix whichever is wrong.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
