#!/usr/bin/env python3
"""Compares two Xcode project files by what they MEAN, not by their text.

    python3 core/tools/pbxproj-diff.py old.pbxproj new.pbxproj

## Why a text diff is the wrong tool here

Opening the project in Xcode rewrites it. Not the contents -- the *order*:
`PBXBuildFile` entries come back sorted, so `git diff` shows a hundred lines
removed and the same hundred added, identical apart from where they sit.

setup-mac.sh looked at those lines, saw changes that were not signing keys,
and refused to pull -- correctly, by its own rule, and wrongly in fact. It
could not tell a reorder from an edit because a line prefix cannot.

This can. It parses both versions with the same reader `check-pbxproj.py`
uses and compares the *sets*: which files are built, which are referenced,
what every build setting is. Order is discarded on the way in, so a
reordering produces no output at all, and adding a file or changing a setting
produces exactly one line naming it.

## What it prints

Nothing, and exits 0, when the two mean the same thing. Otherwise one line
per real difference, each beginning with a tag a script can grep:

    SETTING  DEVELOPMENT_TEAM  "$(TRUELINE_...)" -> K5LM7NP9QR
    FILE+    Something.swift
    FILE-    Gone.swift

That first tag is what lets setup-mac.sh say "this is only signing" without
reading the diff itself.
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
_checker = __import__('importlib').import_module('importlib.util')
import importlib.util

_spec = importlib.util.spec_from_file_location(
    'pbx', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'check-pbxproj.py')
)
_pbx = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_pbx)


def read(path: str) -> dict:
    text = _pbx.strip_comments(open(path, encoding='utf-8').read())
    # The file is `// !$*UTF8*$!` then one dictionary.
    start = text.index('{')
    return _pbx.Parser(text[start:]).dict()


def objects(project: dict) -> dict:
    return project.get('objects', {})


def names(project: dict) -> dict[str, str]:
    """Every object id to something a person can read."""
    out = {}
    for oid, obj in objects(project).items():
        if not isinstance(obj, dict):
            continue
        label = obj.get('path') or obj.get('name') or obj.get('isa', '?')
        out[oid] = label
    return out


def built(project: dict) -> set[str]:
    """The file each PBXBuildFile builds, by name -- ids are not comparable.

    Xcode reassigns object ids freely, so comparing them would report every
    reorder as a total rewrite. What matters is which FILES are built.
    """
    label = names(project)
    out = set()
    for obj in objects(project).values():
        if isinstance(obj, dict) and obj.get('isa') == 'PBXBuildFile':
            ref = obj.get('fileRef')
            if ref:
                out.add(label.get(ref, ref))
    return out


def referenced(project: dict) -> set[str]:
    out = set()
    for obj in objects(project).values():
        if isinstance(obj, dict) and obj.get('isa') == 'PBXFileReference':
            out.add(obj.get('path') or obj.get('name') or '?')
    return out


def settings(project: dict) -> dict[str, str]:
    """Every build setting, by configuration name and key.

    Flattened to `Debug.DEVELOPMENT_TEAM` so a change reads as one line
    rather than as a nested structure somebody has to diff by eye.
    """
    out = {}
    for obj in objects(project).values():
        if not isinstance(obj, dict) or obj.get('isa') != 'XCBuildConfiguration':
            continue
        where = obj.get('name', '?')
        for key, value in (obj.get('buildSettings') or {}).items():
            if isinstance(value, list):
                value = ' '.join(str(v) for v in value)
            out[f'{where}.{key}'] = str(value)
    return out


def attributes(project: dict) -> dict[str, str]:
    """TargetAttributes, where Xcode also writes the team and the style."""
    out = {}
    for obj in objects(project).values():
        if not isinstance(obj, dict) or obj.get('isa') != 'PBXProject':
            continue
        for target, attrs in (obj.get('attributes', {}).get('TargetAttributes') or {}).items():
            if isinstance(attrs, dict):
                for key, value in attrs.items():
                    out[f'TargetAttributes.{key}'] = str(value)
    return out


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__.strip().split('\n')[2].strip())
        return 2
    before, after = read(argv[0]), read(argv[1])

    lines = []
    for gone in sorted(built(before) - built(after)):
        lines.append(f'FILE-    {gone}')
    for came in sorted(built(after) - built(before)):
        lines.append(f'FILE+    {came}')
    for gone in sorted(referenced(before) - referenced(after)):
        lines.append(f'REF-     {gone}')
    for came in sorted(referenced(after) - referenced(before)):
        lines.append(f'REF+     {came}')

    was, now = {**settings(before), **attributes(before)}, {**settings(after), **attributes(after)}
    for key in sorted(set(was) | set(now)):
        a, b = was.get(key), now.get(key)
        if a != b:
            bare = key.split('.', 1)[1]
            lines.append(f'SETTING  {bare}  {a!r} -> {b!r}')

    for line in lines:
        print(line)
    return 0 if not lines else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
