# Battery model validation benchmark

Status: proposed; target-job mapping pending. Assumes modeling/time-series familiarity.
This can extend an existing battery research project rather than duplicating it.
Budget: 18-28 hours. Focus on evaluation evidence, not adding CNN/LSTM complexity.

## Problem

Compare battery health predictions across future cycles and unseen cells. Begin with
a deterministic synthetic dataset to test the evaluation machinery. Before scientific
claims, choose an accessible real dataset, verify license and record its provenance.
Synthetic results demonstrate software behavior only.

## Milestones

1. **Protocol (4-6h):** define target, observation window, prediction horizon and
   available-at-prediction features. Document two separate questions: future cycles of
   known cells and generalization to unseen cells. Freeze train/validation/test rules.
2. **Baselines (4-6h):** implement a constant/persistence baseline and one simple learned
   model. Fit transforms on training data only and record the dataset/split hashes.
3. **Evaluation (6-9h):** implement group-aware temporal splits; report cell-level and
   aggregate errors, uncertainty intervals with a justified resampling unit, and error
   slices by cell/age regime. Do not randomly resample dependent cycles as independent.
4. **Challenge (4-7h):** deliberately inject one future-derived feature and demonstrate
   why it invalidates the result. Remove it and publish the final comparison and limits.

## Acceptance checks

- Unseen-cell test shares no cell IDs with training or model selection.
- Future-cycle evaluation never trains on cycles later than evaluated observations.
- Changing held-out test values cannot alter fitted preprocessing or chosen parameters.
- Splits, hyperparameters, environment and metrics are reproducible from a clean clone.
- All model selection happens before inspecting the final test results.

## What you should explain

What exactly generalizes: time, cell or chemistry? Why can random splitting overstate
performance? Which uncertainty assumptions hold? Why might cell-level weighting differ
from cycle-level weighting? What additional evidence would real deployment require?

## Official reading

- [scikit-learn cross-validation guidance](https://scikit-learn.org/stable/modules/cross_validation.html)

Group splitting and time splitting each solve different problems; design their
combination for the data. A project is not proof of production battery SOH accuracy.
