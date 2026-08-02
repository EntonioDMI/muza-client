/** Сохранение картинки файлом: системное окно «куда сохранить» + запись на
 *  диск через Rust-команду share_save_file.
 *
 *  Заведено волной «экраны» (2026-08-02): раньше эти двадцать строк жили
 *  прямо в диалоге «Поделиться», и из-за них диалог не мог переехать в общий
 *  пакет — @tauri-apps в браузере не собирается. Теперь это ВИЛКА порта
 *  saveImage (packages/app/src/platform/types.ts), а диалог знает только
 *  «умеет площадка сохранять картинку или нет».
 *
 *  Поведение оставлено ровно прежним, включая base64 кусками по 32 КБ:
 *  String.fromCharCode(...массив) на целом файле переполняет стек аргументов
 *  на картинке в мегабайт. */

import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

/** Спросить место и записать PNG. false — человек закрыл выбор места
 *  (не ошибка, сообщать не о чем). */
export async function savePngFile(suggestedName: string, png: Blob): Promise<boolean> {
  const path = await save({
    defaultPath: suggestedName,
    filters: [{ name: "PNG", extensions: ["png"] }],
  }).catch(() => null);
  if (!path) return false;
  const buf = new Uint8Array(await png.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  await invoke("share_save_file", { path, dataBase64: btoa(binary) });
  return true;
}
