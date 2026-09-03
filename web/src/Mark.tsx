/**
 * The mark, inline.
 *
 * Three things the product does, in one drawing. The outer brackets are a scan
 * reticle — what the phone frames before it reads a room. Inside it, a sheet
 * with a gable: the bid, and the building it is for, are the same object here
 * because in this app they are produced in one act. The two ink rules are line
 * items; the amber rule under them is the total, in the colour that means
 * *measured* everywhere else in this product.
 *
 * It is drawn here rather than fetched so it cannot arrive late, go missing
 * from a build, or need a network the app deliberately does not have.
 *
 * `core/tools/gen-art.mjs` draws the app icon and the launch screen from these
 * same numbers and fails if they stop matching, so there is one mark and not
 * two that drift.
 */
export function Mark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="155 155 714 714" className={className} role="img" aria-label="ScanToBid">
      <g fill="none" stroke="currentColor" strokeWidth="50" strokeLinecap="butt">
        <path d="M180 320 L180 180 L320 180" />
        <path d="M704 180 L844 180 L844 320" />
        <path d="M844 704 L844 844 L704 844" />
        <path d="M320 844 L180 844 L180 704" />
      </g>
      <path
        d="M336 448 L512 296 L688 448 L688 690 L336 690 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="36"
        strokeLinejoin="miter"
      />
      <g fill="currentColor">
        <rect x="396" y="494" width="232" height="30" />
        <rect x="396" y="548" width="152" height="30" />
      </g>
      <rect x="396" y="608" width="232" height="52" fill="#B8590A" />
    </svg>
  );
}
