import Anthropic from "@anthropic-ai/sdk";
import { saveDraftQuestion } from "../notion";
import {
  QUESTION_SEEDS,
  SEASON_SCOPE_DEFINITIONS,
  HISTORICAL_SEASONS_FOR_SAMPLE,
  type SeasonScopeId,
} from "../draft-question-helper";
import {
  pickLeague,
  pickWeighted,
  leagueHumanLabel,
  genieLeaguePromptFragment,
} from "./shared";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// ── Scenario building ─────────────────────────────────────────────────────────

function resolveSeasonScopeForPrompt(): { id: SeasonScopeId; instruction: string } {
  const def = pickWeighted(SEASON_SCOPE_DEFINITIONS);
  if (def.needsConcreteSeason) {
    const seasons = HISTORICAL_SEASONS_FOR_SAMPLE;
    const season = seasons[Math.floor(Math.random() * seasons.length)]!;
    return { id: def.id, instruction: def.instruction.split("{{SEASON}}").join(season) };
  }
  return { id: def.id, instruction: def.instruction };
}

interface QuestionRebuildScenario {
  league: string;
  seedQuestion: string;
  seasonId: SeasonScopeId;
  seasonInstruction: string;
}

function buildQuestionScenarios(count: number): QuestionRebuildScenario[] {
  const out: QuestionRebuildScenario[] = [];
  for (let i = 0; i < count; i++) {
    const league = pickLeague();
    const seedQuestion = QUESTION_SEEDS[Math.floor(Math.random() * QUESTION_SEEDS.length)]!;
    const { id, instruction } = resolveSeasonScopeForPrompt();
    out.push({ league, seedQuestion, seasonId: id, seasonInstruction: instruction });
  }
  return out;
}

// ── Question generation ───────────────────────────────────────────────────────

interface TopicSelection {
  topic: string;
  genieQuestion: string;
}

async function generateQuestions(
  scenarios: QuestionRebuildScenario[],
): Promise<{ questions: TopicSelection[]; inputTokens: number; outputTokens: number }> {
  const count = scenarios.length;
  const scenarioBlocks = scenarios
    .map((s, idx) => {
      const leagueLabel = leagueHumanLabel(s.league);
      const slugHint = genieLeaguePromptFragment(s.league);
      return `Scenario ${idx + 1}:
- League key: ${s.league}
- League focus (human): ${leagueLabel}
- ${slugHint}
- Seed question (preserve analytical intent — metric family, filters, comparison shape; do NOT copy wording verbatim):
${s.seedQuestion}
- ${s.seasonInstruction}`;
    })
    .join("\n\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{
      role: "user",
      content: `You are a football data analyst. REBUILD each seed question into a new, specific natural-language question for Genie (Databricks), using ONLY the assigned league and season scope for that scenario.

For EVERY scenario:
- Preserve the seed's analytical intent (what is measured, ranked, or compared).
- Rewrite in fresh wording; do not paste the seed.
- The genieQuestion MUST satisfy the season scope lines for that scenario exactly (correct season labels and window).
- The genieQuestion MUST satisfy the league lines: if league key is "all", compare across the four leagues given; otherwise use only that scenario's Genie slug.
- Prefer concrete asks: top N lists, thresholds (e.g. minutes played), and supporting context when the seed implies it.


When generating question for current season, remember that current season is 2025/2026, so "this season" or "current season" should refer to that. For historical questions, you can specify any season from 2010/2011 up to 2025/2026

When considering per 90 minutes stats, remember to filter by players with at least 1200 minutes played in the season

When considering accuracy metrics, consider the total number of attempts and the number of successful attempts. Low number of attempts could be misleading.

When requesting games against top 4 of the table, consider adding a filter for GW over 10 to ensure enough data points

Try to collect information from all angles of the question. Not only provide the top 1 results but top 10. Look for extra metadata information, like game dates, seasons, etc.


${scenarioBlocks}

Respond ONLY as valid JSON with no additional text — an array of exactly ${count} objects in the SAME ORDER as scenarios (first object = Scenario 1, etc.):
[
  {
    "topic": "<short topic description, 5-10 words>",
    "genieQuestion": "<detailed natural language question for Genie, 2-4 sentences; explicit slug(s) and season per scope>"
  }
]`,
    }],
  });

  const text = (response.content[0] as any).text as string;
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`generateQuestions: Claude did not return valid JSON. Response: ${text}`);
  const questions = JSON.parse(match[0]) as TopicSelection[];
  if (!Array.isArray(questions) || questions.length !== count) {
    throw new Error(
      `generateQuestions: expected ${count} questions, got ${Array.isArray(questions) ? questions.length : typeof questions}`,
    );
  }
  return {
    questions,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

// ── Pipeline: Question generation ─────────────────────────────────────────────

export async function runQuestionGenerationPipeline(count = 3): Promise<string> {
  console.log("[generate-questions] Starting pipeline...");

  const scenarios = buildQuestionScenarios(count);
  scenarios.forEach((s, i) => {
    const seedShort = s.seedQuestion.length > 90 ? `${s.seedQuestion.slice(0, 90)}…` : s.seedQuestion;
    console.log(
      `[generate-questions] Scenario ${i + 1}: league=${s.league} season=${s.seasonId} seed=${JSON.stringify(seedShort)}`,
    );
  });

  console.log(`[generate-questions] Generating ${count} questions...`);
  const { questions, inputTokens: qIn, outputTokens: qOut } = await generateQuestions(scenarios);
  console.log(`[generate-questions] Got ${questions.length} questions from Claude`);
  console.log(`[generate-questions] tokens: in=${qIn} out=${qOut}`);

  const tokenUsage = `questions_in=${qIn.toLocaleString()} | questions_out=${qOut.toLocaleString()}`;
  const urls: string[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    const league = scenarios[i]!.league;
    const url = await saveDraftQuestion({
      topic: q.topic,
      question: q.genieQuestion,
      league,
      tokenUsage,
    });
    urls.push(url);
    console.log(`[generate-questions] Saved: "${q.topic}" (league=${league})`);
  }

  const leagueSummary = [...new Set(scenarios.map((s) => s.league))].join(", ");
  return `Saved ${urls.length} draft questions to Notion (leagues: ${leagueSummary}).\n${urls.join("\n")}`;
}
