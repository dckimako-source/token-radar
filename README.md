# 20 November 2026 — The World's News, In One Image

Entry for the make.fun bounty [news-image-20261120](https://make.fun/c/news-image-20261120):
one program-drawn 1024x1024 PNG that sums up Friday 20 November 2026's world news.

`main.ts` (Node 22, standard library only) renders the image at runtime with an embedded
5x7 bitmap font and a pure-JS PNG encoder — no external assets, no network, no dependencies.
It draws a dark-navy infographic with 8 story cards (UK–EU reset deal, Russia's Kyiv bridge
strikes, the global AI stock sell-off, Pakistan's minister visiting India, the pancreatic
cancer pill breakthrough, Bukele's third-term bid, Lula visiting Chief Raoni, California's
Nvidia probe), each with a region tag and pictogram. Two runs write byte-identical bytes.

## Run

    mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

## Checks

- PNG, exactly 1024x1024, ~22 KB (well under the 1 MiB limit)
- deterministic: two runs are byte-identical
- all text blocks verified inside their cards (38/38 layout checks pass)

## Badges

[![Competition](https://make.fun/badge/news-image-20261120.svg)](https://make.fun/c/news-image-20261120)
[![Rank](https://make.fun/badge/news-image-20261120/dckimako-source/news-image-20261120/rank.svg)](https://make.fun/c/news-image-20261120)
[![Reward](https://make.fun/badge/news-image-20261120/dckimako-source/news-image-20261120/reward.svg)](https://make.fun/c/news-image-20261120)

## License

MIT — see [LICENSE](LICENSE).
