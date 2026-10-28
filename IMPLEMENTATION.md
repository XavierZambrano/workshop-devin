# Implementation report

## What was built

A working PoC covering both spec acceptance scenarios end-to-end:

- **Setup**: name, format (SE/Swiss), seeding mode (random / registration /
  manual ordering), Swiss round override with recommended default, player
  add/edit/remove/reorder with a `N / 32` counter and a 32-player cap.
- **Single Elimination**: next-power-of-two bracket (2–32 players), top-seed
  byes, full bracket pre-generated with wired advancement, walkovers on
  drop/DQ, champion detection.
- **Swiss**: score-group pairing with rematch avoidance, group floating,
  single-bye handling for odd fields, repeat-bye avoidance, dropped/DQ
  exclusion, planned-round completion.
- **Results**: large touch-friendly entry buttons, corrections with an
  explicit warning when later state is affected; SE corrections void and
  reopen dependent matches (audited), Swiss corrections update standings only.
- **Standings**: points, record, Win%, Opp%, byes, warnings, status —
  all derived, updated immediately on any result change.
- **Discipline**: warnings and penalties with reasons/notes/revoke, drops and
  disqualifications with reason + round recorded.
- **Audit**: append-only event log rendered in the History view.
- **Persistence**: Dexie/IndexedDB autosave on every mutation, JSON
  export/import with validation, reload-safe.
- **UI**: Tournament / Round / Standings / Bracket / Players / History nav;
  bracket shown only for single elimination.

## Architectural decisions

- **Engine purity**: `packages/tournament-engine` has zero UI dependencies.
  All operations are pure `Tournament -> Tournament` functions that clone the
  input, mutate a draft, and append audit events. This keeps the rules
  trivially testable and portable (React Native, server, etc.).
- **Format abstraction**: `TournamentFormatEngine` (start / nextRound /
  afterResultRecorded / afterResultCorrected / afterPlayerRemoved /
  isComplete) isolates format rules. Shared concerns — event log, status
  transitions, warnings, drops — live in `operations.ts` once.
- **Derived statistics**: standings/Opp% are computed from match history on
  every render/call. No cached aggregates to invalidate.
- **Determinism**: a seeded mulberry32 PRNG drives random seeding; Swiss
  pairing is deterministic given the same state.
- **Zustand + Dexie**: a single store applies engine ops and writes through to
  IndexedDB. Components stay thin.

## Deviations from the spec

- `matchWinPct`/`Opp%` exclude byes from the *denominator* (MTG convention):
  a bye grants points but is not a "played" match. Documented in README.
- `PENALTY.DISQUALIFICATION` records the sanction; actual removal requires the
  explicit **Disqualify** action — the UI says so in the penalty dialog. This
  keeps "the resulting state change explicit and auditable" per spec.
- SE draws/double-losses produce no winner; the downstream slot resolves as an
  automatic bye (or voids if no players can reach it) so the bracket can never
  wedge.
- Corrections are permitted on completed tournaments (the SE final case):
  the champion is retracted and the dependent chain voided for re-entry.
- Only one "active" tournament is surfaced; older ones stay in IndexedDB but
  there is no picker UI yet (noted as a next step).

## Test coverage

47 tests across 4 files: bracket sizing (2/4/8/13/17/32), seed order, bye
assignment and top-seed distribution, advancement, champion, correction
cascade, drop/DQ walkovers; Swiss round-1 split, score-group pairing, rematch
and repeat-bye avoidance, drops/DQ exclusion, round gating, planned-round
cap, Opp%/Win%/points/draw/double-loss math, standings determinism and
head-to-head, serialization round-trip and malformed-input rejection, plus two
end-to-end spec-scenario tests that also emit `sample-data/demo-*.json`.

## Remaining PoC limitations

See "Known limitations" in the README — chiefly match-level results only, a
minimal head-to-head application, and no multi-tournament picker.

## Suggested next steps

Game-level results → Swiss + Top Cut → double elimination / round robin
engines → tournament picker → optional backend behind the same engine package.
