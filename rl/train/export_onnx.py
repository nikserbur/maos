"""Экспорт политики L0/L2 (MaskablePPO) в ONNX для правила «RL» в C++ (RlRule.cpp, onnxruntime).

    rl/.venv/bin/python -m rl.train.export_onnx --ckpt rl/train/checkpoints/l0_seed1_best.zip --out rl/results/l0_policy.onnx

Граф: obs[B, D] → logits[B, A]; маска применяется снаружи (C++: argmax по допустимым). Рядом пишется
<out>.json: размеры, SHA256, источник, версия признаков. Проверка: logits onnxruntime == torch,
маскированный argmax == model.predict(deterministic).
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import date
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from sb3_contrib import MaskablePPO

FEATURE_VERSION = "l0-v1 (kCandFeats=12, kMachFeats=4, kPoolFeats=4, kGlobFeats=6; L2: kOrderFeats=8, kFinFeats=12)"


class LogitsNet(torch.nn.Module):
    def __init__(self, policy):
        super().__init__()
        self.policy = policy

    def forward(self, obs: torch.Tensor) -> torch.Tensor:
        feats = self.policy.extract_features(obs, self.policy.pi_features_extractor)
        latent = self.policy.mlp_extractor.forward_actor(feats)
        return self.policy.action_net(latent)


def export(ckpt: Path, out: Path, level: str) -> dict:
    model = MaskablePPO.load(ckpt, device="cpu")
    net = LogitsNet(model.policy).eval()
    d = int(np.prod(model.observation_space.shape)); a = int(model.action_space.n)
    dummy = torch.zeros(1, d, dtype=torch.float32)
    torch.onnx.export(net, dummy, str(out), input_names=["obs"], output_names=["logits"],
                      dynamic_axes={"obs": {0: "batch"}, "logits": {0: "batch"}}, opset_version=17, dynamo=False)
    # Проверка.
    sess = ort.InferenceSession(str(out), providers=["CPUExecutionProvider"])
    rng = np.random.default_rng(0)
    obs = rng.normal(size=(32, d)).astype(np.float32)
    mask = rng.random((32, a)) < 0.5
    mask[:, 0] = True
    lg = sess.run(["logits"], {"obs": obs})[0]
    with torch.no_grad():
        lt = net(torch.from_numpy(obs)).numpy()
    assert np.allclose(lg, lt, atol=1e-4), "ONNX ≠ torch"
    act_onnx = np.where(mask, lg, -np.inf).argmax(1)
    act_sb3, _ = model.predict(obs, action_masks=mask, deterministic=True)
    assert np.array_equal(act_onnx, np.asarray(act_sb3)), "маскированный argmax ≠ predict"
    sha = hashlib.sha256(out.read_bytes()).hexdigest()
    meta = {"level": level, "obs_size": d, "act_size": a, "sha256": sha, "source_ckpt": str(ckpt), "exported": str(date.today()),
            "feature_version": FEATURE_VERSION, "bytes": out.stat().st_size, "regenerate": f"python -m rl.train.export_onnx --ckpt {ckpt} --out {out} --level {level}"}
    out.with_suffix(".json").write_text(json.dumps(meta, indent=1, ensure_ascii=False), encoding="utf-8")
    return meta


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--level", type=str, default="L0")
    a = ap.parse_args()
    print(json.dumps(export(a.ckpt, a.out, a.level), indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
