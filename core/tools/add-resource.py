#!/usr/bin/env python3
"""Puts a non-source file into the app target's Resources build phase.

    python3 core/tools/add-resource.py PrivacyInfo.xcprivacy

`add-swift-file.py` is the same idea for code: a file that is on disk but not
in `project.pbxproj` is a file Xcode does not build, and Swift says so loudly --
"cannot find X in scope". A RESOURCE that is missing from the project says
nothing at all. The build succeeds, the app runs, and the only sign is an email
from App Store Connect after the upload:

    ITMS-91053: Missing API declaration

which is what a PrivacyInfo.xcprivacy sitting on disk and outside the target
looks like. So it is added by a tool rather than by hand, and check-pbxproj.py
reads the result.
"""
import hashlib
import os
import sys

PBX = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..',
                   'ios', 'Trueline.xcodeproj', 'project.pbxproj')

# Xcode's own name for each kind of file it can carry as a resource.
KINDS = {
    '.xcprivacy': 'text.plist.xml',
    '.plist': 'text.plist.xml',
    '.json': 'text.json',
    '.strings': 'text.plist.strings',
}


def add(name):
    s = open(PBX).read()
    if f'/* {name} */' in s:
        print(f'{name} is already in the project')
        return 1

    on_disk = os.path.join(os.path.dirname(PBX), '..', 'Trueline', name)
    if not os.path.exists(on_disk):
        print(f'ios/Trueline/{name} is not on disk')
        return 1

    kind = KINDS.get(os.path.splitext(name)[1])
    if kind is None:
        print(f'I do not know what Xcode calls a {os.path.splitext(name)[1]} file.')
        print(f'Add it to KINDS in {os.path.basename(__file__)} rather than guessing.')
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
        f'\t\t{build} /* {name} in Resources */ = {{isa = PBXBuildFile; '
        f'fileRef = {ref} /* {name} */; }};\n', 1)

    s = s.replace(
        '/* Begin PBXFileReference section */\n',
        '/* Begin PBXFileReference section */\n'
        f'\t\t{ref} /* {name} */ = {{isa = PBXFileReference; '
        f'lastKnownFileType = {kind}; path = {name}; '
        'sourceTree = "<group>"; };\n', 1)

    anchor = '\t\t\t\tE4E6D7EFB44C842A7A9609C6 /* Info.plist */,\n'
    if anchor not in s:
        print('the Trueline group does not look like it did')
        return 1
    s = s.replace(anchor, f'\t\t\t\t{ref} /* {name} */,\n' + anchor, 1)

    marker = '\t\t\t\tB1202C7A8238826DC782F5A0 /* Assets.xcassets in Resources */,\n'
    if marker not in s:
        print('the Resources build phase does not look like it did')
        return 1
    s = s.replace(marker, marker + f'\t\t\t\t{build} /* {name} in Resources */,\n', 1)

    open(PBX, 'w').write(s)
    print(f'added {name} to Resources  (fileRef {ref}, buildFile {build})')
    return 0


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(add(sys.argv[1]))
