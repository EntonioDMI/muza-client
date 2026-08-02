/** ВИЛКА ПРИЛОЖЕНИЯ (Э2 веб-паритета, 2026-08-02): что умеет площадка Tauri.
 *  Розетка и правила — packages/app/src/platform/types.ts.
 *
 *  Файл СКЛЕИВАЕТ, а не реализует: вся механика остаётся там, где была
 *  (lib/dragOut.ts, lib/system.ts), здесь только сопоставление «порт → уже
 *  существующая функция». Поэтому у приложения нулевой дифф поведения:
 *  сегодня вью зовут те же функции напрямую, а вилка — параллельный вход,
 *  которым зоны будут пользоваться по мере переезда файлов в @muza/app.
 *
 *  ⚠️ Умения проверяются НА СТАРТЕ, один раз (createDesktopPlatform зовётся из
 *  App.tsx в useMemo). Это важно для запуска `pnpm dev` в ОБЫЧНОМ браузере
 *  (без Tauri): там выноса файла нет — и порта тоже нет, общий код увидит
 *  ровно то же, что увидит веб, а не падение при первом же перетаскивании. */

import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { PlatformAdapter } from "@muza/app/platform";
import { dragOutAvailable, exportCachedTrack, startTrackFileDrag } from "../lib/dragOut";
import {
  loadServerIds,
  localAvailable,
  localForget,
  localList,
  localPickAndScan,
  localResolve,
  localScanPaths,
  saveServerId,
} from "../lib/localFiles";
import { cacheClear, cacheRemove, cacheStats, engineAvailable, engineStage0Status } from "../lib/engine";
import { savePngFile } from "../lib/saveImage";
import { autostartEnabled, openExternal, syncAutostart, trayConfigure } from "../lib/system";
import { invalidateCachedSources } from "../player/sourcesCache";
// ── умения экрана настроек ──
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { save } from "@tauri-apps/plugin-dialog";
import { checkForUpdate, updaterAvailable } from "../lib/updater";
import { rpcAvailable } from "../lib/discord";
import { miniHide, miniShow } from "../lib/miniBridge";
import { deviceAccessDenied, listInputDevices, listOutputDevices } from "../player/outputDevices";
import { getStartLog, subscribeStartLog } from "../player/startTelemetry";
import {
  cancelInstall,
  finalizeInstall,
  listInstalled,
  pickAndStagePlugin,
  setPluginEnabled,
  stagePluginFromMarket,
  uninstallPlugin,
  type StagedPlugin,
} from "../plugins/install";
import { fullAccessHost } from "../plugins/fullAccessHost";

export function createDesktopPlatform(): PlatformAdapter {
  return {
    // Поля НЕТ, когда возможности нет (окно открыли в браузере) — общий код
    // не спрашивает «ты десктоп?», он спрашивает «умеешь вынести файл?».
    ...(dragOutAvailable()
      ? {
          dragOut: {
            exportTrackFile: ({ id, artist, title }) => exportCachedTrack(id, artist, title),
            startFileDrag: (path) => startTrackFileDrag(path),
          },
        }
      : {}),
    // Файлы с диска (вкладка «Локальные» медиатеки). Того же условия, что у
    // выноса файла: в обычном браузере Tauri-команд нет — порта нет, и вкладка
    // не появляется вовсе (localAvailable() = isTauri(), ровно та проверка,
    // которой экран пользовался до переезда в @muza/app).
    ...(localAvailable()
      ? {
          localFiles: {
            list: localList,
            // без языка — как звал экран до переезда: подписи системного
            // окна выбора файлов остаются английскими (менять здесь = менять
            // поведение приложения, это отдельная правка)
            pickAndScan: (kind: "files" | "folder") => localPickAndScan(kind),
            scanPaths: localScanPaths,
            resolvePath: localResolve,
            forget: localForget,
            serverIds: loadServerIds,
            rememberServerId: saveServerId,
            reveal: (path: string) => revealItemInDir(path),
          },
        }
      : {}),
    system: {
      openExternal,
      // Запуск вместе с системой и значок у часов — только у настоящего окна
      // программы: в обычном браузере (pnpm dev без Tauri) этих умений нет, и
      // соответствующих рядов настроек там не должно появляться вовсе.
      ...(dragOutAvailable() ? { setAutostart: syncAutostart, autostartEnabled, configureTray: trayConfigure } : {}),
    },
    // Сохранить картинку файлом («Поделиться» → «Сохранить PNG»). Условие то
    // же, что у выноса файла: без Tauri системного окна «куда сохранить» нет,
    // и кнопки в диалоге не появляется (раньше на её месте был тост «только в
    // приложении» — теперь объяснять нечего, кнопки просто нет).
    ...(dragOutAvailable() ? { saveImage: { savePng: savePngFile } } : {}),
    // Забыть подготовленное для трека — ОДИН порт на две прежние строки
    // диалога «Версии и источники»: файл трека на устройстве и разобранные
    // источники в памяти плеера протухают по одной причине (сменилась
    // версия) и всегда вместе. cacheRemove сам молчит вне Tauri, поэтому
    // условия здесь нет: в браузерном dev-окне вызов ничего не делает —
    // ровно как делал до переезда диалога.
    preparedTracks: {
      forget: async (trackId: string) => {
        await cacheRemove(trackId);
        invalidateCachedSources(trackId);
      },
    },
    // ── Умения экрана настроек (волна «настройки», 2026-08-02) ───────
    // Все девять портов ниже условны по одной причине: без Tauri их команд не
    // существует. Общий экран настроек спрашивает наличие поля и просто НЕ
    // рисует соответствующие ряды — ни серых, ни с подписью «только в
    // приложении»: их там нет, как нет и в поиске по настройкам.
    ...(engineAvailable()
      ? {
          // Место под подготовленные файлы: цифры + очистка (закреплённое
          // переживает очистку — это забота движка, не экрана).
          storedMedia: {
            stats: async () => {
              const s = await cacheStats();
              return { bytes: s.bytes, files: s.files, pinnedBytes: s.pinnedBytes, pinnedFiles: s.pinnedFiles };
            },
            clear: cacheClear,
          },
          // Журнал «почему включалось долго»: предохранители движка + кольцо
          // последних включений из плеера.
          diagnostics: {
            health: engineStage0Status,
            startLog: getStartLog,
            subscribeStartLog,
          },
          // Готова ли связка с Discord (идентификатор зашит в сборку моста).
          discordStatus: { configured: rpcAvailable },
          // Расширения. Экран согласия, права и стейджинг — уже существующий
          // рантайм; здесь только сопоставление «порт → готовая функция».
          plugins: {
            list: listInstalled,
            pickFile: () => pickAndStagePlugin(),
            stageFromMarket: (payload) => stagePluginFromMarket(payload),
            // Приведение: общий код держит подготовленное расширение
            // НЕПРОЗРАЧНОЙ ручкой (ему видно только manifest) и возвращает её
            // сюда как есть — это та же самая ручка, что выдал стейджинг.
            finalize: (staged, granted) => finalizeInstall(staged as StagedPlugin, granted as string[]),
            cancel: (staged) => cancelInstall(staged as StagedPlugin),
            setEnabled: setPluginEnabled,
            remove: uninstallPlugin,
            errors: () => fullAccessHost.getErrors(),
            clearErrors: () => fullAccessHost.clearErrors(),
            subscribeErrors: (cb: () => void) => fullAccessHost.subscribe(cb),
            errorsVersion: () => fullAccessHost.runtimeVersion(),
            restart: relaunch,
          },
          // Маленькое окно плеера поверх других окон.
          miniPlayer: { show: miniShow, hide: miniHide },
          // Сведения о самой программе: единственный источник правды по
          // версии — сборка, а не число в коде экрана (оно однажды протухло).
          appInfo: { version: getVersion },
          // «Куда сохранить» для выгрузки данных. Содержимое юникодное,
          // поэтому в base64 переводим через TextEncoder: голый btoa падает на
          // кириллице.
          saveDataFile: {
            saveJson: async (suggestedName: string, json: string) => {
              const path = await save({ defaultPath: suggestedName, filters: [{ name: "JSON", extensions: ["json"] }] });
              if (!path) return false;
              const bytes = new TextEncoder().encode(json);
              let binary = "";
              for (let i = 0; i < bytes.length; i += 0x8000) {
                binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
              }
              await invoke("share_save_file", { path, dataBase64: btoa(binary) });
              return true;
            },
          },
        }
      : {}),
    // Обновление программы изнутри неё самой — своё условие: обновляется
    // установленная сборка, а не окно разработки.
    ...(updaterAvailable() ? { updates: { check: checkForUpdate } } : {}),
    // Выбор устройств вывода — тоже своё: перечисление идёт через сам
    // браузерный движок и в окне разработки работает так же честно.
    audioDevices: {
      listOutputs: listOutputDevices,
      listInputs: listInputDevices,
      accessDenied: deviceAccessDenied,
    },
    // offline / window появятся здесь, когда соответствующие экраны поедут в
    // @muza/app: порт заводится ВМЕСТЕ с первым потребителем, иначе это
    // мёртвый код, который никто не проверял.
  };
}
