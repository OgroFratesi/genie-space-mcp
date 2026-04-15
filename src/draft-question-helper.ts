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
Never use a specific season in the question which is not the current season (2025/2026). But you can ask for "the last 5 seasons" or "the past decade" to get historical trends. 

When generating question for current season, remember that current season is 2025/2026, so "this season" or "current season" should refer to that. For historical questions, you can specify any season from 2010/2011 up to 2025/2026

When considering per 90 minutes stats, remember to filter by players with at least 1200 minutes played in the season

When requesting games against top 4 of the table, consider adding a filter for GW over 10 to ensure enough data points

Try to collect information from all angles of the question. Not only provide the top 1 results but top 10. Look for extra metadata information, like game dates, seasons, etc.

Try to compare the stat across different seasons or leagues to provide more context and insight. 

Always the current seasons is more relevant, but if the historical data shows an interesting trend or record, make sure to highlight it in the answer.

Here are some examples of good questions to ask:
- "Which midfielder has the highest pass accuracy in the current season among players with at least 1200 minutes played?"
- "How many goals did the top scorer have in the current season, and how does that compare to the top scorer of the 10 previous seasons?"
- "What was the total number of goals originated from corner each team scored, along with total corners awarded?"
- "How many goals did Player X score in matches against top 4 teams in the current season after Gameweek 10?"
- "Which player in the current season has equally distributed passes in each third of the pitch (defensive, middle, final) and at least 1200 minutes played?"
- "Which player delivered more cross assists in the current season, from how many accurate and total crosses?"
- "What is the distribution between long ball and short pass attempts for Team Y in the current season, and how does that relate to the other teams?"
- "Which player scored more goals originated from corner in each season in the past decade?"
- "Which players have the highest shot accuracy goals/total shots ratio in the last decade for players with at least 20 total shots, and who the lowest?"
- "Which team depends the most on a single scorer this season? (i.e. highest percentage of team's goals scored by one player > 70%)"
- "Which player has the most goals from outside the box in the current season compared to the last decade?"
- "Which player has the most headed goals this season, and how does that compare to the previous five seasons?"
- "Which player scores most often in away matches versus home matches?"
- "Which team produces the most headed shots per match in the current season, how that compares to top teams from previous seasons?
- "Which team relies the most on shots from set plays (throw-ins, corners and freekicks) versus open play?"
- "Which midfielder has the most accurate through balls in the current season?"
- "Which team completes the highest percentage of passes in the opponent’s half?"
- "Which player has the most assists from corners?"
- "Which team or player has the biggest difference between overall pass accuracy and final-third pass accuracy?"
- "Which team attacks most through crosses, and which gets the least reward from them?"
- "Which flank is more productive for each team: left or right?"
- "Which team allows the fewest shots inside the box?"
- "Which team concedes the most headed shots?"
- "Which player makes the most interceptions in the middle third?"
- "Which defender has the best arial duel success rate among players with at least 100 duels?"
- "Which player had the biggest drop in pass accuracy compared with last season?"
- "Which team’s crossing volume has changed the most over the last five seasons?"
- "Who is the most one-footed passer in the league? (i.e. highest percentage of passes with one foot)"
- "Which team scores the highest percentage of goals from corners?"
- "Which team is the most direct based on passes before a shot?"
- "Which team concedes the most goals late in matches?"


You can turn almost any metric into a stronger curiosity question with these templates:

Who leads [metric] among players with at least [minutes]?
How does [current leader] compare to the last [N] seasons?
Which team relies most on [action type], and is it effective?
Which player has the strangest gap between [volume metric] and [outcome metric]?
What changes after [gameweek/time split/game state]?
Which players are most balanced across [zones/types/categories]?
Which teams are outliers in [style metric] compared to the rest of the league?

Key metrics to consider for these templates include:
- Volume metrics: pass count, shot count, cross count, long ball count, etc.
- Outcome metrics: goals, assists, pass accuracy, shot accuracy, big chances created, etc.
- defensive metrics: interceptions, tackles, aerial duels won, etc.
- Style metrics: percentage of passes in opponent half, percentage of shots from set plays, etc.


Keep questions specific and answerable with the available metrics above.
Avoid vague questions like "who is the best midfielder?" — prefer narrow, data-driven ones.
`;
