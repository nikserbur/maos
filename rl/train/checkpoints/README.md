# Чекпойнты волны A (MaskablePPO, sb3-contrib 2.9.0)

`l0_seed{1,2,3}_best.zip` — L0 (лучший по валидации seed 777 × 4 сценария), `l2_edd_seed{1,2,3}_best.zip` — L2 поверх EDD.
Каждый ≈ 1,1 МБ (< 5 МБ) (SHA256 — `SHA256SUMS`). Регенерация:

```bash
rl/.venv/bin/python -m rl.train.train_l0 --seeds 1 2 3 --steps 40000 80000 80000 --eval-every 20000
rl/.venv/bin/python -m rl.train.train_l2 --seeds 1 2 3 --steps 30000 --eval-every 6000 --l0 rule:EDD
```
(PPO на CPU не детерминирован побитово между сборками torch; кривые — в `rl/results/train_*.json`.)
