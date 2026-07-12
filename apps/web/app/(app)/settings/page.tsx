"use client";

import { useRouter } from "next/navigation";
import { Button, ChipGroup, Fader, Switch } from "@muza/ui";
import { EQ_PRESETS } from "../../../src/audioFx";
import { usePrefs } from "../../../src/prefs";
import { useSession } from "../../../src/session";

/** Настройки веба — минимальный набор (полная кастомизация — фишка десктопа):
 *  эквалайзер (та же 10-полосная модель, что в приложении), акцент ДС,
 *  сценография, панель «Сейчас играет», аккаунт. */

const EQ_LABELS = ["31", "62", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"];

const ACCENTS: { key: "blue" | "red" | "bolt"; color: string; label: string }[] = [
  { key: "blue", color: "#3b82f6", label: "Небесный (дефолт)" },
  { key: "bolt", color: "#327ad9", label: "Молния логотипа" },
  { key: "red", color: "#f76967", label: "Пламя логотипа" },
];

function Row({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--sp-4)",
        padding: "var(--sp-3) 0",
        flexWrap: "wrap",
      }}
    >
      <div style={{ minWidth: 200, flex: 1 }}>
        <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body)", fontWeight: 600, color: "var(--text-1)" }}>{title}</div>
        {hint ? (
          <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)", marginTop: 2 }}>{hint}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function GroupTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        margin: "var(--sp-5) 0 var(--sp-2)",
        fontSize: "var(--fs-caption)",
        fontWeight: 600,
        letterSpacing: "var(--ls-caps)",
        textTransform: "uppercase",
        color: "var(--text-3)",
      }}
    >
      {children}
    </h2>
  );
}

export default function SettingsPage() {
  const { prefs, set } = usePrefs();
  const { session, logout } = useSession();
  const router = useRouter();

  const applyPreset = (name: string) => {
    const bands = EQ_PRESETS[name];
    set(bands ? { eqPreset: name, eqBands: bands } : { eqPreset: name });
  };

  const setBand = (i: number, v: number) => {
    const bands = [...prefs.eqBands];
    bands[i] = Math.round(v);
    set({ eqBands: bands, eqPreset: "Свой" });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", maxWidth: 720 }}>
      <h1 className="page-title">Настройки</h1>

      <GroupTitle>Эквалайзер</GroupTitle>
      <Row title="Эквалайзер" hint="10 полос, как в приложении. Работает на играющем треке">
        <Switch checked={prefs.eqOn} onChange={(eqOn: boolean) => set({ eqOn })} label="Эквалайзер" />
      </Row>
      <div style={prefs.eqOn ? undefined : { opacity: 0.4, pointerEvents: "none" }}>
        <div className="eq-faders" style={{ margin: "var(--sp-2) 0 var(--sp-3)", padding: 0 }}>
          <ChipGroup items={[...Object.keys(EQ_PRESETS), "Свой"]} value={prefs.eqPreset} onChange={applyPreset} />
        </div>
        <div className="eq-faders">
          {prefs.eqBands.map((v, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--sp-1)" }}>
              <Fader value={v} min={-12} max={12} height={120} onChange={(nv: number) => setBand(i, nv)} ariaLabel={`Полоса ${EQ_LABELS[i]} Гц`} />
              <span style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: "var(--text-3)" }}>{EQ_LABELS[i]}</span>
            </div>
          ))}
        </div>
      </div>

      <GroupTitle>Внешний вид</GroupTitle>
      <Row title="Акцентный цвет" hint="Красит кнопки, активные строки и караоке">
        <div style={{ display: "flex", gap: "var(--sp-2)" }}>
          {ACCENTS.map((a) => (
            <button
              key={a.key}
              type="button"
              className={prefs.accent === a.key ? "swatch active" : "swatch"}
              style={{ background: a.color }}
              aria-label={a.label}
              aria-pressed={prefs.accent === a.key}
              onClick={() => set({ accent: a.key })}
            />
          ))}
        </div>
      </Row>
      <Row title="Фон из обложки" hint="Размытая обложка трека за интерфейсом — фирменный вид Muza">
        <Switch checked={prefs.bgCover} onChange={(bgCover: boolean) => set({ bgCover })} label="Фон из обложки" />
      </Row>
      <Row title="Панель «Сейчас играет»" hint="Открывается сама при старте трека (на широком экране)">
        <Switch checked={prefs.npOpen} onChange={(npOpen: boolean) => set({ npOpen })} label="Панель «Сейчас играет»" />
      </Row>

      <GroupTitle>Аккаунт</GroupTitle>
      <Row title={session?.user.username ?? ""} hint="Полные настройки аккаунта, кастомизация тем и оффлайн — в приложении для Windows">
        <Button
          variant="ghost"
          icon="log-out"
          onClick={() => {
            void logout().then(() => router.replace("/login"));
          }}
        >
          Выйти
        </Button>
      </Row>
    </div>
  );
}
