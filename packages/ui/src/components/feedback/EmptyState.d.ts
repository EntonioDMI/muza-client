/** Teaching empty state: soft accent icon circle, title, hint, optional CTA. */
export interface EmptyStateProps {
  /** Lucide icon name. Default "music-2". */
  icon?: string;
  title: string;
  hint?: string;
  /** Action node, e.g. a <Button>. */
  action?: React.ReactNode;
  style?: React.CSSProperties;
}
