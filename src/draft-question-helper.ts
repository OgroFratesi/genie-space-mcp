// ── Genie Data Context ────────────────────────────────────────────────────────
// Edit this file to guide Claude's question generation in pipeline 1.
// Changes here take effect on the next /generate-questions run.

export const AVAILABLE_METRICS = `
General stats space:
- Goals, assists, shots on target, shots total, shots off target
- Yellow cards, red cards, fouls committed, fouls won
- Pass count, pass accuracy (%), key passes
- Corners, offsides, possession %
- Player positions and minutes played
- Team standings, points, wins, draws, losses, goal difference
- Season aggregations and per-game averages
- Big chances created, big chances missed
- Defensive metrics: interceptions, tackles, aerial duels won, etc.
- Style metrics: percentage of passes in opponent half, percentage of shots from set plays, etc.
- Shot metrics: shot count, shot accuracy, shot on target count, shot off target count, shot blocked count, shot saved count, shot missed count, shot hit woodwork count, shot hit post count, shot hit bar count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count, shot hit goal post count,
- shot type: left, right, head
- Fouls committed, fouls won

Match events space:
- Shot timing (minute of shot)
- Game state at time of shot/goal (score at that moment, winning/drawing/losing)
- Shot location / zone on pitch
- Shot outcome (goal, saved, blocked, off target)
- If shot was originated from throw in, corner, free kick, open play, counter attack
- Build-up sequence leading to shot (e.g. number of passes, zones passed through)

Pass events space:
- Individual pass accuracy %
- Pass zones (defensive third, middle third, final third)
- Cross count and cross accuracy
- Long ball count and accuracy, per player and per team
`;

/** Example questions sampled per draft scenario; keep in sync with the spirit of QUESTION_GUIDES. */
export const QUESTION_SEEDS: readonly string[] = [
  "Which midfielder has the highest pass accuracy in the current season among players with at least 1200 minutes played?",
  "How many goals did the top scorer have in the current season, and how does that compare to the top scorer of the 10 previous seasons?",
  "What was the total number of goals originated from corner each team scored, along with total corners awarded?",
  "How many goals did Player X score in matches against top 4 teams in the current season after Gameweek 10?",
  "Which player in the current season has equally distributed passes in each third of the pitch (defensive, middle, final) and at least 1200 minutes played?",
  "Which player delivered more cross assists in the current season, from how many accurate and total crosses?",
  "What is the distribution between long ball and short pass attempts for Team Y in the current season, and how does that relate to the other teams?",
  "Which player scored more goals originated from corner in each season in the past decade?",
  "Which players have the highest shot accuracy goals/total shots ratio in the last decade for players with at least 20 total shots, and who the lowest?",
  "Which team depends the most on a single scorer this season? (i.e. highest percentage of team's goals scored by one player > 70%)",
  "Which player has the most goals from outside the box in the current season compared to the last decade?",
  "Which player has the most headed goals this season, and how does that compare to the previous five seasons?",
  "Which player scores most often in away matches versus home matches?",
  "Which team produces the most headed shots per match in the current season, how that compares to top teams from previous seasons?",
  "Which team relies the most on shots from set plays (throw-ins, corners and freekicks) versus open play?",
  "Which midfielder has the most accurate through balls in the current season?",
  "Which team completes the highest percentage of passes in the opponent’s half?",
  "Which player has the most assists from corners?",
  "Which team or player has the biggest difference between overall pass accuracy and final-third pass accuracy?",
  "Which team attacks most through crosses, and which gets the least reward from them?",
  "Which flank is more productive for each team: left or right?",
  "Which team allows the fewest shots inside the box?",
  "Which team concedes the most headed shots?",
  "Which player makes the most interceptions in the middle third?",
  "Which defender has the best arial duel success rate among players with at least 100 duels?",
  "Which player had the biggest drop in pass accuracy compared with last season?",
  "Which team’s crossing volume has changed the most over the last five seasons?",
  "Who is the most one-footed passer in the league? (i.e. highest percentage of passes with one foot)",
  "Which team scores the highest percentage of goals from corners?",
  "Which team is the most direct based on passes before a shot?",
  "Which team concedes the most goals late in matches?",
];

/** Past seasons only (excludes current 2025/2026) for the single_historical scope. */
export const HISTORICAL_SEASONS_FOR_SAMPLE: readonly string[] = [
  "2010/2011", "2011/2012", "2012/2013", "2013/2014", "2014/2015", "2015/2016", "2016/2017", "2017/2018",
  "2018/2019", "2019/2020", "2020/2021", "2021/2022", "2022/2023", "2023/2024", "2024/2025",
];

export type SeasonScopeId =
  | "current_only"
  | "last_season"
  | "last_5_seasons"
  | "last_decade";

export const SEASON_SCOPE_DEFINITIONS: readonly {
  id: SeasonScopeId;
  weight: number;
  /** If true, replace {{SEASON}} with a value from HISTORICAL_SEASONS_FOR_SAMPLE when building the prompt. */
  needsConcreteSeason?: boolean;
  instruction: string;
}[] = [
  {
    id: "current_only",
    weight: 50,
    instruction:
      "Season scope — use ONLY 2025/2026 as the primary (and only) season window in the Genie question. Do not compare to earlier seasons.",
  },
  {
    id: "last_season",
    weight: 10,
    instruction:
      "Season scope — A direct comparison between 2025/2026 and 2024/2025. Make both season labels explicit where relevant.",
  },
  {
    id: "last_5_seasons",
    weight: 20,
    instruction:
      "Season scope — cover the last five full seasons ending with 2025/2026 (i.e. 2021/2022 through 2025/2026). State that window explicitly.",
  },
  {
    id: "last_decade",
    weight: 20,
    instruction:
      "Season scope — use a multi-season window from 2010/2011 through 2025/2026 (the past decade-plus). State that range explicitly.",
  },

];

export const AVOID_METRICS = `
Do NOT ask about any of the following — they are not in the dataset:
- xG (expected goals) or any expected metric (xA, xGOT, etc.)
- Progressive passes or progressive carries
- PPDA or any pressing intensity metric
- Shot quality scores or "unsaveable" classifications
- Player tracking / positional data
- Heatmaps or touch maps
- Carry distance or carry metrics
- possesion
`;

export const QUESTION_GUIDES = `
When generating question for current season, remember that current season is 2025/2026, so "this season" or "current season" should refer to that. For historical questions, you can specify any season from 2010/2011 up to 2025/2026

When considering per 90 minutes stats, remember to filter by players with at least 1200 minutes played in the season

When considering accuracy metrics, consider the total number of attempts and the number of successful attempts. Low number of attempts could be misleading.

When requesting games against top 4 of the table, consider adding a filter for GW over 10 to ensure enough data points

Try to collect information from all angles of the question. Not only provide the top 1 results but top 10. Look for extra metadata information, like game dates, seasons, etc.



`;
