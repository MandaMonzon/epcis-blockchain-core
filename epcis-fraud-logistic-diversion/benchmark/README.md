# Caliper benchmark

`config.template.yaml` runs, in order:

1. three submit rounds (Object, Aggregation, Transaction events, fixed-rate);
2. three read rounds: `getEvent`, `getProductState`, `getAuditSummary`;
3. a `linear-rate` stress round that ramps the submit rate to find the MVCC/timeout breaking point;
4. a docker resource monitor (both peers and the orderer).

Read rounds use events committed by the submit rounds of the same run (`output/<run_id>/committed.jsonl`).

Tunable through environment variables before `generate-config.sh`: `RUN_ID`, `READ_TX`, `READ_TPS`, `SUMMARY_TX`,
`LIN_TX`, `LIN_START`, `LIN_END`. The defaults are placeholders, not tuned values.

Each run writes to `output/<run_id>/` and never overwrites earlier runs. A transaction outcome is `committed`,
`rejected` (Class A rule, by design) or `error` (system failure: MVCC, endorsement, timeout).
Summarize with `python3 summarize_run.py output/<run_id>`.

The test-network orderer is etcdraft with a single node, `BatchTimeout 2s` and `MaxMessageCount 10`. At low load the
batch timeout sets a latency floor of about 2 s. Changing these values (task 1.4) is a separate run variant.
