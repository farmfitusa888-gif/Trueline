/**
 * The mark, inline.
 *
 * Two lines, which is the whole product: a dimension line with its end ticks —
 * a true length, the thing a tape gives you and a scanner only estimates — and
 * a plumb line with the bob on the end, true vertical, the one measuring
 * instrument that cannot drift. Together they read as a T.
 *
 * It is drawn here rather than fetched so it cannot arrive late, go missing
 * from a build, or need a network the app deliberately does not have.
 */
export function Mark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="214 226 596 582" className={className} role="img" aria-label="ScanToBid">
      <g stroke="currentColor" strokeLinecap="butt">
        <line x1="224" y1="300" x2="800" y2="300" strokeWidth="46" />
        <line x1="234" y1="234" x2="234" y2="366" strokeWidth="24" />
        <line x1="790" y1="234" x2="790" y2="366" strokeWidth="24" />
        <line x1="512" y1="300" x2="512" y2="596" strokeWidth="46" />
      </g>
      <polygon points="512,584 578,646 578,690 512,800 446,690 446,646" fill="#B8590A" />
    </svg>
  );
}
