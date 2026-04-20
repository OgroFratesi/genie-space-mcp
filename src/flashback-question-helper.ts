// ── Flashback Question Context ────────────────────────────────────────────────
// Prompt constants for the flashback pipeline — historically nostalgic content.
// Reuses AVAILABLE_METRICS and AVOID_METRICS from draft-question-helper.ts.

/** Example flashback questions sampled per scenario; keep in sync with FLASHBACK_QUESTION_GUIDES tone. */
export const FLASHBACK_QUESTION_SEEDS: readonly string[] = [
  "Who holds the all-time record for headed goals?",
  "Which season produced the highest number of goals scored by a single team?",
  "Which defender in the 2010s had the most interceptions per game over a full season?",
  "What is the highest single-season pass accuracy recorded by a Premier League midfielder?",
  "How many goals did the top scorer average per game in each PL season from 2010/2011 to 2019/2020?",
  "Which player had the most assists in a single La Liga season in the last decade?",
  "Who was the most prolific header of the ball in the Bundesliga during the 2010s?",
  "Which team scored the most goals in a single Premier League season between 2010/2011 and 2022/2023?",
  "Which team had the highest pass accuracy across all seasons in the dataset?",
  "Which team relied most heavily on set-piece goals in a given season?",
  "How did the top scorers of the early 2010s (2010-2015) compare to those of the late 2010s (2015-2020) in goals per game?",
  "Which season had the most goals scored from outside the box?",
  "How has the number of headed goals changed across seasons from 2010/2011 to 2022/2023?",
  "Which player had the most shots off target in a single season — the most wasteful shooter in recent history?",
  "Which team conceded the most goals in the first half across all seasons?",
  "Which club had the longest run of consecutive seasons finishing in the top half?",
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

Templates:
Who holds the all-time record for [metric] across [seasons/league]?
Which season produced the [extreme value] of [metric]?
Which player from [era] still has the [record] that no one has beaten since?
Which team in [decade] was the most [style trait] in the league?

Keep questions specific, historically grounded, and answerable with the available metrics.
Never use "current season" or 2025/2026 as the primary focus.
Aim for questions that trigger "oh wow, I forgot about that" or "I didn't know that".
`;
