/** Раздел страницы: заголовок + содержимое на карточной плёнке. */
export interface PanelProps {
  /** Заголовок раздела (h2). Без него и без action шапка не рисуется вовсе. */
  title?: React.ReactNode;
  /** Правый край шапки: кнопка, счётчик, фильтр — в одну строку с заголовком. */
  action?: React.ReactNode;
  /** Содержимое во всю ширину карточки — для списков со своим полем и ховером. */
  flush?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
