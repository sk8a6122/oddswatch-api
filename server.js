const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();
app.use(cors());

const NHL_BASE = "https://api-web.nhle.com/v1";
const NHL_STATS = "https://api.nhle.com/stats/rest/en";

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

// H2H schedule for a team — fetches full season
app.get("/schedule/:abbrev/:season", async (req, res) => {
  try {
    const { abbrev, season } = req.params;

    // Fetch full season schedule
    const seasonUrl = `${NHL_BASE}/club-schedule-season/${abbrev}/${season}`;
    const seasonData = await fetch(seasonUrl).then(r => r.json()).catch(() => ({ games: [] }));

    // Also fetch current week in case season endpoint is incomplete
    const nowUrl = `${NHL_BASE}/club-schedule-season/${abbrev}/now`;
    const nowData = await fetch(nowUrl).then(r => r.json()).catch(() => ({ games: [] }));

    // Merge and deduplicate by game id
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

// Health check
app.get("/", (req, res) => res.json({ status: "OddsWatch API running" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
