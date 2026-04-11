const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());

const NHL_BASE = "https://api-web.nhle.com/v1";
const NHL_STATS = "https://api.nhle.com/stats/rest/en";
const MLB_BASE = "https://statsapi.mlb.com/api/v1";

app.get("/goalie/:teamId/:season", async (req, res) => {
  try {
    const { teamId, season } = req.params;
    const url = `${NHL_STATS}/goalie/summary?limit=1&start=0&sort=wins&dir=DESC&cayenneExp=seasonId=${season}%20and%20teamId=${teamId}%20and%20gameTypeId=2`;
    const data = await fetch(url).then(r => r.json());
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/schedule/:abbrev/:season", async (req, res) => {
  try {
    const { abbrev, season } = req.params;
    const seasonData = await fetch(`${NHL_BASE}/club-schedule-season/${abbrev}/${season}`).then(r => r.json()).catch(() => ({ games: [] }));
    const nowData = await fetch(`${NHL_BASE}/club-schedule-season/${abbrev}/now`).then(r => r.json()).catch(() => ({ games: [] }));
    const allGames = [...(seasonData.games || []), ...(nowData.games || [])];
    const seen = new Set();
    const unique = allGames.filter(g => {
      if (seen.has(g.id)) return false;
      seen.add(g.id);
      return true;
    });
    res.json({ games: unique });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/mlb/games", async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const url = `${MLB_BASE}/schedule?sportId=1&date=${today}&hydrate=probablePitcher(stats),team,linescore`;
    const data = await fetch(url).then(r => r.json());
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/mlb/pitcher/:playerId", async (req, res) => {
  try {
    const { playerId } = req.params;
    const season = new Date().getFullYear();
    const url = `${MLB_BASE}/people/${playerId}/stats?stats=season&season=${season}&group=pitching`;
    const data = await fetch(url).then(r => r.json());
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/mlb/h2h/:awayId/:homeId", async (req, res) => {
  try {
    const { awayId, homeId } = req.params;
    const season = new Date().getFullYear();
    const url = `${MLB_BASE}/schedule?sportId=1&season=${season}&teamId=${awayId}&opponent=${homeId}&gameType=R&hydrate=linescore,team`;
    const data = await fetch(url).then(r => r.json());
    const games = (data.dates || [])
      .flatMap(d => d.games || [])
      .filter(g => {
        const finished = g.status?.abstractGameState === "Final";
        const awayTeamId = g.teams?.away?.team?.id;
        const homeTeamId = g.teams?.home?.team?.id;
        const correctMatchup = (
          (String(awayTeamId) === String(awayId) && String(homeTeamId) === String(homeId)) ||
          (String(awayTeamId) === String(homeId) && String(homeTeamId) === String(awayId))
        );
        return finished && correctMatchup;
      })
      .slice(-5);
    res.json({ games });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/props/nhl/:gameId", async (req, res) => {
  try {
    const { gameId } = req.params;
    const apiKey = process.env.ODDS_API_KEY;
    const markets = [
      "player_goal_scorer_first","player_goal_scorer_last","player_goal_scorer_anytime",
      "player_goals","player_goals_alternate","player_assists","player_assists_alternate",
      "player_points","player_points_alternate","player_power_play_points",
      "player_power_play_points_alternate","player_shots_on_goal","player_shots_on_goal_alternate",
      "player_blocked_shots","player_blocked_shots_alternate"
    ].join(",");
    const url = `https://api.the-odds-api.com/v4/sports/icehockey_nhl/events/${gameId}/odds?apiKey=${apiKey}&regions=us,us2&markets=${markets}&oddsFormat=decimal`;
    const data = await fetch(url).then(r => r.json());
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/props/mlb/:gameId", async (req, res) => {
  try {
    const { gameId } = req.params;
    const apiKey = process.env.ODDS_API_KEY;
    const markets = [
      "batter_home_runs","batter_home_runs_alternate","batter_hits","batter_hits_alternate",
      "batter_total_bases","batter_total_bases_alternate","batter_rbis","batter_rbis_alternate",
      "batter_runs_scored","batter_stolen_bases","batter_walks","batter_strikeouts",
      "pitcher_strikeouts","pitcher_strikeouts_alternate","pitcher_hits_allowed",
      "pitcher_hits_allowed_alternate","pitcher_walks","pitcher_walks_alternate","pitcher_earned_runs"
    ].join(",");
    const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${gameId}/odds?apiKey=${apiKey}&regions=us,us2&markets=${markets}&oddsFormat=decimal`;
    const data = await fetch(url).then(r => r.json());
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// NHL player season stats + last 5 games
app.get("/nhl/player/:playerId", async (req, res) => {
  try {
    const { playerId } = req.params;
    const [seasonRes, gameLogRes] = await Promise.all([
      fetch(`${NHL_BASE}/player/${playerId}/landing`),
      fetch(`${NHL_BASE}/player/${playerId}/game-log/20252026/2`)
    ]);
    const seasonData = await seasonRes.json();
    const gameLogData = await gameLogRes.json();
    res.json({ season: seasonData, gameLog: gameLogData });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// NHL player search by name
app.get("/nhl/search/:name", async (req, res) => {
  try {
    const { name } = req.params;
    const url = `https://search.d3.nhle.com/api/v1/search/player?culture=en-us&limit=5&q=${encodeURIComponent(name)}&active=true`;
    const data = await fetch(url).then(r => r.json());
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// MLB player season stats + last 10 games
app.get("/mlb/player/:playerId", async (req, res) => {
  try {
    const { playerId } = req.params;
    const season = new Date().getFullYear();
    const [hitting, pitching, gameLog] = await Promise.all([
      fetch(`${MLB_BASE}/people/${playerId}/stats?stats=season&season=${season}&group=hitting`).then(r => r.json()),
      fetch(`${MLB_BASE}/people/${playerId}/stats?stats=season&season=${season}&group=pitching`).then(r => r.json()),
      fetch(`${MLB_BASE}/people/${playerId}/stats?stats=gameLog&season=${season}&group=hitting`).then(r => r.json())
    ]);
    res.json({ hitting, pitching, gameLog });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// MLB player search
app.get("/mlb/search/:name", async (req, res) => {
  try {
    const { name } = req.params;
    const url = `${MLB_BASE}/people/search?names=${encodeURIComponent(name)}&sportId=1&active=true`;
    const data = await fetch(url).then(r => r.json());
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/", (req, res) => res.json({ status: "OddsWatch API running" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
