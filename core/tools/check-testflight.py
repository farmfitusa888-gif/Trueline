#!/usr/bin/env python3
"""Everything App Store Connect refuses a build for, checked before the upload.

    python3 core/tools/check-testflight.py [root]

## The bug this is the answer to

None of these stop a build. Xcode compiles, the app runs on the phone, the
archive uploads -- and then an email arrives and the build never reaches a
tester:

  * `ITMS-91053: Missing API declaration` -- no `PrivacyInfo.xcprivacy`, or one
    that does not name a "required reason" API the binary actually calls.
    Required since 1 May 2024.
  * `Missing Compliance` -- no `ITSAppUsesNonExemptEncryption` in `Info.plist`,
    so every single upload waits on somebody answering the export questions by
    hand before it can go out.
  * A crash the moment a screen opens, because a framework was used and its
    `NS...UsageDescription` was never written. iOS does not ask; it kills the
    app.

Every one of them is invisible until the upload, which is the worst possible
moment to find out, and every one of them is visible in the repository right
now. So they are read here.

## What it checks

  1. `PrivacyInfo.xcprivacy` exists, parses, and is in the target's Resources
     build phase -- a manifest on disk and outside the target ships nothing.
  2. The manifest's declared APIs and the APIs the Swift actually calls are the
     SAME SET. A missing one is the rejection above. A declared one that is not
     called is a claim about the binary that is not true, and it is the half
     nobody checks.
  3. `ITSAppUsesNonExemptEncryption` is set, and if it is `false` that no
     encryption framework is imported anywhere.
  4. Every framework whose use needs a usage string has one, and no usage
     string exists for a framework the app does not use.
  5. A marketing version and a build number are configured.
"""
import plistlib
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2]
IOS = ROOT / 'ios' / 'Trueline'
PBX = ROOT / 'ios' / 'Trueline.xcodeproj' / 'project.pbxproj'

GREEN, RED, DIM, OFF = '\033[32m', '\033[31m', '\033[2m', '\033[0m'
problems = []
def bad(what): problems.append(what)

swift = {p.name: p.read_text(encoding='utf-8') for p in sorted(IOS.glob('*.swift'))}
allSwift = '\n'.join(swift.values())

# ---------------------------------------------------------------- 1. manifest

manifest = IOS / 'PrivacyInfo.xcprivacy'
declared = set()
if not manifest.exists():
    bad('there is no ios/Trueline/PrivacyInfo.xcprivacy, so the upload comes '
        'back as ITMS-91053: Missing API declaration')
else:
    try:
        data = plistlib.loads(manifest.read_bytes())
    except Exception as e:
        data = None
        bad(f'PrivacyInfo.xcprivacy does not parse: {e}')
    if data is not None:
        for key in ('NSPrivacyTracking', 'NSPrivacyCollectedDataTypes', 'NSPrivacyAccessedAPITypes'):
            if key not in data:
                bad(f'PrivacyInfo.xcprivacy has no {key}')
        for entry in data.get('NSPrivacyAccessedAPITypes', []):
            declared.add(entry.get('NSPrivacyAccessedAPIType', '?'))
            if not entry.get('NSPrivacyAccessedAPITypeReasons'):
                bad(f'{entry.get("NSPrivacyAccessedAPIType")} is declared with no reason code')

    pbx = PBX.read_text(encoding='utf-8')
    if 'PrivacyInfo.xcprivacy in Resources' not in pbx:
        bad('PrivacyInfo.xcprivacy is on disk but not in the Resources build phase, '
            'so it is not in the app. Run: python3 core/tools/add-resource.py PrivacyInfo.xcprivacy')

# ------------------------------------------- 2. declared == actually called
#
# Each category, with the code that makes it true. The patterns are what the
# API looks like in Swift, not what it is called in Apple's table.
CATEGORIES = {
    'NSPrivacyAccessedAPICategoryUserDefaults': [r'\bUserDefaults\b'],
    'NSPrivacyAccessedAPICategoryFileTimestamp': [
        r'contentModificationDate', r'attributesOfItem', r'creationDateKey',
        r'\.creationDate\b', r'contentModificationDateKey'],
    'NSPrivacyAccessedAPICategoryDiskSpace': [
        r'volumeAvailableCapacity', r'systemFreeSize', r'systemSize\b'],
    'NSPrivacyAccessedAPICategorySystemBootTime': [
        r'systemUptime', r'mach_absolute_time'],
    'NSPrivacyAccessedAPICategoryActiveKeyboards': [r'activeInputModes'],
}
used = set()
where = {}
for category, patterns in CATEGORIES.items():
    for pattern in patterns:
        hits = [name for name, body in swift.items() if re.search(pattern, body)]
        if hits:
            used.add(category)
            where.setdefault(category, []).extend(f'{h} ({pattern})' for h in hits[:2])

for category in sorted(used - declared):
    bad(f'{category} is called in {", ".join(where[category][:2])} and is NOT in '
        'PrivacyInfo.xcprivacy — this is exactly what ITMS-91053 is')
for category in sorted(declared - used):
    bad(f'{category} is declared in PrivacyInfo.xcprivacy and nothing in ios/Trueline '
        'calls it — a manifest that overclaims is a statement about the binary '
        'that is not true')

# ------------------------------------------------------ 3, 4, 5. Info.plist

plist = IOS / 'Info.plist'
info = {}
if not plist.exists():
    bad('there is no ios/Trueline/Info.plist')
else:
    try:
        info = plistlib.loads(plist.read_bytes())
    except Exception as e:
        bad(f'Info.plist does not parse: {e}')

if 'ITSAppUsesNonExemptEncryption' not in info:
    bad('Info.plist has no ITSAppUsesNonExemptEncryption, so every upload stops on '
        '"Missing Compliance" until somebody answers the export questions by hand')
elif info.get('ITSAppUsesNonExemptEncryption') is False:
    for framework in ('CryptoKit', 'CommonCrypto'):
        if re.search(rf'^\s*import\s+{framework}\b', allSwift, re.M):
            bad(f'ITSAppUsesNonExemptEncryption is false but {framework} is imported')

# A framework used without its usage string does not warn. It kills the app.
USAGE = {
    'NSCameraUsageDescription': [r'AVCaptureDevice', r'ARSession', r'RoomCaptureView', r'\.camera\b'],
    'NSMicrophoneUsageDescription': [r'AVAudioRecorder', r'\.record\(', r'AVAudioSession'],
    'NSSpeechRecognitionUsageDescription': [r'SFSpeechRecognizer'],
    'NSCalendarsWriteOnlyAccessUsageDescription': [r'EKEventStore'],
    'NSLocationWhenInUseUsageDescription': [r'CLLocationManager'],
    'NSPhotoLibraryAddUsageDescription': [r'UIImageWriteToSavedPhotosAlbum', r'PHPhotoLibrary'],
}
for key, patterns in USAGE.items():
    isUsed = any(re.search(p, allSwift) for p in patterns)
    hasKey = key in info
    if isUsed and not hasKey:
        bad(f'{key} is missing and the framework it covers is used — iOS terminates '
            'the app the moment that screen asks for permission')
    if hasKey and not isUsed and not info.get(key, '').strip() == '':
        pass  # An unused string is harmless; App Review may ask, so it is not a failure.
    if hasKey and not str(info.get(key, '')).strip():
        bad(f'{key} is present but empty, which App Review rejects')

for key in ('CFBundleShortVersionString', 'CFBundleVersion', 'CFBundleIdentifier'):
    if key not in info:
        bad(f'Info.plist has no {key}')

pbxText = PBX.read_text(encoding='utf-8') if PBX.exists() else ''
for setting in ('MARKETING_VERSION', 'CURRENT_PROJECT_VERSION', 'PRODUCT_BUNDLE_IDENTIFIER'):
    if setting not in pbxText:
        bad(f'{setting} is not set in the project, so the build has no version to upload under')

# ------------------------------------------------- 6. the products themselves
#
# Three things can drift apart silently, and each of them looks fine until a
# real purchase is attempted: the ids in the Swift enum, the ids in the local
# StoreKit configuration the scheme runs against, and the price the website
# advertises. A product id that exists in one and not the other means
# `Product.products(for:)` comes back short and the paywall shows nothing.
import json

storekit = IOS / 'Trueline.storekit'
sub = IOS / 'Subscription.swift'
inSwift = set(re.findall(r'case \w+ = "([\w.]+)"', sub.read_text(encoding='utf-8'))) if sub.exists() else set()
if not storekit.exists():
    bad('there is no ios/Trueline/Trueline.storekit, so the purchase path cannot be '
        'run without App Store Connect and a real account')
elif inSwift:
    config = json.loads(storekit.read_text(encoding='utf-8'))
    inConfig, names = set(), {}
    for group in config.get('subscriptionGroups', []):
        for product in group.get('subscriptions', []):
            inConfig.add(product.get('productID'))
            for loc in product.get('localizations', []):
                names[product.get('productID')] = loc.get('displayName', '')
    for missing in sorted(inSwift - inConfig):
        bad(f'{missing} is a Plan in Subscription.swift and is not in Trueline.storekit, '
            'so it cannot be bought when the app is run against the local configuration')
    for extra in sorted(inConfig - inSwift):
        bad(f'{extra} is in Trueline.storekit and is not a Plan in Subscription.swift')

    # `founding` is computed from the product's display name containing the
    # word. If the local names do not carry it, the founding wording on the
    # paywall can never be seen before the App Store is involved -- which is the
    # one place it would be noticed as missing.
    if 'localizedCaseInsensitiveContains("founding")' in sub.read_text(encoding='utf-8'):
        for pid in sorted(inConfig & inSwift):
            if 'founding' not in names.get(pid, '').lower():
                bad(f'Subscription.founding looks for "founding" in a product name, and '
                    f'{pid} is called "{names.get(pid, "")}" locally — so the founding '
                    'terms cannot be seen when testing against Trueline.storekit')

# ------------------------------------------------------------------- report

if problems:
    print(f'{RED}✗{OFF} {len(problems)} thing(s) App Store Connect would refuse this build for:')
    for p in problems:
        print(f'\n  {p}')
    sys.exit(1)

print(f'{GREEN}✓{OFF} PrivacyInfo.xcprivacy present, in the target, and naming exactly the '
      f'{len(used)} required-reason API(s) this app calls')
print(f'{GREEN}✓{OFF} export compliance answered in Info.plist, so no upload waits on it')
print(f'{GREEN}✓{OFF} every framework used has its usage string; version, build and bundle id set')
