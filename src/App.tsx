import PlantScene from './features/plant-scene'

/**
 * Корневой экран MAOS. На текущем срезе — 3D-схема предприятия
 * («цифровой двойник»). Дальше сюда добавятся доки-панели оболочки
 * (рельса навигации, инспектор, статус-бар) по дизайн-системе Palantir.
 */
export default function App() {
  return <PlantScene />
}
