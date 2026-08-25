#!/usr/bin/env python3
"""Compares two Xcode schemes by what they mean, not by how they are laid out.

    python3 core/tools/xcscheme-diff.py old.xcscheme new.xcscheme

## Why, again

Opening the project reflows the scheme: `<BuildAction ... >` written on one
line comes back spread over three, and `version` and `LastUpgradeVersion` go
up. `git diff` shows a dozen changed lines and none of them mean anything.

setup-mac.sh tried to allow that with a list of strings Xcode is known to
touch. The list was widened once and was still short -- `<BuildAction` on a
line of its own was not on it -- which is the same shape of failure the
project file had, and the same answer applies: compare the tree, not the
text.

## What counts as a difference

Element names, nesting, and attributes -- with the whitespace and the ordering
of attributes thrown away, because neither changes what gets built. Two
attributes are ignored by name: `version` and `LastUpgradeVersion` are Xcode
writing down which Xcode it is.

Everything else is reported, including `buildForRunning` and its neighbours.
Those look like formatting and are not: they decide whether a target builds
for a given action, and a scheme that quietly stopped building for Run would
be a very confusing afternoon.
"""
import sys
import xml.etree.ElementTree as ET

# Xcode noting its own version. Nothing downstream reads either.
ITS_OWN = {'version', 'LastUpgradeVersion'}


def shape(element: ET.Element, path: str = '') -> list[str]:
    """One line per element, naming where it sits and what it says.

    Sorted attributes, so a reordering by the writer is invisible. Children in
    document order, because the order of scheme actions is meaningful.
    """
    here = f'{path}/{element.tag}'
    attrs = sorted(
        (k, (v or '').strip()) for k, v in element.attrib.items() if k not in ITS_OWN
    )
    lines = [f'{here} ' + ' '.join(f'{k}={v}' for k, v in attrs)]
    for index, child in enumerate(element):
        lines.extend(shape(child, f'{here}[{index}]'))
    return lines


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print('usage: xcscheme-diff.py old.xcscheme new.xcscheme')
        return 2
    try:
        before = shape(ET.parse(argv[0]).getroot())
        after = shape(ET.parse(argv[1]).getroot())
    except ET.ParseError as bad:
        print(f'That scheme is not readable XML: {bad}')
        return 2

    lines = []
    for gone in before:
        if gone not in after:
            lines.append(f'-  {gone}')
    for came in after:
        if came not in before:
            lines.append(f'+  {came}')

    for line in lines:
        print(line)
    return 0 if not lines else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
