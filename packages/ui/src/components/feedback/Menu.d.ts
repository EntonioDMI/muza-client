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
    /** Пункт-ползунок: в покое обычная строка, под курсором — шкала с заливкой
     *  по значению. Для редких ручек (скорость, высота тона), которым не место
     *  в самой полосе плеера. */
    | {
        slider: {
          icon?: string;
          label: string;
          value: number;
          min: number;
          max: number;
          /** Шаг квантования; по умолчанию 1. */
          step?: number;
          /** Подпись значения справа («1,25×», «+2»). */
          format?: (v: number) => string;
          onChange: (v: number) => void;
        };
      }
    | "-"
  >;
  /** Outside click + Escape. */
  onClose?: () => void;
}
