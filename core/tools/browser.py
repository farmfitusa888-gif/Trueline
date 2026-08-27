#!/usr/bin/env python3
"""Finding the browser, on whatever machine this is — the Python side.

Same job and same order as `core/tools/browser.mjs`, for the document builders
under `docs/build/`, which drive Chromium through Playwright's Python bindings.

Two files rather than one because the two languages cannot import each other,
and a build step that shelled out to Node to ask where a browser is would be a
third thing to go wrong. The rules are short enough to state twice:

  1. `TRUELINE_CHROME` wins outright, including when it is wrong.
  2. Whatever Playwright says, if it is on the disk.
  3. Any unpacked build under any browsers root, highest build number first.
  4. Otherwise, say what to type. Never guess.
"""
import os
import re
from pathlib import Path

INSIDE = (
    'chrome-linux/chrome',
    'chrome-linux64/chrome',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
    'chrome-win/chrome.exe',
)


def roots() -> list[Path]:
    """Where Playwright keeps browsers, unless it was told otherwise."""
    told = os.environ.get('PLAYWRIGHT_BROWSERS_PATH')
    if told:
        return [Path(told)]
    home = Path.home()
    import sys
    if sys.platform == 'darwin':
        return [home / 'Library' / 'Caches' / 'ms-playwright']
    if sys.platform == 'win32':
        local = os.environ.get('LOCALAPPDATA') or str(home / 'AppData' / 'Local')
        return [Path(local) / 'ms-playwright']
    return [home / '.cache' / 'ms-playwright']


def _fromPlaywright() -> Path | None:
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as play:
            return Path(play.chromium.executable_path)
    except Exception:
        # No bindings, or none installed. One candidate coming back empty.
        return None


def chromePath() -> str:
    """The browser to drive. Raises with the command to run when there is none."""
    asked = os.environ.get('TRUELINE_CHROME')
    if asked:
        if Path(asked).exists():
            return asked
        raise RuntimeError(f'TRUELINE_CHROME is set to {asked} and there is nothing there.')

    said = _fromPlaywright()
    if said and said.exists():
        return str(said)

    builds: list[tuple[int, Path]] = []
    for root in roots():
        if not root.is_dir():
            continue
        for entry in root.iterdir():
            number = re.fullmatch(r'chromium-(\d+)', entry.name)
            if number:
                builds.append((int(number.group(1)), entry))
    for _, build in sorted(builds, reverse=True):
        for inside in INSIDE:
            if (build / inside).exists():
                return str(build / inside)

    for root in roots():
        plain = root / 'chromium'
        if plain.is_file():
            return str(plain)
        for inside in INSIDE:
            if (plain / inside).exists():
                return str(plain / inside)

    raise RuntimeError(
        'No Chromium on this machine. Install the one this repo drives with:\n'
        '\n    npx playwright install chromium\n\n'
        'Or point TRUELINE_CHROME at a Chromium you already have.'
    )
