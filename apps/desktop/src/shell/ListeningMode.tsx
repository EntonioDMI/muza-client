import { useEffect, useRef, useState } from "react";
import { Cover, IconButton, Lyrics, Slider } from "@muza/ui";
import type { LyricLine } from "../player/types";
import type { PlayerTrack } from "../player/types";
import { fmtTime } from "../lib/format";
import { Visualizer } from "./Visualizer";
import type { VisualizerTuning } from "./visualizerMath";
import { useT } from "../i18n";

/** OS-уровень «уменьшить анимацию» — жёсткий выключатель качания независимо
 *  от пользовательского прefa bassShake (как и общий anims); им же гасится
 *  транзишен схлопывания колонки текста. Без window.matchMedia (jsdom-тесты,
 *  старый WebView) — считаем, что предпочтения нет. */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Качание при басах (T14): первые бины analyser'а (~до 250Гц при fftSize
 *  2048) → сглаженная энергия (быстрая атака на удар, плавный спад) →
 *  scale/translate контейнера всего оверлея.
 *
 *  T48: базовая амплитуда (100%) осталась прежней, но теперь умножается на
 *  преф `bassShakeStrength` (0–300%) — «сколько трясти» это чистая вкусовщина,
 *  единственного правильного значения нет. Подъём растёт медленнее масштаба и
 *  всегда меньше запаса, который даёт scale (h·(s−1)/2), поэтому даже на 300%
 *  из-под краёв оверлея не выглядывает фон. Жёсткие выключатели (общий anims и
 *  OS prefers-reduced-motion) сильнее любого значения префа. */
const BASS_BINS = 10;
const BASS_ATTACK_SEC = 0.05;
const BASS_RELEASE_SEC = 0.35;
const BASS_SCALE_MAX = 0.02; // 1.0 → 1.02 при 100%
const BASS_LIFT_PX = 1.5; // лёгкий подъём на ударе при 100%

/** Полноэкранный «режим прослушивания» — караоке-оверлей («ночной вайб»). */
export function ListeningMode({
  open,
  track,
  lyrics,
  lyricsLoading = false,
  playing,
  pos,
  activeLine,
  lyricsAutoScroll = true,
  lyricsEndNote = true,
  onTogglePlay,
  onPrev,
  onNext,
  onSeek,
  onSeekLine,
  onExplain,
  onClose,
  lyricsShown = true,
  onToggleLyrics,
  visualizer = "off",
  getAnalyser,
  visualizerTuning,
  bassShake = false,
  bassShakeStrength = 150,
  anims = true,
}: {
  open: boolean;
  track: PlayerTrack;
  /** Строки текста — LRCLIB с сервера (слайс 4). */
  lyrics: LyricLine[];
  /** Текст ещё грузится — «Ищем текст…» вместо «Текст не найден». */
  lyricsLoading?: boolean;
  playing: boolean;
  pos: number;
  activeLine: number;
  /** Настройка «Автоскролл» (Тексты): следовать ли за активной строкой. */
  lyricsAutoScroll?: boolean;
  /** Настройка «Нотка в конце» (Тексты): декоративный знак под текстом. */
  lyricsEndNote?: boolean;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (v: number) => void;
  onSeekLine: (i: number) => void;
  /** Открыть общую модалку смысла для выделенной строки. */
  onExplain: (index: number) => void;
  onClose: () => void;
  /** Текст показан (преф listeningLyricsShown). false — «только обложка/
   *  визуализатор»: блок текста плавно гаснет, его колонка схлопывается
   *  (0fr), обложка занимает центр сцены. Плашки «Ищем текст…»/«Текст не
   *  найден» прячутся тем же тумблером — они живут в той же колонке. */
  lyricsShown?: boolean;
  /** Тумблер текста: кнопка mic-vocal в слое авто-прячущихся контролов
   *  (правый верхний угол, рядом со «Свернуть») и клавиша T. */
  onToggleLyrics?: () => void;
  /** Визуализатор (Stage 6): бары/волна поверх сцены, за контентом. */
  visualizer?: "bars" | "wave" | "off";
  getAnalyser?: () => AnalyserNode | null;
  /** Ручки вида визуализатора одним объектом (T50): проценты как в Prefs,
   *  недостающее Visualizer добьёт дефолтами VIS_LIMITS. */
  visualizerTuning?: Partial<VisualizerTuning>;
  /** Преф «Качание при басах» (T14, Настройки → Расширения → Встроенные). */
  bassShake?: boolean;
  /** Сила качания, % (T48): 100 = амплитуда T14, 0 — качания нет. */
  bassShakeStrength?: number;
  /** Общий переключатель анимаций — выключен, значит качание тоже выключено. */
  anims?: boolean;
}) {
  const { t } = useT();
  // OS «уменьшить анимацию» для схлопывания колонки текста. Не state: пока
  // оверлей открыт, пользователь системные настройки не крутит, а на
  // следующий рендер (тумблер и есть рендер) значение перечитается.
  const reducedMotion = prefersReducedMotion();
  const [calm, setCalm] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shakeRef = useRef<HTMLDivElement | null>(null);
  // getAnalyser — новая функция на каждый ре-рендер App (usePlayback тикает
  // pos несколько раз в секунду) — стабилизация через ref, как в Visualizer,
  // иначе огибающая басов (level) сбрасывалась бы каждые ~250мс.
  const getAnalyserRef = useRef(getAnalyser);
  useEffect(() => {
    getAnalyserRef.current = getAnalyser;
  }, [getAnalyser]);
  // Сила качания живёт в ref, а не в зависимостях rAF-эффекта ниже: иначе
  // каждое изменение префа пересоздавало бы цикл и роняло огибающую (level) в
  // ноль. Сегодня это никто бы не увидел — оверлей перекрывает собой настройки,
  // и при закрытом оверлее цикл вообще не крутится, — но менять силу может и
  // плагин (`prefs` пишутся не только ползунком), а тогда качание спотыкалось
  // бы на ровном месте. Приём тот же, что у getAnalyserRef выше.
  const strengthRef = useRef(bassShakeStrength);
  useEffect(() => {
    strengthRef.current = bassShakeStrength;
  }, [bassShakeStrength]);
  // Колбэк тумблера текста — через ref: keydown-эффект ниже пересоздаётся
  // только по [open], а App передаёт новую стрелку (с новыми prefs) на каждый
  // рендер. Без ref второе нажатие T работало бы со stale-префами и «отменяло»
  // первое (onClose такой защиты не требует — там внутри только setState).
  const onToggleLyricsRef = useRef(onToggleLyrics);
  useEffect(() => {
    onToggleLyricsRef.current = onToggleLyrics;
  }, [onToggleLyrics]);

  useEffect(() => {
    const node = shakeRef.current;
    if (!open || !bassShake || !anims || !getAnalyser || prefersReducedMotion()) {
      if (node) node.style.transform = "";
      return;
    }
    let raf = 0;
    let level = 0;
    let lastT = performance.now();
    const bass = new Uint8Array(BASS_BINS);
    if (node) node.style.willChange = "transform";
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const analyser = getAnalyserRef.current?.();
      if (!analyser) return;
      const now = performance.now();
      const dt = Math.min(0.25, Math.max(0, (now - lastT) / 1000));
      lastT = now;
      analyser.getByteFrequencyData(bass);
      let sum = 0;
      for (let i = 0; i < bass.length; i++) sum += bass[i];
      const raw = sum / bass.length / 255; // 0..1
      const tau = raw > level ? BASS_ATTACK_SEC : BASS_RELEASE_SEC;
      level += (raw - level) * (1 - Math.exp(-dt / tau));
      const s = Math.max(0, Math.min(1, level));
      const target = shakeRef.current;
      if (target) {
        const k = Math.max(0, strengthRef.current) / 100;
        target.style.transform = `scale(${(1 + s * BASS_SCALE_MAX * k).toFixed(4)}) translateY(${(-s * BASS_LIFT_PX * k).toFixed(2)}px)`;
      }
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      if (shakeRef.current) {
        shakeRef.current.style.transform = "";
        shakeRef.current.style.willChange = "";
      }
    };
    // getAnalyser стабилизирован через ref выше — эффект от его identity не зависит.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bassShake, anims]);

  const wake = () => {
    setCalm(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCalm(true), 2500);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // на входе показать управление, Escape — выход, T — тумблер текста
  useEffect(() => {
    if (!open) return;
    wake();
    const onKey = (e: KeyboardEvent) => {
      // Модалка смысла живёт поверх режима прослушивания и сама обрабатывает
      // Escape. Пока dialog открыт, нижний оверлей не должен закрываться следом.
      if (e.key === "Escape" && !document.querySelector('[role="dialog"]')) onClose();
      // T (физическая клавиша, layout-независимо, как lib/hotkeys) — скрыть/
      // показать текст. Только «голая»: с модификаторами это чужие комбо; в
      // lib/hotkeys KeyT не занят. Поверх диалога — не срабатывает (там могут
      // печатать), в полях ввода — тоже.
      if (
        e.code === "KeyT" &&
        !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey &&
        !document.querySelector('[role="dialog"]')
      ) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        onToggleLyricsRef.current?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div
      ref={shakeRef}
      data-testid="listening-mode"
      onMouseMove={wake}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 100,
        overflow: "hidden",
        background: "var(--bg-0)",
        opacity: open ? 1 : 0,
        visibility: open ? "visible" : "hidden",
        pointerEvents: open ? "auto" : "none",
        transition: open
          ? "opacity var(--dur-slow) var(--ease-out), visibility 0s"
          : "opacity var(--dur-slow) var(--ease-out), visibility 0s linear var(--dur-slow)",
      }}
    >
      {/* Декоративный размытый задник, не обложка — потому не Cover.
          Нет обложки → задника просто нет (остаётся фон зоны). */}
      {track.cover ? (
        <img
          src={track.cover}
          alt=""
          style={{
            position: "absolute",
            inset: "-10%",
            width: "120%",
            height: "120%",
            objectFit: "cover",
            filter: "blur(var(--blur-scenery))",
            transform: "scale(1.1)",
          }}
        />
      ) : null}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "var(--glass-deep)",
          backdropFilter: "blur(var(--blur-glass))",
          WebkitBackdropFilter: "blur(var(--blur-glass))",
        }}
      ></div>

      {/* Визуализатор — за контентом, клики не перехватывает; прозрачность
          теперь ручка (tuning.opacity) и живёт на самом канвасе */}
      {visualizer !== "off" && getAnalyser ? (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: visualizer === "bars" ? "24vh" : "34vh",
            pointerEvents: "none",
          }}
        >
          <Visualizer mode={visualizer} active={open} getAnalyser={getAnalyser} tuning={visualizerTuning} />
        </div>
      ) : null}

      {/* Сцена: обложка + колонка текста. Скрытие текста (lyricsShown=false)
          не выкидывает колонку из DOM, а схлопывает её в 0fr (у обёртки ниже
          minWidth:0 + overflow:hidden, иначе 0fr не сожмётся меньше контента) и
          центрирует оставшуюся обложку justifyContent'ом — возврат текста
          такой же плавный, без ремоунта Lyrics и потери скролла. Транзишен
          grid-template-columns анимируем: WebView2 = Chromium ≥117. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          gridTemplateColumns: lyricsShown ? "minmax(300px, 420px) 1fr" : "minmax(300px, 420px) 0fr",
          justifyContent: lyricsShown ? undefined : "center",
          gap: lyricsShown ? "var(--sp-9)" : "0px",
          alignItems: "center",
          padding: "0 var(--sp-10)",
          transform: open ? "translateY(0) scale(1)" : "translateY(24px) scale(0.985)",
          // reduced-motion: схлопывание колонки мгновенно (anims=false и так
          // даёт --dur-slow: 1ms токеном App'а — отдельно не проверяем)
          transition: reducedMotion
            ? "transform var(--dur-slow) var(--ease-out)"
            : "transform var(--dur-slow) var(--ease-out), grid-template-columns var(--dur-slow) var(--ease-out), gap var(--dur-slow) var(--ease-out)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
          <Cover src={track.cover} radius="var(--r-xl)" />
          <div>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 26,
                fontWeight: 600,
                letterSpacing: "var(--ls-display)",
                color: "var(--text-1)",
              }}
            >
              {track.title}
            </div>
            <div style={{ fontSize: "var(--fs-strong)", color: "var(--text-2)", marginTop: 6 }}>
              {track.album ? `${track.artist} · ${track.album}` : track.artist}
            </div>
          </div>
        </div>
        {/* Обёртка колонки текста: гасится и для Lyrics, и для плашек
            «Ищем текст…»/«Текст не найден» — тумблер один на всё. */}
        <div
          data-testid="lm-lyrics"
          aria-hidden={lyricsShown ? undefined : true}
          style={{
            height: "100%",
            minWidth: 0,
            overflow: "hidden",
            opacity: lyricsShown ? 1 : 0,
            pointerEvents: lyricsShown ? "auto" : "none",
            transition: reducedMotion ? undefined : "opacity var(--dur-slow) var(--ease-out)",
          }}
        >
          {lyrics.length > 0 ? (
            <Lyrics lines={lyrics} activeIndex={activeLine} mode="karaoke" autoScroll={lyricsAutoScroll} endNote={lyricsEndNote} onSeek={onSeekLine} onExplain={onExplain} style={{ height: "100%" }} />
          ) : (
            <div
              style={{
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-3)",
                fontSize: "var(--fs-strong)",
              }}
            >
              {lyricsLoading ? t("player.lyricsSearching") : t("player.lyricsNotFound")}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          top: "var(--sp-6)",
          right: "var(--sp-6)",
          display: "flex",
          gap: "var(--sp-3)",
          opacity: calm ? 0 : 1,
          transition: "opacity var(--dur-slow) var(--ease-out)",
          pointerEvents: calm ? "none" : "auto",
        }}
      >
        {/* Тумблер текста — та же иконка mic-vocal и та же семантика active,
            что у кнопки «Текст» в PlayerBar; хоткей T (см. keydown выше). */}
        <IconButton
          icon="mic-vocal"
          variant="surface"
          active={lyricsShown}
          label={lyricsShown ? t("listeningMode.hideLyrics") : t("listeningMode.showLyrics")}
          onClick={onToggleLyrics}
        />
        <IconButton icon="minimize-2" variant="surface" label={t("listeningMode.minimize")} onClick={onClose} />
      </div>

      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: "var(--sp-6)",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: "var(--sp-4)",
          padding: "var(--sp-3) var(--sp-5)",
          borderRadius: "var(--r-pill)",
          background: "var(--glass-panel)",
          backdropFilter: "blur(var(--blur-glass))",
          WebkitBackdropFilter: "blur(var(--blur-glass))",
          opacity: calm ? 0 : 1,
          transition: "opacity var(--dur-slow) var(--ease-out)",
          pointerEvents: calm ? "none" : "auto",
        }}
      >
        <IconButton icon="skip-back" label={t("player.previous")} onClick={onPrev} />
        <IconButton
          icon={playing ? "pause" : "play"}
          variant="accent"
          size="lg"
          label={playing ? t("player.pause") : t("player.play")}
          onClick={onTogglePlay}
        />
        <IconButton icon="skip-forward" label={t("player.next")} onClick={onNext} />
        <span style={{ fontSize: 13, color: "var(--text-2)", fontVariantNumeric: "tabular-nums", paddingLeft: 6 }}>{fmtTime(pos)}</span>
        <Slider value={pos} max={track.duration} onChange={onSeek} ariaLabel={t("player.progress")} style={{ width: 220 }} />
        <span style={{ fontSize: 13, color: "var(--text-2)", fontVariantNumeric: "tabular-nums" }}>{fmtTime(track.duration)}</span>
      </div>
    </div>
  );
}
