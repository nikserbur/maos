"""Верхняя граница запаса реактивного L0 (A2): «ясновидящий» выбор лучшего статика ПО КАЖДОМУ сценарию.

    rl/.venv/bin/python -m rl.eval.expost_bound     # → rl/results/a2_expost_bound.json

Для каждого экземпляра на 60 отложенных сценариях (seed holdout+7, генератор базы с событиями) берётся
максимум прибыли по 8 статикам и «чемпион + ускорить срочный»; ΔCVaR₀.₁ этого максимума к чемпиону —
недостижимая сверху граница того, что даст переключение между этими действиями (не политика!).
"""
import json, numpy as np, sys
from concurrent.futures import ProcessPoolExecutor
from rl.train.common import load_instances, maos_instance_names, cvar_lower
from rl.env.scenarios import ScenarioSet, STRESSES, HOLDOUT_SEED
from rl.eval.reactive import eval_rows, load_cp_keys, rs_policy, oracle
ch=json.load(open('rl/results/l0rule_champions.json')); cp=load_cp_keys()
def work(name):
    inst=load_instances([name])[0]; sc=ScenarioSet(60, HOLDOUT_SEED+7, stress=STRESSES['base']); idx=list(range(60))
    P={}
    for a in range(8):
        if a==7 and name not in cp: continue
        P[a]=np.array([r['profit'] for r in eval_rows(inst, ('static',a), sc, idx, 50000, cp.get(name))])
    P['exp']=np.array([r['profit'] for r in eval_rows(inst, ('rs', rs_policy(ch, cp, fn=oracle('always_expedite'))), sc, idx, 50000)])
    M=np.max(np.stack(list(P.values())),0); c=P[ch[name]['champion_a']]
    s=abs(c.mean())
    return name, (cvar_lower(M,0.1)-cvar_lower(c,0.1))/s, (M.mean()-c.mean())/s, (cvar_lower(P['exp'],0.1)-cvar_lower(c,0.1))/s
if __name__=='__main__':
  out={}
  with ProcessPoolExecutor(4) as ex:
    for name, dc, dm, de in ex.map(work, maos_instance_names()):
        print(name, 'ex-post bound ΔCVaR %.5f  Δmean %.5f   expedite ΔCVaR %.5f' % (dc, dm, de)); out[name]={'bound_d_cvar':dc,'bound_d_mean':dm,'expedite_d_cvar':de}
    json.dump(out, open('rl/results/a2_expost_bound.json','w'), indent=1)
