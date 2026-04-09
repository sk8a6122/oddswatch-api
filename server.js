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

// H2H schedule for a team
app.get("/schedule/:abbrev/:season", async (req, res) => {
  try {
    const { abbrev, season } = req.params;
    const url = `${NHL_BASE}/club-schedule-season/${abbrev}/${season}`;
    const data = await fetch(url).then(r => r.json());
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Health check
app.get("/", (req, res) => res.json({ status: "OddsWatch API running" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
