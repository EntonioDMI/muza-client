/** Progress / volume slider — thin pill, accent fill, thumb appears on hover. */
export interface SliderProps {
  /** Current value, 0..max. */
  value?: number;
  /** Default 100. Track progress uses seconds. */
  max?: number;
  onChange?: (value: number) => void;
  /** Accessible label (Russian), e.g. "Громкость". */
  ariaLabel?: string;
  /** Human value for screen readers (aria-valuetext), e.g. "1:24 из 3:45". */
  valueText?: string;
  /** Enables the scrub-preview bubble over the cursor; return the label for
   *  a hovered value, e.g. (v) => fmtTime(v). Progress bars pass this. */
  hoverLabel?: (value: number) => string;
  /** Единиц value в секунду реального времени; 0 (дефолт) — выключено.
   *  Прогресс-бары передают `playing ? speed : 0`: между рваными приходами
   *  value заливка дорисовывается кадрами rAF, без этого она идёт ступеньками.
   *  Слайдерам громкости/настроек не нужно — их value не течёт само. */
  rate?: number;
  /** Куда прижата дорожка внутри бокса: "start" — к верхней кромке (полоса
   *  прогресса по верхнему краю плеера), "end" — к нижней. Дефолт "center";
   *  у краевых вариантов ползунка-круга нет — его резала бы кромка. */
  align?: "center" | "start" | "end";
  /** Толщина ДОРОЖКИ: число (px) или CSS-длина, чтобы можно было отдать
   *  переменную темы. Наведение добавляет +2px при любом значении. Дефолт 4. */
  thickness?: number | string;
  style?: React.CSSProperties;
}
