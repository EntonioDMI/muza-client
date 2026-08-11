/** ПОД-ЭКРАН «ЧТО МЫ ХРАНИМ» — документ, а не настройка: что живёт на
 *  устройстве, что на сервере, что считается обезличенно и чего мы не делаем.
 *
 *  Приехало из apps/desktop/src/views/SettingsView.tsx (волна «настройки»,
 *  2026-08-02) без правок разметки и текстов. Тут нет ни одного переключателя
 *  нарочно: страница отвечает на вопрос «а что вы обо мне знаете», а не
 *  предлагает что-то поменять — управление лежит рядом, в «Выгрузить или
 *  удалить данные». */

import { useT } from "../../i18n";
import { paneStyle, SubHeader } from "./primitives";
import { useSettingsScreen } from "./settingsContext";

/** Блок документа: жирный заголовок + список абзацев. */
function DocBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div style={{ marginBottom: "var(--sp-4)" }}>
      <div style={{ fontSize: "var(--fs-body)", fontWeight: 400, color: "var(--text-1)", marginBottom: "var(--sp-2)" }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
        {items.map((text, i) => (
          <div key={i} style={{ fontSize: "var(--fs-body)", color: "var(--text-2)", lineHeight: 1.55 }}>
            {text}
          </div>
        ))}
      </div>
    </div>
  );
}

export function DataSub() {
  const { t } = useT();
  const { closeSub, paneClass } = useSettingsScreen();
  return (
    <div className={paneClass} style={paneStyle}>
      <SubHeader title={t("settings.data.title")} onBack={closeSub} />
      <DocBlock
        title={t("settings.data.deviceOnly.title")}
        items={[t("settings.data.deviceOnly.item1"), t("settings.data.deviceOnly.item2"), t("settings.data.deviceOnly.item3")]}
      />
      <DocBlock
        title={t("settings.data.serverStored.title")}
        items={[
          t("settings.data.serverStored.item1"),
          t("settings.data.serverStored.item2"),
          t("settings.data.serverStored.item3"),
          t("settings.data.serverStored.item4"),
        ]}
      />
      <DocBlock title={t("settings.data.anonymousStats.title")} items={[t("settings.data.anonymousStats.item1"), t("settings.data.anonymousStats.item2")]} />
      <DocBlock
        title={t("settings.data.whatWeDontDo.title")}
        items={[t("settings.data.whatWeDontDo.item1"), t("settings.data.whatWeDontDo.item2"), t("settings.data.whatWeDontDo.item3")]}
      />
      <div style={{ fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.5 }}>{t("settings.data.deletionNote")}</div>
    </div>
  );
}
