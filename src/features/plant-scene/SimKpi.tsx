/** Плитка показателя панели симуляции: подпись caps · значение 16 (герой — 24) · подстрочник. */
interface SimKpiProps {
  k: string
  v: string
  sub?: string
  hero?: boolean
}

export function SimKpi({ k, v, sub, hero }: SimKpiProps) {
  return (
    <div className={`sim__kpi${hero ? ' sim__kpi--hero' : ''}`}>
      <div className="sim__kpi-k text-caps">{k}</div>
      <div className="sim__kpi-v num">{v}{sub && <small> {sub}</small>}</div>
    </div>
  )
}
