# Payoff reference model

The independent implementation of `docs/spikes/03-payoff-specification.md`, in exact rational
arithmetic. It shares no code, numeric representation or rounding behaviour with the contract.

```
cd spikes/payoff
python3 -m unittest -v              # 15 tests: hand-computed figures and properties
python3 vectors.py > vectors.json   # regenerate after any change to the model or the grid
```

`vectors.json` is the scenario grid the contract must reproduce to the cent (S-34): terms,
Levels per date, and the expected events with per-holder distributions. Terms in it are
illustrative, not the term sheet.

Python 3.10 or later; standard library only.
