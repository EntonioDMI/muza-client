import { Button, Icon } from "@muza/ui";

/** Временная заглушка Stage 1 — проверка, что дизайн-система подключена.
 *  Каркас окна (сайдбар/контент/сейчас-играет/плеер-бар) собирается следующим шагом. */
export function App() {
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--sp-4)",
      }}
    >
      <Icon name="zap" size={48} color="var(--accent)" />
      <h1 style={{ fontFamily: "var(--font-display)", margin: 0 }}>Muza</h1>
      <Button variant="primary" icon="play">
        Дизайн-система работает
      </Button>
    </div>
  );
}
