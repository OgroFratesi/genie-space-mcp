import Anthropic from "@anthropic-ai/sdk";
import { saveFlashbackQuestion } from "../notion";
import {
  FLASHBACK_QUESTION_SEEDS,
  pickFlashbackSeasonScope,
  pickFlashbackMetric,
  type FlashbackSeasonScopeId,
} from "../flashback-question-helper";
import {
  pickFlashbackLeague,
  leagueHumanLabel,
  genieLeaguePromptFragment,
} from "./shared";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// ── Scenario building ─────────────────────────────────────────────────────────

interface FlashbackQuestionRebuildScenario {
  league: string;
  seedQuestion: string;
  seasonId: FlashbackSeasonScopeId;
  seasonInstruction: string;
  sampledMetric?: string;
}

function buildFlashbackQuestionScenarios(count: number): FlashbackQuestionRebuildScenario[] {
  const out: FlashbackQuestionRebuildScenario[] = [];
  for (let i = 0; i < count; i++) {
    const league = pickFlashbackLeague();
    const rawSeed = FLASHBACK_QUESTION_SEEDS[Math.floor(Math.random() * FLASHBACK_QUESTION_SEEDS.length)]!;
    let seedQuestion = rawSeed;
    let sampledMetric: string | undefined;
    if (rawSeed.includes("[METRIC]")) {
      sampledMetric = pickFlashbackMetric();
      seedQuestion = rawSeed.replace("[METRIC]", sampledMetric);
    }
    const { id, instruction } = pickFlashbackSeasonScope();
    out.push({ league, seedQuestion, seasonId: id, seasonInstruction: instruction, sampledMetric });
  }
  return out;
}

// ── Question generation ───────────────────────────────────────────────────────

interface TopicSelection {
  topic: string;
  genieQuestion: string;
}

async function generateFlashbackQuestions(
  scenarios: FlashbackQuestionRebuildScenario[],
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
- Seed question (preserve nostalgic / historical analytical intent — record type, era, comparison shape; do NOT copy wording verbatim):
${s.seedQuestion}
- ${s.seasonInstruction}`;
    })
    .join("\n\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{
      role: "user",
      content: `You are a football data analyst. REBUILD each seed into a new, specific natural-language question for Genie (Databricks) — historically nostalgic "flashback" content only.

For EVERY scenario:
- Preserve the seed's analytical intent (records, era comparisons, team/player historical angles).
- Rewrite in fresh wording; do not paste the seed.
- The genieQuestion MUST satisfy the season scope lines for that scenario exactly.
- The genieQuestion MUST satisfy the league lines: if league key is "all", compare across the four leagues given; otherwise use only that scenario's Genie slug.
- Include TOP 10 if the question is about a ranking.
- If the question spans multiple seasons, be specific that the metric is for single season, not a cumulative stat across seasons.

- If there is a ranking, ALWAYS include the top 1 from current season (2025/2026) as extra information. This is crucial for the flashback angle and for grounding the question in the present day, which is important for generating engaging content later. 

Here the scenario:
${scenarioBlocks}

Respond ONLY as valid JSON with no additional text — an array of exactly ${count} objects in the SAME ORDER as scenarios (first object = Scenario 1, etc.):
[
  {
    "topic": "<short topic description, 5-10 words>",
    "genieQuestion": "<detailed natural language question for Genie, 2-4 sentences; explicit slug(s) and historical season(s) per scope>"
  }
]`,
    }],
  });

  const text = (response.content[0] as any).text as string;
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`generateFlashbackQuestions: Claude did not return valid JSON. Response: ${text}`);
  const questions = JSON.parse(match[0]) as TopicSelection[];
  if (!Array.isArray(questions) || questions.length !== count) {
    throw new Error(
      `generateFlashbackQuestions: expected ${count} questions, got ${Array.isArray(questions) ? questions.length : typeof questions}`,
    );
  }
  return {
    questions,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

// ── Pipeline: Flashback question generation ───────────────────────────────────

export async function runFlashbackQuestionGenerationPipeline(count = 3): Promise<string> {
  console.log("[flashback-questions] Starting pipeline...");

  const scenarios = buildFlashbackQuestionScenarios(count);
  scenarios.forEach((s, i) => {
    const seedShort = s.seedQuestion.length > 90 ? `${s.seedQuestion.slice(0, 90)}…` : s.seedQuestion;
    console.log(
      `[flashback-questions] Scenario ${i + 1}: league=${s.league} season=${s.seasonId}${s.sampledMetric ? ` metric=${s.sampledMetric}` : ""} seed=${JSON.stringify(seedShort)}`,
    );
  });

  console.log(`[flashback-questions] Generating ${count} questions...`);
  const { questions, inputTokens: qIn, outputTokens: qOut } = await generateFlashbackQuestions(scenarios);
  console.log(`[flashback-questions] Got ${questions.length} questions from Claude`);
  console.log(`[flashback-questions] tokens: in=${qIn} out=${qOut}`);

  const tokenUsage = `questions_in=${qIn.toLocaleString()} | questions_out=${qOut.toLocaleString()}`;
  const urls: string[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    const league = scenarios[i]!.league;
    const url = await saveFlashbackQuestion({
      topic: q.topic,
      question: q.genieQuestion,
      league,
      tokenUsage,
    });
    urls.push(url);
    console.log(`[flashback-questions] Saved: "${q.topic}" (league=${league})`);
  }

  const leagueSummary = [...new Set(scenarios.map((s) => s.league))].join(", ");
  return `Saved ${urls.length} flashback draft questions to Notion (leagues: ${leagueSummary}).\n${urls.join("\n")}`;
}
