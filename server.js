app.get("/schedule/:abbrev/:season", async (req, res) => {
  try {
    const { abbrev, season } = req.params;
    const url = `${NHL_BASE}/club-schedule-season/${abbrev}/${season}`;
    const data = await fetch(url).then(r => r.json());

    // Also try fetching past schedule to get full season
    const pastUrl = `${NHL_BASE}/club-schedule-season/${abbrev}/now`;
    const pastData = await fetch(pastUrl).then(r => r.json()).catch(() => ({ games: [] }));

    // Merge both, deduplicate by game id
    const allGames = [...(data.games || []), ...(pastData.games || [])];
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
