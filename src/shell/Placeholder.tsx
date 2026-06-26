interface PlaceholderProps {
  title: string
  caption: string
}

/** Заглушка экрана, который ещё не реализован (этапы из docs/ROADMAP.md). */
export function Placeholder({ title, caption }: PlaceholderProps) {
  return (
    <div className="placeholder">
      <div className="placeholder__badge">В разработке</div>
      <h1 className="placeholder__title">{title}</h1>
      <p className="placeholder__caption">{caption}</p>
      <p className="placeholder__hint mono">См. docs/ROADMAP.md</p>
    </div>
  )
}
