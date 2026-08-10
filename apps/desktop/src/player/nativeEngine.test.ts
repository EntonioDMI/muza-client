/** Разбор адресов гибридного движка.
 *
 *  Эти две функции решают, каким путём пойдёт трек: нативным (звук из процесса
 *  приложения, виден «захвату аудио приложения») или прежним, через WebView2.
 *  Ошибка здесь не падает и не логируется — трек просто тихо уходит не туда, и
 *  заметить это можно только в OBS. Поэтому проверяем разбор отдельно. */
import { describe, expect, it } from "vitest";
import { assetUrlToPath, streamKeyFromUrl } from "./nativeEngine";

describe("assetUrlToPath", () => {
  it("достаёт путь из адреса, которым Tauri отдаёт файл кэша", () => {
    const url = "http://asset.localhost/C%3A%5Ccache%5C889614ea%5C104.webm";
    expect(assetUrlToPath(url)).toBe("C:\\cache\\889614ea\\104.webm");
  });

  it("понимает кириллицу в пути", () => {
    const url =
      "http://asset.localhost/C%3A%5C%D0%9C%D1%83%D0%B7%D0%B0%5C%D1%82%D1%80%D0%B5%D0%BA.mp3";
    expect(assetUrlToPath(url)).toBe("C:\\Муза\\трек.mp3");
  });

  it("возвращает null для потока: файла целиком ещё нет", () => {
    expect(assetUrlToPath("http://muza-stream.localhost/youtube/abc123")).toBeNull();
  });

  it("возвращает null для чужого источника и для мусора", () => {
    expect(assetUrlToPath("https://cdn.example.com/track.mp3")).toBeNull();
    expect(assetUrlToPath("не адрес вовсе")).toBeNull();
  });
});

describe("streamKeyFromUrl", () => {
  it("достаёт источник и идентификатор трека", () => {
    expect(streamKeyFromUrl("http://muza-stream.localhost/youtube/abc123")).toEqual({
      ns: "youtube",
      id: "abc123",
    });
  });

  it("раскодирует идентификатор: у SoundCloud в нём встречаются двоеточия", () => {
    const url = "http://muza-stream.localhost/soundcloud/tracks%3A123";
    expect(streamKeyFromUrl(url)).toEqual({ ns: "soundcloud", id: "tracks:123" });
  });

  it("возвращает null, если части адреса не хватает", () => {
    expect(streamKeyFromUrl("http://muza-stream.localhost/youtube")).toBeNull();
    expect(streamKeyFromUrl("http://muza-stream.localhost/")).toBeNull();
  });

  it("возвращает null для файла кэша: он играет прямым чтением, а не потоком", () => {
    expect(streamKeyFromUrl("http://asset.localhost/C%3A%5Ccache%5C1.mp3")).toBeNull();
  });
});
