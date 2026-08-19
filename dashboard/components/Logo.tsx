/**
 * The OpenZeppelin Z mark, inlined so it renders without a network fetch and can
 * inherit sizing from its container. Colours are fixed by the brand book:
 * violet top bar, blue diagonal, cyan bottom bar.
 */
export function ZMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={(size * 127) / 150}
      height={size}
      viewBox="0 0 127 150"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M0 148.638C16.5023 120.086 30.5249 96.5383 48.3477 64.265C54.6433 53.3745 65.5217 46.6074 78.951 46.6074H100.052L41.1242 148.638H0Z"
        fill="#2E99FF"
      />
      <path d="M0.186768 0H126.804L105.17 37.7215H0.186768V0Z" fill="#4F56FA" />
      <path
        d="M63.6089 125.145C68.3703 116.728 76.0241 111.499 86.7442 111.499L126.827 111.389V148.641H50.0247C54.8332 140.394 59.0086 133.278 63.6089 125.145Z"
        fill="#09C2FF"
      />
    </svg>
  );
}

/** Z mark plus wordmark. The wordmark is set in Inter to match the brand font. */
export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span className="inline-flex items-center" style={{ gap: size * 0.55 }}>
      <ZMark size={size} />
      <span
        className="font-semibold tracking-tight"
        style={{ fontSize: size * 0.82, color: "var(--text)", lineHeight: 1 }}
      >
        OpenZeppelin
      </span>
    </span>
  );
}
