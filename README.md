# GTA VI Trophy Rarity Forecast

[![Forecast](https://make.fun/badge/gta6-trophy-rarity-forecast-01.svg)](https://make.fun/c/gta6-trophy-rarity-forecast-01)
[![Source](https://make.fun/badge/gta6-trophy-rarity-forecast-01/dckimako-source/token-radar/rank.svg)](https://make.fun/c/gta6-trophy-rarity-forecast-01)
[![Reward](https://make.fun/badge/gta6-trophy-rarity-forecast-01/dckimako-source/token-radar/reward.svg)](https://make.fun/c/gta6-trophy-rarity-forecast-01)

A make.fun bounty entry that forecasts, for every Grand Theft Auto VI PlayStation 5 trophy, its Exophase earn rate one week after launch, from recorded reads of the trophy page. See the [campaign](https://make.fun/c/gta6-trophy-rarity-forecast-01).

## Approach

Each trophy's earn rate is modelled on the logit scale. We fit a local trend to the recorded page reads and project it forward with a damped growth factor, `1/(1+0.75*d)`, so rates bend toward saturation instead of extrapolating linearly over the first week. The predictive spread combines a random-walk term, trend-fit residual uncertainty and an irreducible floor, then maps to calibrated pinball quantiles (5/25/50/75/95) so each interval is scored consistently across trophies.

## Run

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out python3 main.py
```
