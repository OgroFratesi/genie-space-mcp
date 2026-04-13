// ── Genie Data Context ────────────────────────────────────────────────────────
// Edit this file to guide Claude's question generation in pipeline 1.
// Changes here take effect on the next /generate-questions run.

export const AVAILABLE_METRICS = `
General stats space:
- Goals, assists, shots on target, shots total, shots off target
- Yellow cards, red cards, fouls committed, fouls won
- Pass count, pass accuracy (%), key passes
- Corners, offsides, possession %
- Player positions, ages, nationalities
- Team standings, points, wins, draws, losses, goal difference
- Season aggregations and per-game averages

Match events space:
- Shot timing (minute of shot)
- Game state at time of shot (score at that moment)
- Shot location / zone on pitch
- Shot outcome (goal, saved, blocked, off target)
- Build-up sequence leading to shot

Pass events space:
- Individual pass accuracy %
- Pass zones (defensive third, middle third, final third)
- Cross count and cross accuracy
- Pass flow between players or zones
`;

export const AVOID_METRICS = `
Do NOT ask about any of the following — they are not in the dataset:
- xG (expected goals) or any expected metric (xA, xGOT, etc.)
- Progressive passes or progressive carries
- PPDA or any pressing intensity metric
- Shot quality scores or "unsaveable" classifications
- Player tracking / positional data
- Heatmaps or touch maps
- Carry distance or carry metrics
`;

export const QUESTION_GUIDES = `
Good question angles that tend to produce interesting tweets:

- Counterintuitive gaps: a player or team performing far above/below expectation on a simple metric
- Negative streaks: players with 0 goals/assists over N games since a specific date
- Ranking surprises: who ranks #1 in an unexpected category (e.g. a defender top in key passes)
- Game-state asymmetry: stats that differ dramatically when a team is winning vs losing
- Record or milestone: first time something has happened, or N consecutive games with a stat
- Outlier: one player/team doing something no one else does (or almost no one)
- Comparison: two or three players/teams on the same specific metric, with a notable gap
- Cross-era: how does a current number compare to typical historical output

Keep questions specific and answerable with the available metrics above.
Avoid vague questions like "who is the best midfielder?" — prefer narrow, data-driven ones.
`;
