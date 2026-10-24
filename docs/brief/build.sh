#!/bin/zsh
# Сборка краткого изложения ВКР: Markdown (+LaTeX-формулы) → Pandoc (MathML) → Chrome headless → PDF A4.
set -e
cd "$(dirname "$0")"
pandoc brief.md -f markdown+tex_math_dollars+raw_html -t html5 --standalone --math-method=mathml \
  --css style.css --metadata title="Краткое изложение ВКР" -V pagetitle="Краткое изложение ВКР" -V lang=ru -o brief.html
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu \
  --no-pdf-header-footer --print-to-pdf="$PWD/brief.pdf" "file://$PWD/brief.html" 2>/dev/null
python3 - <<'PY'
import re
data=open('brief.pdf','rb').read()
print('pages:', len(re.findall(rb'/Type\s*/Page[^s]', data)))
PY
