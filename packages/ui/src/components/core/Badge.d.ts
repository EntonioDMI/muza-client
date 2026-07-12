/** Tiny status pill: "web", "новое", counters. */
export interface BadgeProps {
  children?: React.ReactNode;
  /** accent (soft accent fill, default) | neutral (surface). */
  tone?: "accent" | "neutral";
  style?: React.CSSProperties;
}
