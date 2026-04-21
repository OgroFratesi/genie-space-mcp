// ── Flashback Question Context ────────────────────────────────────────────────
// Prompt constants for the flashback pipeline — historically nostalgic content.
// Reuses AVAILABLE_METRICS and AVOID_METRICS from draft-question-helper.ts.

export const FLASHBACK_METRICS_FOR_SAMPLE: readonly string[] = [
  "goals",
  "assists",
  "headed goals",
  "goals from outside the box",
  "shots on target",
  "pass accuracy",
  "key passes",
  "aerial duels won",
  "interceptions",
  "tackles",
  "defensive contributions",
  "shot on posts",
  "yellow cards",
  "goals from set pieces",
  "goals from corners",
  "shots per game",
  "big chances created",
  "big chances missed",
  "corner goals",
  "dribble won",
  "headed shots",
  "shots with both feet",
  "passes with both feet",
  "cross accuracy",
  "long ball accuracy",
  "goals from counter-attacks",
];

export function pickFlashbackMetric(): string {
  const p = FLASHBACK_METRICS_FOR_SAMPLE;
  return p[Math.floor(Math.random() * p.length)]!;
}

/** Example flashback questions sampled per scenario; keep in sync with FLASHBACK_QUESTION_GUIDES tone. */
export const FLASHBACK_QUESTION_SEEDS: readonly string[] = [
  "Which top 5 players holds the all-time record for [METRIC]?",
  "Which top 5 players holds the all-time record for [METRIC] per 90 minutes, with more than 1200 minutes?",
  "Which season produced the highest number of goals scored by a single team?",
  "Which defender had the most DEFENSIVE CONTRIBUTIONS per game over a full season?",
  "What is the highest single-season pass accuracy recorded by a midfielder?",
  "Which player had the most assists in a single season?",
  "Which team had the highest pass accuracy across all seasons in the dataset?",
  "Which team relied most heavily on set-piece goals in a given season?",
  "Which season had the most goals scored from outside the box?",
  "Which season had the most goals scored from outside the box by a single player?",
  "Which player had the most shots off target in a single season — the most wasteful shooter in recent history?",
  "Which team conceded the most goals in the last 15 minutes across all seasons?",
  "Which club had the most goals scored originated by corners in a single season?",
  "Which club had the most goals scored originated by throw in in a single season?",
  "Which team scored the most goals away from home in a single season?",
  "Which team conceded the least goals at home in a single season?",
  "Which player scored the most goals against the big six in the premier league in a single season?",

];

/**
 * Seasons used for concrete sampling (aligns with flashback intro: through 2016/2017).
 * Widen this array if your dataset and editorial rules include later historical seasons.
 */
export const FLASHBACK_HISTORICAL_SEASONS_FOR_SAMPLE: readonly string[] = [
  "2010/2011",
  "2011/2012",
  "2012/2013",
  "2013/2014",
  "2014/2015",
  "2015/2016",
  "2016/2017",
];

export type FlashbackSeasonScopeId =
  | "ten_years_ago_historical"
  | "single_season_historical"
  | "full_flashback_window"
  | "five_season_window";

export const FLASHBACK_SEASON_SCOPE_DEFINITIONS: readonly {
  id: FlashbackSeasonScopeId;
  weight: number;
  instruction: string;
}[] = [
  {
    id: "ten_years_ago_historical",
    weight: 20,
    instruction:
      "Season scope — anchor the Genie question ONLY on season 2015/2016. Making it 10 years ago from now.",
  },
  {
    id: "full_flashback_window",
    weight: 60,
    instruction:
      "Season scope — the question must explicitly span 2010/2011 through 2020/2021 inclusive (the core flashback era). Never 2025/2026 as primary.",
  },
  {
    id: "five_season_window",
    weight: 1,
    instruction:
      "Season scope — constrain analysis to these five consecutive seasons only: {{FIVE_SEASON_SPAN}}. State them explicitly in the genieQuestion. Never 2025/2026.",
  },
  {
    id: "single_season_historical",
    weight: 9,
    instruction:
      "Season scope — anchor the Genie question ONLY on season {{SEASON}}. Using one of the seasons from the historical dataset before 2016/2017.",
  },
];

function pickWeighted<T extends { weight: number }>(items: readonly T[]): T {
  const total = items.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const x of items) {
    r -= x.weight;
    if (r <= 0) return x;
  }
  return items[items.length - 1]!;
}

function randomSeasonFromPool(): string {
  const p = FLASHBACK_HISTORICAL_SEASONS_FOR_SAMPLE;
  return p[Math.floor(Math.random() * p.length)]!;
}

function fiveConsecutiveSeasonSpanText(): string {
  const p = FLASHBACK_HISTORICAL_SEASONS_FOR_SAMPLE;
  const maxStart = p.length - 5;
  const start = Math.floor(Math.random() * (maxStart + 1));
  const slice = p.slice(start, start + 5);
  return `${slice[0]} through ${slice[4]} (${slice.join(", ")})`;
}

/** Resolves placeholders for weighted flashback season scopes. */
export function pickFlashbackSeasonScope(): { id: FlashbackSeasonScopeId; instruction: string } {
  const def = pickWeighted(FLASHBACK_SEASON_SCOPE_DEFINITIONS);
  switch (def.id) {
    case "single_season_historical":
      return {
        id: def.id,
        instruction: def.instruction.split("{{SEASON}}").join(randomSeasonFromPool()),
      };
    case "five_season_window":
      return {
        id: def.id,
        instruction: def.instruction.split("{{FIVE_SEASON_SPAN}}").join(fiveConsecutiveSeasonSpanText()),
      };
    case "ten_years_ago_historical":
    case "full_flashback_window":
      return { id: def.id, instruction: def.instruction };
  }
}

export const FLASHBACK_QUESTION_GUIDES = `
Focus on HISTORICAL football statistics — nostalgic, era-defining content.

Programmatic runs sample concrete example questions from FLASHBACK_QUESTION_SEEDS; when rebuilding, match that spirit.

Keep questions specific, historically grounded, and answerable with the available metrics.
Aim for questions that trigger "oh wow, I forgot about that" or "I didn't know that".
`;
