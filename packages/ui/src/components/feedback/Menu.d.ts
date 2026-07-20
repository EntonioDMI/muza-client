/** Context / dropdown menu anchored at a point (track actions, sort options). */
export interface MenuProps {
  open: boolean;
  /** Anchor coordinates within the window. */
  x?: number;
  y?: number;
  /** "-" renders a spacer group break; { header } — заголовок секции («Выбрано: 3»). */
  items?: Array<
    | {
        icon?: string;
        label: string;
        onClick?: () => void;
        danger?: boolean;
        /** Пункт виден, но недоступен: приглушён и вне клавиатурного обхода. */
        disabled?: boolean;
        /** Тихая правая подпись («· 3», шорткат). */
        hint?: string;
      }
    | { header: string }
    | "-"
  >;
  /** Outside click + Escape. */
  onClose?: () => void;
}
