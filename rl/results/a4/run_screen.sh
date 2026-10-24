#!/bin/zsh
# Поправка П3: отбор варианта по сиду 1 (C, A, B), затем сиды 2–3 выбранного варианта (отдельный запуск).
cd /Users/nburakov/Codes/maos
rl/.venv/bin/python -m rl.train.train_l4 --variant C --seeds 1 --max-decisions 6000000 --min-decisions 2000000 --eval-every 500000 --workers 7 --max-minutes 150 > rl/results/a4/train_l4C_seed1.log 2>&1
rl/.venv/bin/python -m rl.train.train_l4 --variant A --seeds 1 --workers 7 --max-minutes 120 > rl/results/a4/train_l4A_seed1.log 2>&1
rl/.venv/bin/python -m rl.train.train_l4 --variant B --seeds 1 --workers 7 --max-minutes 120 > rl/results/a4/train_l4B_seed1.log 2>&1
