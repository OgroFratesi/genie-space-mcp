import * as fs from "fs";
import * as path from "path";

const LOGOS_DIR = path.join(__dirname, "logos");

// Maps team name variations (lowercase) → PNG filename slug (without extension)
const TEAM_LOGO_SLUGS: Record<string, string> = {
  // Chelsea
  "chelsea": "chelsea",
  "chelsea fc": "chelsea",

  // Liverpool
  "liverpool": "liverpool",
  "liverpool fc": "liverpool",

  // Manchester City
  "manchester city": "manchester-city",
  "man city": "manchester-city",
  "man. city": "manchester-city",
  "mcfc": "manchester-city",

  // Manchester United
  "manchester united": "manchester-united",
  "man united": "manchester-united",
  "man utd": "manchester-united",
  "man. utd": "manchester-united",
  "mufc": "manchester-united",

  // Arsenal
  "arsenal": "arsenal",
  "arsenal fc": "arsenal",

  // Tottenham
  "tottenham": "tottenham",
  "tottenham hotspur": "tottenham",
  "spurs": "tottenham",
  "thfc": "tottenham",

  // Newcastle
  "newcastle": "newcastle",
  "newcastle united": "newcastle",
  "nufc": "newcastle",

  // Aston Villa
  "aston villa": "aston-villa",
  "villa": "aston-villa",

  // West Ham
  "west ham": "west-ham",
  "west ham united": "west-ham",
  "whufc": "west-ham",

  // Brighton
  "brighton": "brighton",
  "brighton & hove albion": "brighton",
  "brighton and hove albion": "brighton",

  // Brentford
  "brentford": "brentford",
  "brentford fc": "brentford",

  // Fulham
  "fulham": "fulham",
  "fulham fc": "fulham",

  // Wolves
  "wolves": "wolves",
  "wolverhampton": "wolves",
  "wolverhampton wanderers": "wolves",

  // Everton
  "everton": "everton",
  "everton fc": "everton",

  // Crystal Palace
  "crystal palace": "crystal-palace",
  "palace": "crystal-palace",

  // Nottingham Forest
  "nottingham forest": "nottingham-forest",
  "forest": "nottingham-forest",
  "nffc": "nottingham-forest",

  // Leicester
  "leicester": "leicester",
  "leicester city": "leicester",
  "lcfc": "leicester",

  // Southampton
  "southampton": "southampton",
  "saints": "southampton",

  // Leeds
  "leeds": "leeds",
  "leeds united": "leeds",
  "lufc": "leeds",

  // Real Madrid
  "real madrid": "real-madrid",
  "real madrid cf": "real-madrid",

  // Barcelona
  "barcelona": "barcelona",
  "fc barcelona": "barcelona",
  "barca": "barcelona",

  // Atletico Madrid
  "atletico madrid": "atletico-madrid",
  "atlético madrid": "atletico-madrid",
  "atletico": "atletico-madrid",

  // Bayern Munich
  "bayern munich": "bayern-munich",
  "fc bayern": "bayern-munich",
  "fc bayern munich": "bayern-munich",
  "bayern": "bayern-munich",

  // Borussia Dortmund
  "borussia dortmund": "borussia-dortmund",
  "dortmund": "borussia-dortmund",
  "bvb": "borussia-dortmund",

  // PSG
  "paris saint-germain": "psg",
  "paris saint germain": "psg",
  "psg": "psg",
  "paris sg": "psg",

  // Juventus
  "juventus": "juventus",
  "juve": "juventus",
  "juventus fc": "juventus",

  // Inter Milan
  "inter milan": "inter-milan",
  "inter": "inter-milan",
  "internazionale": "inter-milan",
  "fc internazionale": "inter-milan",

  // AC Milan
  "ac milan": "milan",
  "milan": "milan",

  "como":"como",

  // Napoli
  "napoli": "napoli",
  "ssc napoli": "napoli",

  // Roma
  "roma": "roma",
  "as roma": "roma",

  // Lazio
  "lazio": "lazio",
  "ss lazio": "lazio",

  // Sevilla
  "sevilla": "sevilla",
  "sevilla fc": "sevilla",

  // Valencia
  "valencia": "valencia",
  "valencia cf": "valencia",

  // Porto
  "porto": "porto",
  "fc porto": "porto",

  // Benfica
  "benfica": "benfica",
  "sl benfica": "benfica",

  "sassuolo":"sassuolo",

  "rayo vallecano":"rayo-vallecano",

  // Ajax
  "ajax": "ajax",
  "afc ajax": "ajax",
};

const logoCache = new Map<string, string>();

export function resolveTeamLogo(teamName: string): string | undefined {
  if (!teamName) return undefined;

  const key = teamName.toLowerCase().trim();
  if (logoCache.has(key)) return logoCache.get(key);

  const slug = TEAM_LOGO_SLUGS[key];
  if (!slug) {
    console.log(`[logos] No slug for team: "${key}"`);
    return undefined;
  }

  const filePath = path.join(LOGOS_DIR, `${slug}.png`);
  if (!fs.existsSync(filePath)) return undefined;

  const b64 = fs.readFileSync(filePath).toString("base64");
  const dataUri = `data:image/png;base64,${b64}`;
  logoCache.set(key, dataUri);
  return dataUri;
}
