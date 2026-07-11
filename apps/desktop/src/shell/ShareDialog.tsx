import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { Button, Dialog } from "@muza/ui";
import { renderShareCard, shareText, type ShareData } from "../lib/shareCard";

/** Шеринг-карточка (Stage 7): предпросмотр canvas-PNG + скопировать
 *  картинку/текст, сохранить файл. Всё на клиенте. */
export function ShareDialog({
  data,
  onClose,
  onNotify,
}: {
  /** null — диалог закрыт. */
  data: ShareData | null;
  onClose: () => void;
  onNotify: (text: string, icon?: string) => void;
}) {
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
    renderShareCard(data, accent)
      .then((b) => {
        if (!alive) return;
        url = URL.createObjectURL(b);
        setBlob(b);
        setPreviewUrl(url);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Не удалось нарисовать карточку");
      });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [data]);

  const copyImage = async () => {
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      onNotify("Картинка в буфере — вставляй в чат", "copy");
    } catch {
      onNotify("Буфер не принял картинку — сохрани файлом", "x");
    }
  };

  const savePng = async () => {
    if (!blob || !data) return;
    if (!isTauri()) {
      onNotify("Сохранение файлов — в приложении Muza", "x");
      return;
    }
    const name =
      data.kind === "track"
        ? `muza-${data.artist}-${data.title}`
        : data.kind === "playlist"
          ? `muza-playlist-${data.name}`
          : `muza-wrapped-${data.year}`;
    const path = await save({
      defaultPath: `${name.replace(/[^\p{L}\p{N} _-]+/gu, "").slice(0, 60)}.png`,
      filters: [{ name: "PNG", extensions: ["png"] }],
    }).catch(() => null);
    if (!path) return;
    try {
      const buf = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < buf.length; i += CHUNK) {
        binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
      }
      await invoke("share_save_file", { path, dataBase64: btoa(binary) });
      onNotify("Карточка сохранена", "check");
    } catch (e) {
      onNotify(e instanceof Error ? e.message : "Не удалось сохранить", "x");
    }
  };

  const copyText = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(shareText(data));
      onNotify("Текст скопирован", "copy");
    } catch {
      onNotify("Не удалось скопировать", "x");
    }
  };

  return (
    <Dialog
      open={data !== null}
      title="Поделиться"
      onClose={onClose}
      actions={
        <Button variant="ghost" onClick={onClose}>
          Закрыть
        </Button>
      }
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
            <img src={previewUrl} alt="Карточка для шеринга" style={{ width: "100%", height: "100%", display: "block" }} />
          ) : error ? (
            <span style={{ color: "var(--danger)", fontSize: "var(--fs-caption)", padding: "var(--sp-4)", textAlign: "center" }}>
              {error}
            </span>
          ) : (
            <span style={{ color: "var(--text-3)", fontSize: "var(--fs-caption)" }}>Рисуем карточку…</span>
          )}
        </div>
        <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap" }}>
          <Button variant="primary" icon="copy" disabled={!blob} onClick={() => void copyImage()} style={{ flex: 1 }}>
            Скопировать
          </Button>
          <Button variant="secondary" icon="download" disabled={!blob} onClick={() => void savePng()} style={{ flex: 1 }}>
            Сохранить PNG
          </Button>
          <Button variant="secondary" icon="type" onClick={() => void copyText()} style={{ flex: 1 }}>
            Текст
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
