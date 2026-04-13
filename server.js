const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { createClient } = require("@supabase/supabase-js");

const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

app.use("/webhook/stripe", express.raw({ type: "application/json" }));
app.use(cors());
app.use(express.json());

const NHL_BASE = "https://api-web.nhle.com/v1";
const NHL_STATS = "https://api.nhle.com/stats/rest/en";
const MLB_BASE = "https://statsapi.mlb.com/api/v1";
const SITE_URL = "https://sk8a6122.github.io/oddswatch-api";

// ── Stripe checkout ───────────────────────────────────
app.post("/checkout", async (req, res) => {
  try {
    const { priceId, userId, email, promoCode, tier } = req.body;
    let discountParams = {};
    let promoData = null;

    if (promoCode) {
      const { data: promo } = await supabase.from("promo_codes").select("*").eq("code", promoCode.toUpperCase()).eq("active", true).single();
      if (!promo) return res.status(400).json({ error: "Invalid promo code" });
      if (promo.expires_at && new Date(promo.expires_at) < new Date()) return res.status(400).json({ error: "Promo code expired" });
      if (promo.max_uses && promo.uses_count >= promo.max_uses) return res.status(400).json({ error: "Promo code used up" });
      if (!promo.applicable_tiers.includes(tier)) return res.status(400).json({ error: "Code not valid for this tier" });
      promoData = promo;

      if (promo.discount_type === "percent") {
        const coupon = await stripe.coupons.create({ percent_off: promo.discount_value, duration: "once" });
        discountParams = { discounts: [{ coupon: coupon.id }] };
      } else if (promo.discount_type === "fixed") {
        const coupon = await stripe.coupons.create({ amount_off: promo.discount_value * 100, currency: "usd", duration: "once" });
        discountParams = { discounts: [{ coupon: coupon.id }] };
      } else if (promo.discount_type === "free_trial") {
        discountParams = { subscription_data: { trial_period_days: promo.discount_value } };
      }
    }

    let customerId;
    const { data: profile } = await supabase.from("profiles").select("stripe_customer_id").eq("id", userId).single();
    if (profile?.stripe_customer_id) {
      customerId = profile.stripe_customer_id;
    } else {
      const customer = await stripe.customers.create({ email, metadata: { supabase_uid: userId } });
      customerId = customer.id;
      await supabase.from("profiles").update({ stripe_customer_id: customerId }).eq("id", userId);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      success_url: `${SITE_URL}?success=true&tier=${tier}`,
      cancel_url: `${SITE_URL}?canceled=true`,
      metadata: { userId, tier, promoCode: promoCode || "" },
      ...discountParams
    });

    if (promoData) {
      await supabase.from("promo_codes").update({ uses_count: promoData.uses_count + 1 }).eq("id", promoData.id);
    }

    res.json({ url: session.url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Tip checkout ──────────────────────────────────────
app.post("/tip", async (req, res) => {
  try {
    const { priceId, customAmount, email } = req.body;
    let line_items;

    if (customAmount) {
      const amount = Math.round(parseFloat(customAmount) * 100);
      if (amount < 100) return res.status(400).json({ error: "Minimum tip is $1" });
      if (amount > 100000) return res.status(400).json({ error: "Maximum tip is $1,000" });
      line_items = [{
        price_data: {
          currency: "usd",
          product_data: { name: "Support the Creator ❤️", description: "Thank you for supporting ChaseTheOdds!" },
          unit_amount: amount
        },
        quantity: 1
      }];
    } else {
      line_items = [{ price: priceId, quantity: 1 }];
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items,
      mode: "payment",
      success_url: `${SITE_URL}?tipped=true`,
      cancel_url: `${SITE_URL}`,
      customer_email: email || undefined
    });

    res.json({ url: session.url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Stripe webhook ────────────────────────────────────
app.post("/webhook/stripe", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error("Webhook error:", e.message);
    return res.status(400).send(`Webhook error: ${e.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    if (session.mode === "subscription") {
      const { userId, tier } = session.metadata;
      console.log(`Updating tier for ${userId} to ${tier}`);
      await supabase.from("profiles").update({
        tier,
        stripe_subscription_id: session.subscription,
        subscription_status: "active"
      }).eq("id", userId);
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object;
    const { data: profile } = await supabase.from("profiles").select("id").eq("stripe_subscription_id", sub.id).single();
    if (profile) {
      await supabase.from("profiles").update({ tier: "free", subscription_status: "inactive" }).eq("id", profile.id);
    }
  }

  res.json({ received: true });
});

// ── Promo validate ────────────────────────────────────
app.post("/promo/validate", async (req, res) => {
  try {
    const { code, tier } = req.body;
    const { data: promo } = await supabase.from("promo_codes").select("*").eq("code", code.toUpperCase()).eq("active", true).single();
    if (!promo) return res.json({ valid: false, message: "Invalid promo code" });
    if (promo.expires_at && new Date(promo.expires_at) < new Date()) return res.json({ valid: false, message: "Promo code expired" });
    if (promo.max_uses && promo.uses_count >= promo.max_uses) return res.json({ valid: false, message: "Promo code used up" });
    if (!promo.applicable_tiers.includes(tier)) return res.json({ valid: false, message: "Code not valid for this tier" });
    let description = "";
    if (promo.discount_type === "percent") description = promo.discount_value === 100 ? "100% off — free!" : `${promo.discount_value}% off`;
    else if (promo.discount_type === "fixed") description = `$${promo.discount_value} off`;
    else if (promo.discount_type === "free_trial") description = `${promo.discount_value} day free trial`;
    res.json({ valid: true, discount_type: promo.discount_type, discount_value: promo.discount_value, description });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Feedback ──────────────────────────────────────────
app.post("/feedback", async (req, res) => {
  try {
    const { userId, email, type, message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: "Message is required" });
    await supabase.from("feedback").insert({ user_id: userId || null, email: email || null, type: type || "feedback", message: message.trim() });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── User profile ──────────────────────────────────────
app.patch("/user/profile/:userId", async (req, res) => {
  try {
    const { bankroll, unit_pct, betting_style, odds_format, bankroll_period } = req.body;
    await supabase.from("profiles").update({
      bankroll, unit_pct, betting_style, odds_format, bankroll_period
    }).eq("id", req.params.userId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/user/profile/:userId", async (req, res) => {
  try {
    const { data } = await supabase.from("profiles").select("tier,subscription_status,stripe_customer_id,bankroll,unit_pct,betting_style,odds_format,bankroll_period").eq("id", req.params.userId).single();
    res.json(data || { tier: "free" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── NHL endpoints ─────────────────────────────────────
app.get("/goalie/:teamId/:season", async (req, res) => {
  try {
    const { teamId, season } = req.params;
    const url = `${NHL_STATS}/goalie/summary?limit=1&start=0&sort=wins&dir=DESC&cayenneExp=seasonId=${season}%20and%20teamId=${teamId}%20and%20gameTypeId=2`;
    const data = await fetch(url).then(r => r.json());
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/schedule/:abbrev/:season", async (req, res) => {
  try {
    const { abbrev, season } = req.params;
    const seasonData = await fetch(`${NHL_BASE}/club-schedule-season/${abbrev}/${season}`).then(r => r.json()).catch(() => ({ games: [] }));
    const nowData = await fetch(`${NHL_BASE}/club-schedule-season/${abbrev}/now`).then(r => r.json()).catch(() => ({ games: [] }));
    const allGames = [...(seasonData.games || []), ...(nowData.games || [])];
    const seen = new Set();
    const unique = allGames.filter(g => { if (seen.has(g.id)) return false; seen.add(g.id); return true; });
    res.json({ games: unique });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/nhl/roster/:abbrev", async (req, res) => {
  try {
    const data = await fetch(`${NHL_BASE}/roster/${req.params.abbrev}/20252026`).then(r => r.json());
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/nhl/player/:playerId", async (req, res) => {
  try {
    const { playerId } = req.params;
    const [seasonRes, gameLogRes] = await Promise.all([
      fetch(`${NHL_BASE}/player/${playerId}/landing`),
      fetch(`${NHL_BASE}/player/${playerId}/game-log/20252026/2`)
    ]);
    res.json({ season: await seasonRes.json(), gameLog: await gameLogRes.json() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/nhl/search/:name", async (req, res) => {
  try {
    const data = await fetch(`https://search.d3.nhle.com/api/v1/search/player?culture=en-us&limit=5&q=${encodeURIComponent(req.params.name)}&active=true`).then(r => r.json());
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MLB endpoints ─────────────────────────────────────
app.get("/mlb/roster/:teamId", async (req, res) => {
  try {
    const season = new Date().getFullYear();
    const data = await fetch(`${MLB_BASE}/teams/${req.params.teamId}/roster?season=${season}&rosterType=active`).then(r => r.json());
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/mlb/games", async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const data = await fetch(`${MLB_BASE}/schedule?sportId=1&date=${today}&hydrate=probablePitcher(stats),team,linescore`).then(r => r.json());
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/mlb/pitcher/:playerId", async (req, res) => {
  try {
    const season = new Date().getFullYear();
    const data = await fetch(`${MLB_BASE}/people/${req.params.playerId}/stats?stats=season&season=${season}&group=pitching`).then(r => r.json());
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

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
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/mlb/h2h/:awayId/:homeId", async (req, res) => {
  try {
    const { awayId, homeId } = req.params;
    const season = new Date().getFullYear();
    const data = await fetch(`${MLB_BASE}/schedule?sportId=1&season=${season}&teamId=${awayId}&opponent=${homeId}&gameType=R&hydrate=linescore,team`).then(r => r.json());
    const games = (data.dates || []).flatMap(d => d.games || []).filter(g => {
      const finished = g.status?.abstractGameState === "Final";
      const aId = g.teams?.away?.team?.id, hId = g.teams?.home?.team?.id;
      return finished && ((String(aId)===String(awayId)&&String(hId)===String(homeId))||(String(aId)===String(homeId)&&String(hId)===String(awayId)));
    }).slice(-5);
    res.json({ games });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/mlb/search/:name", async (req, res) => {
  try {
    const data = await fetch(`${MLB_BASE}/people/search?names=${encodeURIComponent(req.params.name)}&sportId=1&active=true`).then(r => r.json());
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Props ─────────────────────────────────────────────
app.get("/props/nhl/:gameId", async (req, res) => {
  try {
    const apiKey = process.env.ODDS_API_KEY;
    const markets = ["player_goal_scorer_first","player_goal_scorer_last","player_goal_scorer_anytime","player_goals","player_goals_alternate","player_assists","player_assists_alternate","player_points","player_points_alternate","player_power_play_points","player_power_play_points_alternate","player_shots_on_goal","player_shots_on_goal_alternate","player_blocked_shots","player_blocked_shots_alternate"].join(",");
    const data = await fetch(`https://api.the-odds-api.com/v4/sports/icehockey_nhl/events/${req.params.gameId}/odds?apiKey=${apiKey}&regions=us,us2&markets=${markets}&oddsFormat=decimal`).then(r => r.json());
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/props/mlb/:gameId", async (req, res) => {
  try {
    const apiKey = process.env.ODDS_API_KEY;
    const markets = ["batter_home_runs","batter_home_runs_alternate","batter_hits","batter_hits_alternate","batter_total_bases","batter_total_bases_alternate","batter_rbis","batter_rbis_alternate","batter_runs_scored","batter_stolen_bases","batter_walks","batter_strikeouts","pitcher_strikeouts","pitcher_strikeouts_alternate","pitcher_hits_allowed","pitcher_hits_allowed_alternate","pitcher_walks","pitcher_walks_alternate","pitcher_earned_runs"].join(",");
    const data = await fetch(`https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${req.params.gameId}/odds?apiKey=${apiKey}&regions=us,us2&markets=${markets}&oddsFormat=decimal`).then(r => r.json());
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/", (req, res) => res.json({ status: "ChaseTheOdds API running" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
