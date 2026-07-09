/**
 * Muza pill button. Primary = the one accent action on screen.
 * @startingPoint section="Core" subtitle="Кнопка-пилюля: primary / secondary / ghost" viewport="700x220"
 */
export interface ButtonProps {
  /** "primary" (accent, one per view) | "secondary" (surface) | "ghost". Default "secondary". */
  variant?: "primary" | "secondary" | "ghost";
  /** "md" 40px | "lg" 48px. Default "md". */
  size?: "md" | "lg";
  /** Optional leading Lucide icon name (kebab-case). */
  icon?: string;
  children?: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}
