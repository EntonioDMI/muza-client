/** Round icon-only button — transport controls, toggles, panel chrome. */
export interface IconButtonProps {
  /** Lucide icon name, kebab-case. */
  icon: string;
  /** "sm" 36px | "md" 44px | "lg" 52px. Default "md" (min hit target 44). */
  size?: "sm" | "md" | "lg";
  /** "ghost" (default) | "surface" | "accent" (the play FAB). */
  variant?: "ghost" | "surface" | "accent";
  /** Toggled-on state (shuffle, repeat, lyrics) — accent-colored glyph. */
  active?: boolean;
  disabled?: boolean;
  /** Accessible label (Russian), e.g. "Следующий трек". */
  label?: string;
  onClick?: () => void;
  /** Override glyph px size. */
  iconSize?: number;
  style?: React.CSSProperties;
}
