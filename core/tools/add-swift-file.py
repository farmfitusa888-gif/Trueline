#!/usr/bin/env python3
"""Adds a Swift file in ios/Trueline to the Xcode target.

    python3 core/tools/add-swift-file.py MeasureScene.swift

A Swift file that is on disk but not in the project compiles for nobody: Xcode
never sees it, the symbols in it are missing, and the error names the call site
rather than the file that is absent. There is no Xcode on the machine this is
written on to drag it in, so it is done here -- three entries that have to agree
with each other, which is exactly the kind of edit worth not doing by hand.

Ids are derived from the file name, so running it twice is refused rather than
producing a project with the same file in it twice.
"""
import hashlib
import os
import sys

PBX = os.path.join(os.path.dirname(__file__), '..', '..',
                   'ios', 'Trueline.xcodeproj', 'project.pbxproj')


def add(name):
    s = open(PBX).read()
    if f'/* {name} */' in s:
        print(f'{name} is already in the project')
        return 1

    on_disk = os.path.join(os.path.dirname(PBX), '..', 'Trueline', name)
    if not os.path.exists(on_disk):
        print(f'ios/Trueline/{name} is not on disk')
        return 1

    def uid(salt):
        h = hashlib.sha1(f'{name}:{salt}'.encode()).hexdigest().upper()[:24]
        if h in s:
            raise SystemExit(f'id collision for {name}:{salt}')
        return h

    ref, build = uid('fileRef'), uid('buildFile')

    s = s.replace(
        '/* Begin PBXBuildFile section */\n',
        '/* Begin PBXBuildFile section */\n'
        f'\t\t{build} /* {name} in Sources */ = {{isa = PBXBuildFile; '
        f'fileRef = {ref} /* {name} */; }};\n', 1)

    s = s.replace(
        '/* Begin PBXFileReference section */\n',
        '/* Begin PBXFileReference section */\n'
        f'\t\t{ref} /* {name} */ = {{isa = PBXFileReference; '
        f'lastKnownFileType = sourcecode.swift; path = {name}; '
        'sourceTree = "<group>"; };\n', 1)

    # Into the group the other sources are in, before Info.plist -- which is
    # where Xcode itself puts a new source file.
    anchor = '\t\t\t\tE4E6D7EFB44C842A7A9609C6 /* Info.plist */,\n'
    if anchor not in s:
        print('the Trueline group does not look like it did')
        return 1
    s = s.replace(anchor, f'\t\t\t\t{ref} /* {name} */,\n' + anchor, 1)

    marker = '\t\t\t\t220223ADBC47100E168B1B71 /* TruelineApp.swift in Sources */,\n'
    if marker not in s:
        print('the Sources build phase does not look like it did')
        return 1
    s = s.replace(marker, marker + f'\t\t\t\t{build} /* {name} in Sources */,\n', 1)

    open(PBX, 'w').write(s)
    print(f'added {name}  (fileRef {ref}, buildFile {build})')
    return 0


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(add(sys.argv[1]))
