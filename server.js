const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());

const NHL_BASE = "https://api-web.nhle.com/v1";
const NHL_STATS = "https://api.nhle.com/stats/rest/en";
const MLB_BASE = "https://statsapi.mlb.com/api/v1";

// Goalie stats for a team
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

// NHL H2H schedule
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

// MLB today's games with probable pitchers
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

// MLB pitcher stats by player ID
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

// MLB H2H - last 5 games between two teams this season
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

// Health check
app.get("/", (req, res) => res.json({ status: "OddsWatch API running" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
