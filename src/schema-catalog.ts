// Schema catalog for scatter plot SQL generation.
// Add tables and columns here — the scatter pipeline uses this instead of asking Genie to guess column names.

export interface ColumnDef {
  name: string;        // exact column name as it appears in Databricks
  description: string; // human-readable label used on chart axes
  per90?: boolean;     // default true if this metric is typically shown per 90 mins
}

export interface TableDef {
  fullName: string;    // fully-qualified table name, e.g. "playon_prod.gold.match_player_attack"
  description: string; // what this table contains (used to route metric requests)
  playerColumn: string;  // exact column name for player name
  teamColumn: string;    // exact column name for team name
  minutesColumn: string; // exact column name for minutes played
  filterColumns: {
    league?: string;   // exact column name for league filter
    season?: string;   // exact column name for season filter
    position?: string; // exact column name for position filter
  };
  leagueValues: Record<string, string>; // human name → exact DB value
  positionValues: Record<string, string>; // human name → exact DB value (e.g. "forwards" → "FWD")
  metrics: ColumnDef[];
}

export const SCHEMA_CATALOG: TableDef[] = [
  {
    fullName: "playon_prod.gold.match_player_attack",
    description: "game-level aggregated attacking stats per player: goals, assists, shots, dribbles, crosses, big chances. One row per player per season per league.",
    playerColumn: "playerName",
    teamColumn: "teamName",
    minutesColumn: "total_minutes_played",
    filterColumns: {
      league: "league",
      season: "season",
      position: "player_position",
    },
    leagueValues: {
      "Premier League": "england-premier-league",
      "La Liga": "spain-laliga",
      "Bundesliga": "germany-bundesliga",
      "Serie A": "italy-serie-a",
      "Ligue 1": "ligue_1",
      "Champions League": "europe-champions-league",
    },
    positionValues: {
      "forwards": "FWD",
      "midfielders": "MID",
      "defenders": "DEF",
      "goalkeepers": "GK",
    },
    metrics: [
      { name: "total_goals",           description: "Goals",                    per90: true  },
      { name: "total_assists",         description: "Assists",                  per90: true  },
      { name: "total_shots",           description: "Shots",                    per90: true  },
      { name: "total_shots_on_target", description: "Shots on target",          per90: true  },
      { name: "total_big_chances",     description: "Big chances",              per90: true  },
      { name: "total_dribbles",        description: "Dribbles attempted",       per90: true  },
      { name: "total_dribbles_won",    description: "Dribbles won",             per90: true  },
      { name: "total_crosses",         description: "Crosses",                  per90: true  },
      { name: "total_key_passes",      description: "Key passes",               per90: true  },
      { name: "total_minutes_played",  description: "Minutes played",           per90: false },
    ],
  },

  // Add more tables below as needed, e.g.:
  // {
  //   fullName: "playon_prod.gold.match_player_defense",
  //   description: "Season-level defensive stats: tackles, interceptions, clearances, blocks.",
  //   playerColumn: "playerName",
  //   teamColumn: "teamName",
  //   minutesColumn: "total_minutes_played",
  //   filterColumns: { league: "league", season: "season", position: "position" },
  //   leagueValues: { ... },
  //   positionValues: { ... },
  //   metrics: [
  //     { name: "total_tackles",        description: "Tackles",         per90: true },
  //     { name: "total_interceptions",  description: "Interceptions",   per90: true },
  //   ],
  // },
];
