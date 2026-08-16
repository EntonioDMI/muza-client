import { useEffect, useRef, useState } from "react";
import { Button, Dialog } from "@muza/ui";
import { usePlatform } from "../platform";
import { renderShareCard, shareText, type ShareData } from "../lib/shareCard";
import { useT } from "../i18n";
import { humanError } from "@muza/api-client";

/** Шеринг-карточка (Stage 7): предпросмотр canvas-PNG + скопировать
 *  картинку/текст, сохранить файл. Всё на клиенте.
 *
 *  ⚠️ ПЕРЕЕХАЛО из apps/desktop/src/shell/ShareDialog.tsx (волна экранов
 *  веб-паритета, 2026-08-02). Два касания Tauri, которые держали диалог в
 *  приложении, ушли в розетку платформы:
 *  - выбор места и запись файла — порт saveImage (нет порта → кнопки
 *    «Сохранить PNG» нет вовсе, а не серой: в браузере места на диске не
 *    выбирают, зато «Скопировать картинку» работает в обеих программах);
 *  - глиф для канвы приезжает ссылкой glyphSrc (см. шапку lib/shareCard.ts).
 *  Строка «только в приложении» (dialogs.share.filesAppOnly) больше не
 *  нужна — вместо объяснения, почему кнопка не сработала, кнопки просто нет. */
export function ShareDialog({
  data,
  glyphSrc,
  onClose,
  onNotify,
}: {
  /** null — диалог закрыт. */
  data: ShareData | null;
  /** Ссылка на глиф Muza для рисунка карточки (у площадок она разная). */
  glyphSrc: string;
  onClose: () => void;
  onNotify: (text: string, icon?: string) => void;
}) {
  const { t, lang } = useT();
  const saveImage = usePlatform().saveImage;
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!data) {
      setBlob(null);
      setPreviewUrl(null);
      setError(null);
      return;
    }
    let alive = true;
    let url: string | null = null;
    // акцент читаем из живой темы (свой акцент/темы Stage 6 учитываются)
    const accent =
      (rootRef.current ? getComputedStyle(rootRef.current).getPropertyValue("--accent").trim() : "") || "#3b82f6";
    renderShareCard(data, accent, glyphSrc, lang)
      .then((b) => {
        if (!alive) return;
        url = URL.createObjectURL(b);
        setBlob(b);
        setPreviewUrl(url);
      })
      .catch((e) => {
        if (alive) setError(humanError(e, t("dialogs.share.renderFailed")));
      });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [data, lang, glyphSrc]);

  const copyImage = async () => {
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      onNotify(t("dialogs.share.imageCopied"), "copy");
    } catch {
      onNotify(t("dialogs.share.imageCopyFailed"), "x");
    }
  };

  const savePng = async () => {
    if (!blob || !data || !saveImage) return;
    const name =
      data.kind === "track"
        ? `muza-${data.artist}-${data.title}`
        : data.kind === "playlist"
          ? `muza-playlist-${data.name}`
          : `muza-wrapped-${data.year}`;
    try {
      // Имя-подсказка чистится ЗДЕСЬ, а не в вилке площадки: правило «как
      // назвать файл карточки» — про карточку, а не про то, кто пишет на диск.
      const saved = await saveImage.savePng(`${name.replace(/[^\p{L}\p{N} _-]+/gu, "").slice(0, 60)}.png`, blob);
      // false — человек закрыл выбор места; это не ошибка, молчим (так было и
      // раньше: `if (!path) return` до всякого тоста).
      if (saved) onNotify(t("dialogs.share.saved"), "check");
    } catch (e) {
      onNotify(humanError(e, t("dialogs.share.saveFailed")), "x");
    }
  };

  const copyText = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(shareText(data, lang));
      onNotify(t("dialogs.share.textCopied"), "copy");
    } catch {
      onNotify(t("dialogs.copyFailed"), "x");
    }
  };

  return (
    <Dialog
      open={data !== null}
      title={t("menu.catalog.share")}
      icon="share-2"
      closeLabel={t("dialogs.close")}
      onClose={onClose}
      /* Подвала здесь больше нет (13.08). Единственной кнопкой в нём было
         «Закрыть» — ровно то же, что крестик, появившийся в шапке, только на
         два сантиметра ниже и с полосой-разделителем над ним. Настоящие
         действия диалога («Скопировать картинку», «Сохранить PNG»,
         «Скопировать текст») и так живут в теле, рядом с предпросмотром. */
    >
      <div ref={rootRef} style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)", width: 380 }}>
        <div
          style={{
            width: 380,
            height: 380,
            borderRadius: "var(--r-md)",
            overflow: "hidden",
            background: "var(--surface-2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {previewUrl ? (
            <img src={previewUrl} alt={t("dialogs.share.previewAlt")} style={{ width: "100%", height: "100%", display: "block" }} />
          ) : error ? (
            <span style={{ color: "var(--danger)", fontSize: "var(--fs-caption)", padding: "var(--sp-4)", textAlign: "center" }}>
              {error}
            </span>
          ) : (
            <span style={{ color: "var(--text-3)", fontSize: "var(--fs-caption)" }}>{t("dialogs.share.rendering")}</span>
          )}
        </div>
        <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap" }}>
          <Button variant="primary" icon="copy" disabled={!blob} onClick={() => void copyImage()} style={{ flex: 1 }}>
            {t("dialogs.share.copyImage")}
          </Button>
          {/* Нет порта — нет кнопки (правило розетки): в браузере место на
              диске не выбирают, и серой заглушки тут быть не должно. */}
          {saveImage ? (
            <Button variant="secondary" icon="download" disabled={!blob} onClick={() => void savePng()} style={{ flex: 1 }}>
              {t("dialogs.share.savePng")}
            </Button>
          ) : null}
          <Button variant="secondary" icon="type" onClick={() => void copyText()} style={{ flex: 1 }}>
            {t("dialogs.share.textButton")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
