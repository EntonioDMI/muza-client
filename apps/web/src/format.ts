import { DEFAULT_LANG, translate, type Lang } from "@muza/app";

/** "3:47" из секунд; NaN/бесконечность → "0:00" (метаданные ещё не пришли). */
export function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** «N трек/трека/треков» (RU) / «N track(s)» (EN) — вместо канцелярского
 *  «трек(ов)» (паритет 21.07). И5-веб (22.07): принимает lang, тот же приём
 *  склонения по mod10/mod100, что pluralVersions десктопа (lib/searchGrouping.ts) —
 *  ключи common.pluralTracks.{one,few,many} (@muza/app i18n). */
export function tracksLabel(n: number, lang: Lang = DEFAULT_LANG): string {
  const word =
    lang !== "ru"
      ? translate(lang, n === 1 ? "common.pluralTracks.one" : "common.pluralTracks.many")
      : (() => {
          const mod100 = n % 100;
          if (mod100 >= 11 && mod100 <= 14) return translate(lang, "common.pluralTracks.many");
          const mod10 = n % 10;
          if (mod10 === 1) return translate(lang, "common.pluralTracks.one");
          if (mod10 >= 2 && mod10 <= 4) return translate(lang, "common.pluralTracks.few");
          return translate(lang, "common.pluralTracks.many");
        })();
  return `${n} ${word}`;
}
