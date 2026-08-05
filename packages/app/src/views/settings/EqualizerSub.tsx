/** ПОД-ЭКРАН «ЭКВАЛАЙЗЕР»: десятиполосник с вертикальными фейдерами.
 *
 *  Приехало из apps/desktop/src/views/SettingsView.tsx (волна «настройки»,
 *  2026-08-02); ВИД полос переделан 2026-08-02 (волна 8, разбор ниже).
 *
 *  Эквалайзер реально крутит звук (Web Audio) на обеих площадках, поэтому
 *  умения ему не нужно: полосы лежат в общей модели настроек, а применяет их
 *  плеер.
 *
 *  ⚠️ ОДНА РАЗМЕТКА НА ДВА КЛИЕНТА. Тело эквалайзера (чипы пресетов + панель
 *  полос + сброс) вынесено в экспортируемый `EqualizerControls`: приложение
 *  рисует его под-экраном, а веб — прямо в разделе «Воспроизведение»
 *  (apps/web/app/(app)/settings/page.tsx). До этого у веба была своя копия
 *  ряда фейдеров, и она разъехалась: полосы вдвое короче (120 против 150),
 *  без панели, без цифр дБ, без сброса и с латинской подписью «1k» вместо
 *  словарной «1к».
 *
 *  ПОЧЕМУ НЕ @muza/ui Fader. Фейдер дизайн-системы заливает дорожку ОТ НИЗА:
 *  полоса на 0 дБ выглядит как «половина громкости», хотя это «ничего не
 *  меняем», а ровный эквалайзер читается как лесенка непонятно чего. Плюс
 *  ручка у него появляется только на наведении — при чёрном акценте (у
 *  владельца accent = #000000) от полосы оставалась одна серая ниточка.
 *  Эквалайзеру нужна заливка ОТ НУЛЯ вверх/вниз, всегда видимая ручка и
 *  сетка дБ; общий Fader такого не умеет, а он живёт в @muza/ui и трогать
 *  его из этой зоны нельзя. Поэтому полоса нарисована здесь — но только на
 *  токенах ДС (surface, text, accent, r-pill, dur-fast, ease-out) и с той же
 *  клавиатурой, что у Fader (стрелки ±1, Shift ±3, Home/End, «0» — в ноль). */

import { useRef, useState } from "react";
import { Button, ChipGroup, Switch } from "@muza/ui";
import { useT, type TranslationKey, type TParams } from "../../i18n";
import { paneStyle, SettingRow, SubHeader } from "./primitives";
import { useSettingsScreen } from "./settingsContext";

/** Полосы десятиполосника, Гц. Числа, а не строки: подпись «1 к»/«1 k»
 *  собирается через словарь, а не хардкодится языко-зависимой буквой. */
const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/** ⚠️ Ключи EQ_PRESETS — это ПЕРСИСТЕНТНЫЕ значения prefs.eqPreset, общие с
 *  DEFAULT_PREFS и уже лежащие в сохранённых настройках людей. Переименование
 *  сломало бы совместимость, поэтому они сознательно не переведены. */
const EQ_PRESETS: Record<string, number[]> = {
  Ровный: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Бас: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  Рок: [5, 4, 2, 0, -1, 0, 2, 3, 4, 4],
  Поп: [-1, 0, 2, 4, 5, 4, 2, 0, -1, -1],
  Вокал: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
};

const EQ_MIN = -12;
const EQ_MAX = 12;
/** Высота дорожки. 168 = 4 × 42: сетка каждые 6 дБ ложится на целые пиксели. */
const TRACK_H = 168;
/** Уровни сетки, дБ. Подписаны только края и ноль — остальные линии молчат. */
const GRID_DB = [12, 6, 0, -6, -12];
/** Высота строки с цифрой дБ и строки с частотой. Фиксированы, потому что по
 *  ним же выставляется вертикальный отступ линеек сетки и шкалы слева:
 *  колонка полосы и колонка шкалы собираются из одинаковых кирпичей. */
const CAP_H = 18;
/** Шаг между кирпичами колонки (= var(--sp-2)); нужен числом для сетки. */
const COL_GAP = 8;
/** Минимальная ширина полосы (палец) и всего ряда полос: ниже неё панель
 *  прокручивается вбок, а не сдавливает полосы. 10 × 40 + 9 × 4 (var(--sp-1)). */
const BAND_MIN_W = 40;
const BANDS_MIN_W = 10 * BAND_MIN_W + 9 * 4;

/** Доля дорожки снизу для значения в дБ (0 → низ, 1 → верх). */
const ratio = (db: number) => (db - EQ_MIN) / (EQ_MAX - EQ_MIN);
const pct = (db: number) => ratio(db) * 100;

/** Подпись частоты: до 1 кГц — как есть, дальше «1k»/«1к». */
function eqBandLabel(hz: number, t: (key: TranslationKey, params?: TParams) => string): string {
  return hz >= 1000 ? `${hz / 1000}${t("settings.playback.equalizer.kiloSuffix")}` : `${hz}`;
}

/** Цифра дБ со знаком: «+5», «0», «−3» (типографский минус, как на шкале). */
const dbText = (db: number) => (db > 0 ? `+${db}` : db < 0 ? `−${Math.abs(db)}` : "0");

/** ОДНА ПОЛОСА. Тянется за всю колонку, а не за 24-пиксельную дорожку: цель
 *  шириной с колонку (≈70 px) — это то, ради чего фейдеры вообще ставят в ряд,
 *  иначе в них надо целиться. Захват указателя оставляет полосу «в руке» и
 *  за пределами окна; потерянный pointerup (отпустили вне окна) страхуется
 *  проверкой e.buttons, как в @muza/ui Fader. */
function BandFader({
  value,
  label,
  ariaLabel,
  disabled,
  onChange,
}: {
  value: number;
  label: string;
  ariaLabel: string;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const gripRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [drag, setDrag] = useState(false);
  const active = hover || drag;

  const setFromEvent = (e: React.PointerEvent) => {
    const el = trackRef.current;
    if (!el || disabled) return;
    const r = el.getBoundingClientRect();
    const p = Math.max(0, Math.min(1, (r.bottom - e.clientY) / r.height));
    onChange(Math.round(EQ_MIN + p * (EQ_MAX - EQ_MIN)));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    let next: number | null = null;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") next = value + (e.shiftKey ? 3 : 1);
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") next = value - (e.shiftKey ? 3 : 1);
    else if (e.key === "Home") next = EQ_MAX;
    else if (e.key === "End") next = EQ_MIN;
    else if (e.key === "0") next = 0;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation(); // глобальные хоткеи не должны дублировать шаг
    onChange(Math.max(EQ_MIN, Math.min(EQ_MAX, next)));
  };

  const p = pct(value);
  const zero = pct(0);
  // Заливка живёт МЕЖДУ нулём и значением: 0 дБ — пустая дорожка, буст растёт
  // вверх, срез — вниз. Это и есть «нулевая линия», только внутри полосы.
  const fillBottom = Math.min(p, zero);
  const fillH = Math.abs(p - zero);
  const w = active && !disabled ? 8 : 6;

  return (
    <div
      role="slider"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      aria-valuenow={value}
      aria-valuemin={EQ_MIN}
      aria-valuemax={EQ_MAX}
      aria-valuetext={`${dbText(value)} dB`}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onPointerDown={(e) => {
        if (disabled) return;
        // ПАЛЬЦЕМ полосу берут только за среднюю ленту (см. gripRef ниже):
        // колонка шириной 70 px удобна мышью, но на телефоне она заняла бы всю
        // панель — и страница перестала бы прокручиваться там, где эквалайзер.
        if (e.pointerType === "touch" && !gripRef.current?.contains(e.target as Node)) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(true);
        setFromEvent(e);
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        if (e.pointerType === "mouse" && (e.buttons & 1) === 0) {
          setDrag(false);
          return;
        }
        setFromEvent(e);
      }}
      onPointerUp={() => setDrag(false)}
      onPointerCancel={() => setDrag(false)}
      onLostPointerCapture={() => setDrag(false)}
      // Двойной щелчок возвращает полосу в ноль — привычный жест микшера,
      // и единственный способ попасть в ровный ноль мышью с первого раза.
      onDoubleClick={() => !disabled && onChange(0)}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: COL_GAP,
        flex: "1 1 0",
        minWidth: BAND_MIN_W,
        cursor: disabled ? "default" : "pointer",
        // pan-y на колонке: палец, начавший движение мимо ленты захвата,
        // прокручивает страницу, а не тянет полосу.
        touchAction: "pan-y",
        outlineOffset: 4,
      }}
    >
      <span
        style={{
          height: CAP_H,
          lineHeight: `${CAP_H}px`,
          fontSize: "var(--fs-caption)",
          fontWeight: value === 0 ? 400 : 600,
          fontVariantNumeric: "tabular-nums",
          color: value === 0 ? "var(--text-3)" : "var(--text-1)",
          transition: "color var(--dur-state) var(--ease-standard)",
        }}
      >
        {dbText(value)}
      </span>
      <div ref={trackRef} style={{ position: "relative", height: TRACK_H, width: "100%", display: "flex", justifyContent: "center" }}>
        <div
          style={{
            width: w,
            height: "100%",
            borderRadius: "var(--r-pill)",
            background: "var(--surface-3)",
            transition: "width var(--dur-state) var(--ease-standard)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%)",
            bottom: `${fillBottom}%`,
            height: `${fillH}%`,
            width: w,
            borderRadius: "var(--r-pill)",
            background: "var(--accent-slider, var(--accent))",
            transition: "width var(--dur-state) var(--ease-standard)",
          }}
        />
        {/* Ручка видна ВСЕГДА: при чёрном акценте заливка не читается, и без
            ручки уровень полосы пришлось бы угадывать. Форма — колпачок
            фейдера, а не точка: он шире дорожки и виден на фоне сетки. */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "50%",
            bottom: `calc(${p}% - 3px)`,
            transform: `translateX(-50%) scaleX(${active && !disabled ? 1.15 : 1})`,
            width: 20,
            height: 6,
            borderRadius: "var(--r-pill)",
            background: "var(--text-1)",
            transition: "transform var(--dur-state) var(--ease-standard)",
            pointerEvents: "none",
          }}
        />
        {/* Лента захвата пальцем: прозрачная, лежит поверх дорожки. Только на
            ней touch-action: none — здесь палец ведёт полосу, а не страницу. */}
        <div
          ref={gripRef}
          aria-hidden="true"
          // 28 px ширины — примерно как у прежнего фейдера с зазором: между
          // лентами остаётся полоса, по которой страница листается пальцем.
          style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", top: 0, bottom: 0, width: 28, touchAction: "none" }}
        />
      </div>
      <span
        style={{
          height: CAP_H,
          lineHeight: `${CAP_H}px`,
          fontSize: "var(--fs-caption)",
          fontVariantNumeric: "tabular-nums",
          color: active && !disabled ? "var(--text-2)" : "var(--text-3)",
          transition: "color var(--dur-state) var(--ease-standard)",
        }}
      >
        {label}
      </span>
    </div>
  );
}

/** ПАНЕЛЬ ПОЛОС: шкала дБ слева, линейки сетки поперёк, десять полос.
 *  Сетка и подписи шкалы позиционируются в одном и том же окне высотой
 *  TRACK_H, сдвинутом на строку цифры (CAP_H + COL_GAP), — поэтому «0» шкалы
 *  лежит ровно на нулевой линии и на ручках ровного эквалайзера. */
function BandPanel({ bands, disabled, onBand, t }: { bands: number[]; disabled: boolean; onBand: (i: number, v: number) => void; t: (key: TranslationKey, params?: TParams) => string }) {
  return (
    <div
      style={{
        display: "flex",
        gap: "var(--sp-3)",
        padding: "var(--sp-5)",
        borderRadius: "var(--r-md)",
        background: "var(--surface-2)",
        opacity: disabled ? 0.45 : 1,
        transition: "opacity var(--dur-state) var(--ease-standard)",
        // Узкое окно (телефон в браузере): панель прокручивается вбок, а не
        // сдавливает полосы в нечитаемую гребёнку. Полоса не уже 40 px —
        // ниже этого в неё уже не попасть пальцем.
        overflowX: "auto",
        scrollbarWidth: "none",
      }}
    >
      {/* Шкала дБ. Подписаны только края и ноль: пять цифр в столбик шумят,
          а промежуточные линии и так читаются как «по 6 дБ». */}
      <div style={{ flex: "none", width: 28, display: "flex", flexDirection: "column", gap: COL_GAP }}>
        <span style={{ height: CAP_H }} />
        <div style={{ position: "relative", height: TRACK_H }}>
          {[12, 0, -12].map((db) => (
            <span
              key={db}
              style={{
                position: "absolute",
                right: 0,
                bottom: `${pct(db)}%`,
                transform: "translateY(50%)",
                fontSize: "var(--fs-caption)",
                fontVariantNumeric: "tabular-nums",
                color: db === 0 ? "var(--text-2)" : "var(--text-3)",
                whiteSpace: "nowrap",
              }}
            >
              {dbText(db)}
            </span>
          ))}
        </div>
        <span style={{ height: CAP_H }} />
      </div>
      <div style={{ position: "relative", flex: 1, minWidth: BANDS_MIN_W, display: "flex", gap: "var(--sp-1)" }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: CAP_H + COL_GAP, height: TRACK_H, pointerEvents: "none" }}>
          {GRID_DB.map((db) => (
            <div
              key={db}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: `${pct(db)}%`,
                height: 1,
                // Ноль — вдвое плотнее прочих линий: это точка отсчёта, от неё
                // растёт заливка, и глаз должен ловить её без чтения цифр.
                background: db === 0 ? "var(--surface-4)" : "var(--surface-2)",
              }}
            />
          ))}
        </div>
        {EQ_BANDS.map((f, i) => (
          <BandFader
            key={f}
            value={bands[i] ?? 0}
            label={eqBandLabel(f, t)}
            ariaLabel={t("settings.equalizer.bandAria", { freq: eqBandLabel(f, t) })}
            disabled={disabled}
            onChange={(v) => onBand(i, v)}
          />
        ))}
      </div>
    </div>
  );
}

/** ТЕЛО ЭКВАЛАЙЗЕРА — чипы пресетов, панель полос, сброс. Общее для обоих
 *  клиентов: приложение зовёт его из под-экрана, веб — из раздела. Настройки
 *  сюда приезжают пропсами, потому что у веба своя модель prefs. */
export function EqualizerControls({
  bands,
  preset,
  disabled = false,
  onPreset,
  onBand,
}: {
  bands: number[];
  preset: string;
  disabled?: boolean;
  onPreset: (name: string) => void;
  onBand: (i: number, v: number) => void;
}) {
  const { t } = useT();
  return (
    <>
      {/* Чипы НЕ гаснут вместе с полосами: выбрать профиль заранее, а потом
          включить эквалайзер — нормальный порядок, и так вёл себя под-экран
          приложения до этой волны. */}
      <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap" }}>
        <ChipGroup items={[...Object.keys(EQ_PRESETS), "Свой"]} value={preset} onChange={onPreset} />
      </div>
      <BandPanel bands={bands} disabled={disabled} onBand={onBand} t={t} />
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
        <Button variant="ghost" icon="rotate-ccw" disabled={disabled} onClick={() => onPreset("Ровный")}>
          {t("settings.equalizer.resetBands")}
        </Button>
      </div>
    </>
  );
}

export { EQ_PRESETS };

export function EqualizerSub() {
  const { t } = useT();
  const { prefs, setPrefs, closeSub, paneClass } = useSettingsScreen();
  const eqOn = prefs.eqOn;
  const setEqOn = (on: boolean) => setPrefs({ ...prefs, eqOn: on });
  const applyPreset = (name: string) => setPrefs({ ...prefs, eqPreset: name, eqBands: EQ_PRESETS[name] ?? prefs.eqBands });
  const setBand = (i: number, v: number) =>
    setPrefs({
      ...prefs,
      eqPreset: "Свой",
      eqBands: prefs.eqBands.map((x, j) => (j === i ? Math.round(v) : x)),
    });

  return (
    <div className={paneClass} style={paneStyle}>
      <SubHeader title={t("settings.equalizer.title")} onBack={closeSub} />
      <SettingRow title={t("settings.equalizer.enable.title")} hint={t("settings.equalizer.enable.hint")}>
        <Switch checked={eqOn} onChange={setEqOn} label={t("settings.equalizer.title")} />
      </SettingRow>
      <EqualizerControls bands={prefs.eqBands} preset={prefs.eqPreset} disabled={!eqOn} onPreset={applyPreset} onBand={setBand} />
    </div>
  );
}
