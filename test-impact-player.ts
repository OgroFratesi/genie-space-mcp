import { runImpactPlayerPipeline, ImpactPlayerPayload } from "./src/pipelines";
import * as dotenv from "dotenv";
dotenv.config();

const payload: ImpactPlayerPayload = {
  event_id:     "42133722-f41a-4adf-8186-aab17c8603ba",
  event_type:   "impact_threshold",
  matchId:      "1903472",
  startDate:    "2026-04-11",
  league:       "england-premier-league",
  season:       "2025/2026",
  GW:           32,
  entity_type:  "player",
  entity_id:    "445059",
  entity_name:  "Mats Wieffer",
  team_name:    "Brighton",
  rank_type:    "null",
  metric:       "impact_total_score",
  current_value: 18,
  rank:         null,
  prev_rank:    null,
  detected_at:  "2026-04-12T23:53:01.401+00:00",
  processed:    false,
};

console.log("=== Running impact player pipeline ===\n");

runImpactPlayerPipeline(payload)
  .then((result) => {
    console.log("\n=== RESULT ===");
    console.log("Event ID  :", result.eventId);
    console.log("Notion URL:", result.notionUrl);
    console.log("Tweet draft:\n", result.tweetDraft);
  })
  .catch((err) => {
    console.error("Pipeline failed:", err.message);
    process.exit(1);
  });
