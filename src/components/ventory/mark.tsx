export function Mark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="2 0 43.2 40" className={className} aria-hidden="true">
      <path d="M3 1.5 L24 38.5 L45 1.5 L33.2 1.5 L24 22.8 L14.8 1.5 Z" fill="currentColor" />
      <rect x="19.3" y="3.4" width="9.4" height="8.2" rx="2.1" fill="var(--color-accent)" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline text-ink ${className ?? ""}`} aria-label="Ventory">
      <Mark className="-mr-[0.12em] h-[0.72em] w-auto shrink-0" />
      <span className="font-display leading-none tracking-tight" aria-hidden="true">
        entory
      </span>
    </span>
  );
}
