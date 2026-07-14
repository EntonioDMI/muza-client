# apps/desktop/src/lib/shareCard.ts

Шеринг-карточки (Stage 7): canvas 1080×1080 → PNG (`renderShareCard`) + текст для «Скопировать текст» (`shareText`). Три варианта: трек/плейлист/Wrapped-итоги.

---

Отрисовка canvas (`drawCover`/`drawBackdrop`/`drawBranding`/`ellipsize` и
т.п.) — не менялась, только текстовые фрагменты, которые `ctx.fillText`
рисует внутри `renderShareCard`.

**i18n (2026-07-14, эпик W5, T-media):** `renderShareCard(data, accent,
lang?)` и `shareText(data, lang?)` получили опциональный `lang: Lang =
DEFAULT_LANG`. Переведены: «минут музыки»/«артист года»/«трек года»/«Мои
итоги {year}»/счётчик прослушиваний+артистов (canvas-текст,
`media.shareCard.*`), и три шаблона `shareText`
(`media.share.{track,playlist,wrapped,wrappedTopArtist}`).

**T34a (2026-07-14):** единственный потребитель — `shell/ShareDialog.tsx` —
теперь ДЕЙСТВИТЕЛЬНО прокидывает свой `lang` (из `useT()`) в оба вызова
(раньше звал без параметра → карточка/копируемый текст всегда рисовались на
EN, даже при включённом RU). `lang` добавлен в deps `useEffect`,
перестраивающего превью карточки.

Заодно `.toLocaleString("ru")` (хардкод русской локали для группировки
разрядов чисел) стал `.toLocaleString(lang === "ru" ? "ru" : "en")` — иначе
EN-текст показывал бы числа с русским разделителем разрядов.

Два внутренних technical-assertion-сообщения (`toBlob`/`makeCanvas` —
`canvas.toBlob() вернул null` / `canvas 2d недоступен`, практически
недостижимы в реальности) переведены через `translate(DEFAULT_LANG, ...)`
БЕЗ прокидывания `lang` (не стоило усложнять ради недостижимой ветки) —
`media.shareCard.errors.{canvasBlobFailed,canvas2dUnavailable}`.
