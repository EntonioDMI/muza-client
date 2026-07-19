/** Локализованные подписи ДС-компонентов (@muza/ui).
 *
 *  У TrackRow/Tile/Shelf дефолтные подписи — английские («Play», «Like»,
 *  «More», «Back»…), и вьюхи 0.1.4 их не передавали: русский интерфейс
 *  показывал английские тултипы на строках треков, плитках и стрелках полок
 *  (ревизия 2026-07-16). Один спред `{...trackRowL10n(t)}` на вызов — и все
 *  подписи идут из словаря. Новую вьюху с TrackRow/Tile/Shelf — тоже питай
 *  отсюда, а не голыми компонентами. */
import type { useT } from "../i18n";

type T = ReturnType<typeof useT>["t"];

export const trackRowL10n = (t: T) => ({
  playLabel: t("player.play"),
  pauseLabel: t("player.pause"),
  likeLabel: t("common.like"),
  moreLabel: t("common.more"),
});

export const tileL10n = (t: T) => ({
  playLabel: t("player.play"),
  pauseLabel: t("player.pause"),
});

export const shelfL10n = (t: T) => ({
  prevLabel: t("common.back"),
  nextLabel: t("common.forward"),
});
