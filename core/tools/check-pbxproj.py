#!/usr/bin/env python3
"""Parses ios/Trueline.xcodeproj/project.pbxproj and checks it hangs together.

Xcode is not on this machine, so "it looks right" is not a check. This reads
the OpenStep property list the project actually is, and fails on the two things
that would stop Xcode opening it: a structure that does not parse, and an object
id referenced from somewhere but never defined.

It is not a claim that Xcode accepts the file. It is a claim that the file is a
well-formed plist whose every reference resolves -- which is what hand-editing
puts at risk, and what a diff cannot show you.
"""
import re, sys, os

PBX = os.path.join(os.path.dirname(__file__), '..', '..',
                   'ios', 'Trueline.xcodeproj', 'project.pbxproj')


def strip_comments(text):
    out, i, n = [], 0, len(text)
    while i < n:
        if text.startswith('/*', i):
            j = text.index('*/', i + 2)
            i = j + 2
        elif text[i] == '"':
            j = i + 1
            while text[j] != '"' or text[j - 1] == '\\':
                j += 1
            out.append(text[i:j + 1])
            i = j + 1
        else:
            out.append(text[i])
            i += 1
    return ''.join(out)


class Parser:
    def __init__(self, text):
        self.t, self.i = text, 0

    def ws(self):
        while self.i < len(self.t) and self.t[self.i].isspace():
            self.i += 1

    def value(self):
        self.ws()
        c = self.t[self.i]
        if c == '{':
            return self.dict()
        if c == '(':
            return self.array()
        if c == '"':
            j = self.i + 1
            while self.t[j] != '"' or self.t[j - 1] == '\\':
                j += 1
            v = self.t[self.i + 1:j]
            self.i = j + 1
            return v
        j = self.i
        while self.t[j] not in ';,)}= \t\n':
            j += 1
        v = self.t[self.i:j]
        self.i = j
        return v

    def dict(self):
        assert self.t[self.i] == '{'
        self.i += 1
        d = {}
        while True:
            self.ws()
            if self.t[self.i] == '}':
                self.i += 1
                return d
            k = self.value()
            self.ws()
            assert self.t[self.i] == '=', f'expected = after {k!r} at {self.i}'
            self.i += 1
            d[k] = self.value()
            self.ws()
            assert self.t[self.i] == ';', f'expected ; after {k!r} at {self.i}'
            self.i += 1

    def array(self):
        assert self.t[self.i] == '('
        self.i += 1
        a = []
        while True:
            self.ws()
            if self.t[self.i] == ')':
                self.i += 1
                return a
            a.append(self.value())
            self.ws()
            if self.t[self.i] == ',':
                self.i += 1


def main():
    raw = open(PBX).read()
    body = strip_comments(raw)
    body = body[body.index('{'):]
    root = Parser(body).value()

    objects = root['objects']
    ids = set(objects)
    print(f'parsed: {len(objects)} objects')

    ID = re.compile(r'^[0-9A-F]{24}$')
    dangling = []

    def walk(v, where):
        if isinstance(v, dict):
            for k, sub in v.items():
                walk(sub, f'{where}.{k}')
        elif isinstance(v, list):
            for n, sub in enumerate(v):
                walk(sub, f'{where}[{n}]')
        elif isinstance(v, str) and ID.match(v) and v not in ids:
            dangling.append((where, v))

    walk(root['rootObject'], 'rootObject')
    for oid, obj in objects.items():
        walk(obj, f'{oid} ({obj.get("isa", "?")})')

    if root['rootObject'] not in ids:
        dangling.append(('rootObject', root['rootObject']))

    if dangling:
        for where, v in dangling:
            print(f'  DANGLING {v} referenced from {where}')
        sys.exit(1)
    print('every object id referenced resolves to a defined object')

    # The signing setup this file now depends on.
    xcconfigs = {i for i, o in objects.items()
                 if o.get('isa') == 'PBXFileReference'
                 and o.get('path', '').endswith('.xcconfig')}
    if not xcconfigs:
        print('  no xcconfig file reference')
        sys.exit(1)

    grouped = {c for i, o in objects.items() if o.get('isa') == 'PBXGroup'
               for c in o.get('children', [])}
    for x in xcconfigs:
        if x not in grouped:
            print(f'  xcconfig {x} is not in any group — Xcode would not show it')
            sys.exit(1)

    based = [(i, o) for i, o in objects.items()
             if o.get('isa') == 'XCBuildConfiguration'
             and o.get('baseConfigurationReference')]
    if len(based) != 2:
        print(f'  expected 2 configurations on the xcconfig, found {len(based)}')
        sys.exit(1)
    for i, o in based:
        if o['baseConfigurationReference'] not in xcconfigs:
            print(f'  {i} points its base configuration at a non-xcconfig')
            sys.exit(1)
        team = o['buildSettings'].get('DEVELOPMENT_TEAM')
        if team != '$(TRUELINE_DEVELOPMENT_TEAM)':
            print(f'  {i} ({o.get("name")}) has DEVELOPMENT_TEAM = {team!r}')
            sys.exit(1)
        print(f'  {o.get("name")}: base configuration set, '
              f'DEVELOPMENT_TEAM = $(TRUELINE_DEVELOPMENT_TEAM)')

    print('OK')


if __name__ == '__main__':
    try:
        main()
    except (AssertionError, ValueError, KeyError, IndexError) as e:
        print(f'project.pbxproj does not parse: {e}')
        print('Xcode would refuse to open it. Undo with:')
        print('  git checkout -- ios/Trueline.xcodeproj/project.pbxproj')
        sys.exit(1)
