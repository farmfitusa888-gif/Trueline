# The four diagrams, as inline SVG. Vector so they stay crisp at print, and
# drawn with line weight and dash as well as colour so they survive a
# black-and-white site photocopy.

DEFS = '''<defs>
  <marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
    <path d="M0,0 L10,5 L0,10 z" fill="#14181B"/></marker>
  <marker id="arA" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
    <path d="M0,0 L10,5 L0,10 z" fill="#B8590A"/></marker>
  <marker id="tick" viewBox="0 0 2 10" refX="1" refY="5" markerWidth="2" markerHeight="10" orient="auto">
    <path d="M1,0 L1,10" stroke="#14181B" stroke-width="1.4"/></marker>
  <pattern id="hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
    <line x1="0" y1="0" x2="0" y2="6" stroke="#9AA4AA" stroke-width="2"/></pattern>
</defs>'''

# ---------------------------------------------------------------- 1. distance
STAND = f'''<svg viewBox="0 0 620 172" xmlns="http://www.w3.org/2000/svg" role="img"
  aria-label="Plan view of standing distance from a wall">{DEFS}
  <text x="0" y="11" font-size="11" font-weight="bold" fill="#14181B">PLAN VIEW &#8212; LOOKING DOWN</text>

  <!-- the wall -->
  <rect x="0" y="22" width="620" height="11" fill="#14181B"/>
  <text x="626" y="31" font-size="11" fill="#14181B" text-anchor="end" transform="translate(-6,0)"></text>
  <text x="4" y="45" font-size="10.5" fill="#4A5459">THE WALL</text>

  <!-- bands -->
  <rect x="0" y="55" width="118" height="52" fill="url(#hatch)" opacity="0.55"/>
  <rect x="118" y="55" width="112" height="52" fill="#B8590A" opacity="0.20"/>
  <rect x="118" y="55" width="112" height="52" fill="none" stroke="#B8590A" stroke-width="2.2"/>
  <rect x="230" y="55" width="272" height="52" fill="#E8EDEF"/>
  <rect x="502" y="55" width="118" height="52" fill="url(#hatch)" opacity="0.55"/>

  <text x="59"  y="86" font-size="11" text-anchor="middle" fill="#14181B" font-weight="bold">TOO CLOSE</text>
  <text x="174" y="80" font-size="14" text-anchor="middle" fill="#B8590A" font-weight="bold">STAND HERE</text>
  <text x="174" y="96" font-size="12" text-anchor="middle" fill="#B8590A" font-weight="bold">4&#8211;6 ft</text>
  <text x="366" y="86" font-size="11" text-anchor="middle" fill="#4A5459">works, but drifts</text>
  <text x="561" y="80" font-size="11" text-anchor="middle" fill="#14181B" font-weight="bold">OUT OF</text>
  <text x="561" y="94" font-size="11" text-anchor="middle" fill="#14181B" font-weight="bold">RANGE</text>

  <!-- the phone, in the right band -->
  <rect x="166" y="112" width="16" height="26" rx="2.5" fill="#fff" stroke="#B8590A" stroke-width="2.2"/>
  <circle cx="174" cy="118" r="2.2" fill="#B8590A"/>

  <!-- dimension line -->
  <line x1="0" y1="152" x2="620" y2="152" stroke="#14181B" stroke-width="1"/>
  <g stroke="#14181B" stroke-width="1.4">
    <line x1="0" y1="146" x2="0" y2="158"/><line x1="118" y1="146" x2="118" y2="158"/>
    <line x1="230" y1="146" x2="230" y2="158"/><line x1="502" y1="146" x2="502" y2="158"/>
    <line x1="619" y1="146" x2="619" y2="158"/>
  </g>
  <text x="118" y="169" font-size="10" text-anchor="middle" fill="#4A5459">3 ft</text>
  <text x="230" y="169" font-size="10" text-anchor="middle" fill="#4A5459">6 ft</text>
  <text x="502" y="169" font-size="10" text-anchor="middle" fill="#4A5459">15 ft</text>
  <text x="618" y="169" font-size="10" text-anchor="end" fill="#4A5459">16 ft</text>
</svg>'''

# ------------------------------------------------------------------- 2. hold
HOLD = f'''<svg viewBox="0 0 620 208" xmlns="http://www.w3.org/2000/svg" role="img"
  aria-label="Side view of how to aim the phone">{DEFS}
  <text x="0" y="11" font-size="11" font-weight="bold" fill="#14181B">SIDE VIEW</text>

  <!-- floor and wall -->
  <line x1="0" y1="176" x2="620" y2="176" stroke="#14181B" stroke-width="3.5"/>
  <line x1="470" y1="176" x2="470" y2="26" stroke="#14181B" stroke-width="3.5"/>
  <text x="12" y="192" font-size="10.5" fill="#4A5459">FLOOR</text>
  <text x="484" y="40" font-size="10.5" fill="#4A5459">WALL</text>

  <!-- the joint that matters -->
  <circle cx="470" cy="176" r="11" fill="none" stroke="#B8590A" stroke-width="2.5"/>
  <text x="618" y="200" font-size="11" font-weight="bold" fill="#B8590A" text-anchor="end">THE JOINT &#8212; AIM AT THIS</text>

  <!-- person -->
  <circle cx="96" cy="66" r="13" fill="none" stroke="#14181B" stroke-width="2.5"/>
  <line x1="96" y1="79" x2="96" y2="132" stroke="#14181B" stroke-width="2.5"/>
  <line x1="96" y1="132" x2="82" y2="176" stroke="#14181B" stroke-width="2.5"/>
  <line x1="96" y1="132" x2="112" y2="176" stroke="#14181B" stroke-width="2.5"/>
  <line x1="96" y1="97" x2="128" y2="104" stroke="#14181B" stroke-width="2.5"/>
  <rect x="128" y="94" width="14" height="22" rx="2.5" fill="#fff" stroke="#B8590A" stroke-width="2.5"/>
  <text x="60" y="104" font-size="10.5" fill="#4A5459" text-anchor="end">CHEST</text>
  <text x="60" y="116" font-size="10.5" fill="#4A5459" text-anchor="end">HEIGHT</text>

  <!-- right: tilted down at the joint -->
  <path d="M143,106 L466,172" stroke="#B8590A" stroke-width="2.6" marker-end="url(#arA)"/>
  <path d="M143,116 L462,176" stroke="#B8590A" stroke-width="1" opacity="0.45"/>
  <path d="M143,98 L466,160" stroke="#B8590A" stroke-width="1" opacity="0.45"/>
  <text x="176" y="166" font-size="11.5" font-weight="bold" fill="#B8590A">RIGHT &#8212; tilted down at the joint</text>

  <!-- wrong: level at blank wall -->
  <path d="M143,102 L464,102" stroke="#6B757B" stroke-width="2" stroke-dasharray="7 5" marker-end="url(#ar)"/>
  <text x="250" y="94" font-size="11.5" fill="#6B757B">WRONG &#8212; level, sees blank drywall</text>
</svg>'''

# ------------------------------------------------------------------- 3. walk
WALK = f'''<svg viewBox="0 0 620 196" xmlns="http://www.w3.org/2000/svg" role="img"
  aria-label="Plan view of the walking path around a room">{DEFS}
  <text x="0" y="11" font-size="11" font-weight="bold" fill="#14181B">PLAN VIEW &#8212; THE WALK</text>

  <rect x="60" y="26" width="500" height="148" fill="#F4F6F7" stroke="#14181B" stroke-width="4"/>

  <!-- path inside the perimeter -->
  <path d="M112,74 L508,74" stroke="#B8590A" stroke-width="2.8" marker-end="url(#arA)" fill="none"/>
  <path d="M508,74 L508,126" stroke="#B8590A" stroke-width="2.8" marker-end="url(#arA)" fill="none"/>
  <path d="M508,126 L112,126" stroke="#B8590A" stroke-width="2.8" marker-end="url(#arA)" fill="none"/>
  <path d="M112,126 L112,80" stroke="#B8590A" stroke-width="2.8" marker-end="url(#arA)" fill="none"/>

  <!-- pause dots at the corners -->
  <g fill="#fff" stroke="#B8590A" stroke-width="2.4">
    <circle cx="112" cy="74" r="7"/><circle cx="508" cy="74" r="7"/>
    <circle cx="508" cy="126" r="7"/><circle cx="112" cy="126" r="7"/>
  </g>

  <!-- start marker -->
  <rect x="66" y="32" width="58" height="17" fill="#14181B"/>
  <text x="95" y="45" font-size="10.5" fill="#fff" text-anchor="middle" font-weight="bold">START</text>
  <text x="95" y="62" font-size="10" fill="#14181B" text-anchor="middle" font-weight="bold">&amp; FINISH</text>

  <text x="310" y="62" font-size="11" text-anchor="middle" fill="#4A5459">walk the perimeter &#8212; camera angled inward</text>
  <text x="310" y="150" font-size="11" text-anchor="middle" fill="#B8590A" font-weight="bold">pause a beat at every corner &#9679;</text>
  <text x="310" y="190" font-size="11" text-anchor="middle" fill="#14181B">Finish where you started &#8212; that is what lets the tracker correct itself</text>
</svg>'''

# -------------------------------------------------------------- 4. furniture
FURNITURE = f'''<svg viewBox="0 0 620 158" xmlns="http://www.w3.org/2000/svg" role="img"
  aria-label="Plan view showing how furniture against a wall can shift the scanned wall">{DEFS}
  <text x="0" y="11" font-size="11" font-weight="bold" fill="#14181B">PLAN VIEW &#8212; WHY A BLOCKED WALL CANNOT BE TRUSTED</text>
  <text x="40" y="28" font-size="11" font-weight="bold" fill="#14181B">WHERE THE WALL REALLY IS</text>
  <rect x="40" y="34" width="540" height="11" fill="#14181B"/>
  <rect x="180" y="45" width="250" height="44" rx="4" fill="#E8EDEF" stroke="#6B757B" stroke-width="2"/>
  <text x="305" y="72" font-size="12" text-anchor="middle" fill="#4A5459" font-weight="bold">SOFA / STORAGE</text>
  <line x1="40" y1="91" x2="580" y2="91" stroke="#B8590A" stroke-width="2.6" stroke-dasharray="9 5"/>
  <text x="40" y="108" font-size="11" font-weight="bold" fill="#B8590A">WHAT THE SCAN MAY RETURN</text>
  <path d="M520,45 L520,91" stroke="#14181B" stroke-width="1.6" marker-start="url(#ar)" marker-end="url(#ar)"/>
  <text x="532" y="72" font-size="11" fill="#14181B" font-weight="bold">the error</text>
  <text x="40" y="132" font-size="11" fill="#14181B">So: <tspan font-weight="bold">put the tape on walls that are clear</tspan>, and mark the blocked ones &#8220;B&#8221; on the log.</text>
  <text x="40" y="150" font-size="10.5" fill="#4A5459">A tape reading on a blocked wall mixes sensor error with occlusion error, and calibrates nothing.</text>
</svg>'''

# ------------------------------------------------------------------ 5. open plan
OPENPLAN = f'''<svg viewBox="0 0 620 168" xmlns="http://www.w3.org/2000/svg" role="img"
  aria-label="One capture of an open plan versus two separate captures">{DEFS}

  <!-- right way -->
  <text x="0" y="12" font-size="11.5" font-weight="bold" fill="#B8590A">ONE SCAN &#10003;</text>
  <rect x="0" y="24" width="284" height="96" fill="#F4F6F7" stroke="#14181B" stroke-width="4"/>
  <line x1="98" y1="24" x2="98" y2="120" stroke="#B8590A" stroke-width="2.4" stroke-dasharray="8 5"/>
  <line x1="190" y1="24" x2="190" y2="120" stroke="#B8590A" stroke-width="2.4" stroke-dasharray="8 5"/>
  <text x="49"  y="76" font-size="10.5" text-anchor="middle" fill="#4A5459" font-weight="bold">KITCHEN</text>
  <text x="144" y="76" font-size="10.5" text-anchor="middle" fill="#4A5459" font-weight="bold">DINING</text>
  <text x="237" y="76" font-size="10.5" text-anchor="middle" fill="#4A5459" font-weight="bold">LIVING</text>
  <text x="142" y="140" font-size="10.5" text-anchor="middle" fill="#14181B">One floor, one capture. The dashed lines get</text>
  <text x="142" y="155" font-size="10.5" text-anchor="middle" fill="#14181B">drawn in the app &#8212; they are not walls.</text>

  <!-- wrong way -->
  <text x="336" y="12" font-size="11.5" font-weight="bold" fill="#6B757B">TWO SCANS &#10007;</text>
  <rect x="336" y="24" width="140" height="90" fill="#fff" stroke="#6B757B" stroke-width="3"/>
  <rect x="466" y="40" width="140" height="90" fill="#fff" stroke="#6B757B" stroke-width="3" stroke-dasharray="7 4"/>
  <text x="471" y="140" font-size="10.5" text-anchor="middle" fill="#14181B">Each capture starts its own coordinate system.</text>
  <text x="471" y="155" font-size="10.5" text-anchor="middle" fill="#14181B" font-weight="bold">They do not line up.</text>
</svg>'''
