interface StatusBarProps {
  screen: string
}

/** Нижний статус-бар: версия, режим работы, активный экран. */
export function StatusBar({ screen }: StatusBarProps) {
  return (
    <footer className="statusbar mono">
      <span>MAOS v0.17.0</span>
      <span className="statusbar__sep">·</span>
      <span>Локально</span>
      <span className="statusbar__sep">·</span>
      <span>Демо-данные</span>
      <span className="statusbar__spacer" />
      <span>Экран: {screen}</span>
    </footer>
  )
}
