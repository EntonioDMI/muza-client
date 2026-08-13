/** Modal dialog on frosted scrim. Exhaust inline alternatives first. */
export interface DialogProps {
  open: boolean;
  /** Sentence-case title: «Новый плейлист». */
  title?: string;
  /** Тихая вторая строка под заголовком: ЧТО ПРОИЗОЙДЁТ. Не пересказ тела. */
  description?: string;
  /** Глиф лица диалога (lucide-имя) в круглой плашке слева от заголовка. */
  icon?: string;
  /** "danger" красит только плашку-лицо. Вес кнопок — забота вызывателя. */
  tone?: "neutral" | "danger";
  /** Optional control at the right edge of the title row, usually close. */
  headerAction?: React.ReactNode;
  /** Крестик в шапке. По умолчанию — есть, ЕСЛИ не передан headerAction
   *  (иначе вызыватель уже распорядился шапкой сам). false — убрать явно:
   *  из подтверждений выход должен быть осознанным. */
  showClose?: boolean;
  /** Подпись крестика для читалок; пакет без i18n. По умолчанию "Close". */
  closeLabel?: string;
  children?: React.ReactNode;
  /** Right-aligned buttons; primary rightmost. */
  actions?: React.ReactNode;
  /** Scrim click + Escape. */
  onClose?: () => void;
  /** Panel width, px. Default 440. */
  width?: number;
}
