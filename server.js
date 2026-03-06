const fs = require("fs");
const http = require("http");
const path = require("path");
const { execFile } = require("child_process");

const HOST = "127.0.0.1";
const PORT = process.env.PORT || 4321;
const PUBLIC_DIR = path.join(__dirname, "public");
const BEARER_TOKEN =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const EXPORT_KEY = "codex_following_export_payload";
const jobs = new Map();

const TOPIC_RULES = [
  { label: "AI", patterns: [" ai ", "llm", "agent", "genai", "machine learning", "artificial intelligence"] },
  { label: "Robotics", patterns: ["robot", "robotics", "humanoid", "autonomy", "autonomous"] },
  { label: "Infra", patterns: ["infra", "platform", "api", "developer tools", "open source", "tooling"] },
  { label: "Investing", patterns: ["investor", "vc", "venture", "angel", "capital", "fund"] },
  { label: "Research", patterns: ["research", "scientist", "lab", "phd", "paper", "alignment"] },
  { label: "Design", patterns: ["design", "designer", "creative", "visual", "brand"] },
  { label: "Media", patterns: ["writer", "journalist", "newsletter", "media", "podcast"] },
  { label: "Founder", patterns: ["founder", "co-founder", "building", "startup", "entrepreneur"] },
];

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function runAppleScript(lines) {
  const args = [];
  for (const line of lines) {
    args.push("-e", line);
  }

  return new Promise((resolve, reject) => {
    execFile("osascript", args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 4 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }

      resolve(stdout.trim());
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeUsername(value) {
  const trimmed = String(value || "").trim().replace(/^@+/, "");
  if (!/^[A-Za-z0-9_]{1,15}$/.test(trimmed)) {
    throw new Error("Username must be 1-15 characters using letters, numbers, or underscore.");
  }
  return trimmed;
}

function sanitizeUsernameList(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[\n,\s]+/)
        .map((item) => item.trim())
        .filter(Boolean);

  const usernames = [...new Set(raw.map(sanitizeUsername))];
  if (usernames.length === 0) {
    throw new Error("Enter at least one username.");
  }
  if (usernames.length > 10) {
    throw new Error("Use up to 10 usernames per export.");
  }
  return usernames;
}

function escapeForAppleScript(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function normalizeBio(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyTopics(profile) {
  const haystack = ` ${String(profile.name || "").toLowerCase()} ${String(profile.bio || "").toLowerCase()} `;
  const labels = [];
  for (const rule of TOPIC_RULES) {
    if (rule.patterns.some((pattern) => haystack.includes(pattern))) {
      labels.push(rule.label);
    }
  }
  return labels;
}

function computeDiscoveryScore(profile, seedCount) {
  const overlapWeight = (profile.followed_by_count || 0) * 1000;
  const topicWeight = (profile.topic_labels?.length || 0) * 35;
  const bioWeight = profile.bio ? 15 : 0;
  const verifiedPenalty = profile.verified ? 20 : 0;
  const protectedPenalty = profile.protected ? 40 : 0;
  const followerCount = Math.max(Number(profile.followers_count || 0), 0);
  const smallButRealBonus =
    followerCount >= 20 && followerCount <= 5000
      ? 120
      : followerCount > 5000 && followerCount <= 50000
        ? 45
        : followerCount < 20
          ? -80
          : -Math.min(220, Math.log10(followerCount + 1) * 55);
  const concentrationBonus = seedCount > 1 ? ((profile.followed_by_count || 0) / seedCount) * 160 : 0;

  return Math.round(overlapWeight + topicWeight + bioWeight + smallButRealBonus + concentrationBonus - verifiedPenalty - protectedPenalty);
}

function compareProfiles(left, right) {
  if ((right.followed_by_count || 0) !== (left.followed_by_count || 0)) {
    return (right.followed_by_count || 0) - (left.followed_by_count || 0);
  }
  if ((right.discovery_score || 0) !== (left.discovery_score || 0)) {
    return (right.discovery_score || 0) - (left.discovery_score || 0);
  }
  if ((left.followers_count || 0) !== (right.followers_count || 0)) {
    return (left.followers_count || 0) - (right.followers_count || 0);
  }
  return left.screen_name.localeCompare(right.screen_name);
}

function pickNotableAccounts(profiles) {
  return [...profiles]
    .sort(compareProfiles)
    .slice(0, 8)
    .map((profile) => ({
      screen_name: profile.screen_name,
      name: profile.name,
      bio: profile.bio,
      followers_count: profile.followers_count,
      topic_labels: profile.topic_labels,
      followed_by_count: profile.followed_by_count || 0,
      followed_by: profile.followed_by || [],
      discovery_score: profile.discovery_score || 0,
    }));
}

function buildTopicSummary(profiles) {
  const counts = new Map();
  for (const profile of profiles) {
    for (const label of profile.topic_labels) {
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 6)
    .map(([label, count]) => ({ label, count }));
}

function buildOutputs(usernames, profiles, overlapProfiles) {
  const exportedAt = new Date().toISOString();
  const topicSummary = buildTopicSummary(profiles);
  const notableAccounts = pickNotableAccounts(profiles);
  const sourceLine = usernames.length === 1 ? `Source: @${usernames[0]}` : `Sources: ${usernames.map((name) => `@${name}`).join(", ")}`;
  const overlapLines = overlapProfiles.slice(0, 25).map((profile) => {
    const extras = [];
    extras.push(`followed by ${profile.followed_by_count}/${usernames.length}`);
    extras.push(`score: ${profile.discovery_score}`);
    if (profile.topic_labels.length) extras.push(`topics: ${profile.topic_labels.join(", ")}`);
    if (profile.bio) extras.push(profile.bio);
    return `- @${profile.screen_name} — ${extras.join(" | ")}`;
  });

  const markdownLines = [
    "# X Following",
    "",
    sourceLine,
    `Exported at: ${exportedAt}`,
    `Total: ${profiles.length}`,
    `Overlap count: ${overlapProfiles.length}`,
    "",
    ...profiles.map((profile) => {
      const detailParts = [];
      if (profile.name) detailParts.push(profile.name);
      if (profile.bio) detailParts.push(profile.bio);
      if (profile.followers_count !== null) detailParts.push(`followers: ${profile.followers_count}`);
      if (profile.followed_by_count) detailParts.push(`followed_by: ${profile.followed_by_count}/${usernames.length}`);
      if (profile.discovery_score) detailParts.push(`score: ${profile.discovery_score}`);
      return `- @${profile.screen_name}${detailParts.length ? ` — ${detailParts.join(" | ")}` : ""}`;
    }),
  ];

  const briefLines = [
    `# Research Brief: ${usernames.map((name) => `@${name}`).join(", ")}`,
    "",
    `- Exported at: ${exportedAt}`,
    `- Seed accounts: ${usernames.length}`,
    `- Accounts analyzed: ${profiles.length}`,
    `- Overlap accounts: ${overlapProfiles.length}`,
    "- Ranking logic: prioritize multi-seed overlap first, then rank for small-but-important accounts.",
    "",
    "## Topic signals",
    ...(topicSummary.length
      ? topicSummary.map((item) => `- ${item.label}: ${item.count}`)
      : ["- No strong topic clusters detected from bios."]),
    "",
    "## Shared follow graph",
    ...(overlapLines.length ? overlapLines : ["- No overlapping followed accounts detected across the seed set."]),
    "",
    "## Potential hidden nodes",
    ...(notableAccounts.length
      ? notableAccounts.map((profile) => {
          const extras = [];
          if (profile.name) extras.push(profile.name);
          if (profile.followed_by_count) extras.push(`followed by ${profile.followed_by_count}/${usernames.length}`);
          extras.push(`score: ${profile.discovery_score}`);
          if (profile.topic_labels.length) extras.push(`topics: ${profile.topic_labels.join(", ")}`);
          extras.push(`followers: ${profile.followers_count}`);
          if (profile.bio) extras.push(profile.bio);
          return `- @${profile.screen_name} — ${extras.join(" | ")}`;
        })
      : ["- No notable hidden nodes detected."]),
  ];

  return {
    markdown: markdownLines.join("\n"),
    json: JSON.stringify(
      {
        source_usernames: usernames,
        exported_at: exportedAt,
        total: profiles.length,
        overlap_count: overlapProfiles.length,
        topic_summary: topicSummary,
        overlap_profiles: overlapProfiles,
        profiles,
      },
      null,
      2
    ),
    brief: briefLines.join("\n"),
    topicSummary,
    notableAccounts,
    overlapProfiles,
    exportedAt,
  };
}

async function getArcActiveTabState() {
  const output = await runAppleScript([
    'tell application "Arc" to get {title, URL} of active tab of front window',
  ]);
  const parts = output.split(", ");
  const title = parts.shift() || "";
  const url = parts.join(", ");
  return { title, url };
}

async function setArcUrl(url) {
  await runAppleScript([
    `tell application "Arc" to set URL of active tab of front window to "${escapeForAppleScript(url)}"`,
  ]);
}

async function getArcUrl() {
  return runAppleScript([
    'tell application "Arc" to get URL of active tab of front window',
  ]);
}

async function pollArcHash(prefixes, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const currentUrl = await getArcUrl();
    const hash = currentUrl.split("#")[1] || "";
    for (const prefix of prefixes) {
      if (hash.startsWith(prefix)) {
        return { currentUrl, hash };
      }
    }
    await sleep(1000);
  }

  throw new Error("Timed out waiting for Arc to finish exporting.");
}

function createJob() {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const job = {
    id,
    status: "queued",
    stage: "Queued",
    progress: 0,
    createdAt: Date.now(),
    result: null,
    error: null,
  };
  jobs.set(id, job);
  return job;
}

function updateJob(job, patch) {
  Object.assign(job, patch, { updatedAt: Date.now() });
}

function buildFetchScript(username) {
  const js = `
    (async () => {
      try {
        const username = ${JSON.stringify(username)};
        const ct0 = document.cookie.match(/(?:^|; )ct0=([^;]+)/)?.[1] || "";
        const headers = {
          authorization: "Bearer ${BEARER_TOKEN}",
          "x-csrf-token": ct0,
          "x-twitter-active-user": "yes",
          "x-twitter-auth-type": "OAuth2Session",
          "x-twitter-client-language": "en"
        };
        let cursor = -1;
        let guard = 0;
        const profiles = [];
        while (cursor !== 0 && guard < 200) {
          const endpoint = "https://api.x.com/1.1/friends/list.json?screen_name=" + encodeURIComponent(username) + "&count=200&skip_status=true&include_user_entities=false&cursor=" + cursor;
          const response = await fetch(endpoint, { credentials: "include", headers });
          if (!response.ok) {
            const text = await response.text();
            throw new Error("HTTP_" + response.status + "_" + text.slice(0, 200));
          }
          const data = await response.json();
          const users = Array.isArray(data.users) ? data.users : [];
          for (const user of users) {
            if (user && user.screen_name) {
              profiles.push({
                screen_name: user.screen_name,
                name: user.name || "",
                bio: user.description || "",
                location: user.location || "",
                url: user.url || "",
                verified: Boolean(user.verified),
                protected: Boolean(user.protected),
                followers_count: Number(user.followers_count || 0),
                friends_count: Number(user.friends_count || 0),
                statuses_count: Number(user.statuses_count || 0),
                created_at: user.created_at || "",
              });
            }
          }
          const nextCursor = Number(data.next_cursor_str || 0);
          cursor = Number.isFinite(nextCursor) ? nextCursor : 0;
          guard += 1;
        }
        const deduped = [];
        const seen = new Set();
        for (const profile of profiles) {
          if (seen.has(profile.screen_name)) continue;
          seen.add(profile.screen_name);
          deduped.push(profile);
        }
        const payload = JSON.stringify({
          username,
          total: deduped.length,
          profiles: deduped
        });
        localStorage.setItem(${JSON.stringify(EXPORT_KEY)}, payload);
        location.hash = "READY_" + deduped.length + "_" + payload.length;
      } catch (error) {
        location.hash = "ERR_" + encodeURIComponent(String(error));
      }
    })();
    void 0;
  `;
  return `javascript:${js.replace(/\n\s*/g, " ")}`;
}

function buildChunkScript(start, end) {
  const js = `
    (() => {
      const text = localStorage.getItem(${JSON.stringify(EXPORT_KEY)}) || "";
      location.hash = "CHUNK_${start}_" + encodeURIComponent(text.slice(${start}, ${end}));
    })();
    void 0;
  `;
  return `javascript:${js.replace(/\n\s*/g, " ")}`;
}

async function collectExportPayload(totalLength, onProgress) {
  const chunkSize = 6000;
  let payload = "";
  const totalChunks = Math.max(1, Math.ceil(totalLength / chunkSize));
  let chunkIndex = 0;

  for (let offset = 0; offset < totalLength; offset += chunkSize) {
    const end = Math.min(totalLength, offset + chunkSize);
    await setArcUrl(buildChunkScript(offset, end));
    await sleep(220);
    const currentUrl = await getArcUrl();
    const marker = `#CHUNK_${offset}_`;
    const markerIndex = currentUrl.indexOf(marker);
    if (markerIndex === -1) {
      throw new Error(`Failed to read chunk at offset ${offset}.`);
    }
    payload += decodeURIComponent(currentUrl.slice(markerIndex + marker.length));
    chunkIndex += 1;
    if (onProgress) {
      onProgress({
        stage: `Reading exported payload chunks (${chunkIndex}/${totalChunks})`,
        progress: 55 + Math.round((chunkIndex / totalChunks) * 35),
      });
    }
  }

  return payload;
}

function normalizeProfiles(rawProfiles) {
  return (rawProfiles || []).map((profile) => ({
    screen_name: profile.screen_name,
    name: String(profile.name || ""),
    bio: normalizeBio(profile.bio),
    location: String(profile.location || ""),
    url: String(profile.url || ""),
    verified: Boolean(profile.verified),
    protected: Boolean(profile.protected),
    followers_count: Number(profile.followers_count || 0),
    friends_count: Number(profile.friends_count || 0),
    statuses_count: Number(profile.statuses_count || 0),
    created_at: String(profile.created_at || ""),
    topic_labels: classifyTopics({
      name: profile.name,
      bio: profile.bio,
    }),
  }));
}

async function exportSingleFollowing(username, onProgress, sourceIndex, sourceTotal) {
  if (onProgress) {
    onProgress({
      stage: `Fetching @${username} (${sourceIndex}/${sourceTotal})`,
      progress: Math.min(50, 5 + Math.round(((sourceIndex - 1) / sourceTotal) * 45)),
    });
  }
  await setArcUrl(buildFetchScript(username));

  const { hash } = await pollArcHash(["READY_", "ERR_"], 120000);
  if (hash.startsWith("ERR_")) {
    throw new Error(`@${username}: ${decodeURIComponent(hash.slice(4))}`);
  }

  const [, totalText, lengthText] = hash.match(/^READY_(\d+)_(\d+)$/) || [];
  if (!totalText || !lengthText) {
    throw new Error(`Unexpected Arc response: ${hash}`);
  }

  if (onProgress) {
    onProgress({
      stage: `Collecting result payload for @${username}`,
      progress: Math.min(60, 10 + Math.round((sourceIndex / sourceTotal) * 50)),
    });
  }

  const rawPayload = await collectExportPayload(Number(lengthText), onProgress);
  const parsedPayload = JSON.parse(rawPayload);

  return {
    username,
    total: Number(totalText),
    profiles: normalizeProfiles(parsedPayload.profiles),
  };
}

async function exportFollowing(usernamesInput, onProgress) {
  const usernames = sanitizeUsernameList(usernamesInput);
  const initialState = await getArcActiveTabState();

  try {
    if (onProgress) {
      onProgress({
        stage: "Opening X in Arc",
        progress: 2,
      });
    }
    await setArcUrl("https://x.com/home");
    await sleep(3000);

    const exports = [];
    for (const [index, username] of usernames.entries()) {
      exports.push(await exportSingleFollowing(username, onProgress, index + 1, usernames.length));
      await sleep(800);
    }

    if (onProgress) {
      onProgress({
        stage: "Merging profiles and computing discovery ranking",
        progress: 92,
      });
    }

    const profileMap = new Map();
    for (const item of exports) {
      for (const profile of item.profiles) {
        const existing = profileMap.get(profile.screen_name);
        if (!existing) {
          profileMap.set(profile.screen_name, {
            ...profile,
            followed_by: [item.username],
          });
          continue;
        }
        if (!existing.followed_by.includes(item.username)) {
          existing.followed_by.push(item.username);
        }
        if ((!existing.bio || existing.bio.length < profile.bio.length) && profile.bio) {
          existing.bio = profile.bio;
        }
        if ((!existing.name || existing.name.length < profile.name.length) && profile.name) {
          existing.name = profile.name;
        }
        if (!existing.url && profile.url) existing.url = profile.url;
        if (!existing.location && profile.location) existing.location = profile.location;
        if (profile.followers_count > existing.followers_count) existing.followers_count = profile.followers_count;
        if (profile.friends_count > existing.friends_count) existing.friends_count = profile.friends_count;
        if (profile.statuses_count > existing.statuses_count) existing.statuses_count = profile.statuses_count;
        if (profile.verified) existing.verified = true;
        if (profile.protected) existing.protected = true;
        existing.topic_labels = [...new Set([...(existing.topic_labels || []), ...(profile.topic_labels || [])])];
      }
    }

    const profiles = [...profileMap.values()]
      .map((profile) => ({
        ...profile,
        followed_by: [...profile.followed_by].sort(),
        followed_by_count: profile.followed_by.length,
        discovery_score: 0,
      }))
      .map((profile) => ({
        ...profile,
        discovery_score: computeDiscoveryScore(profile, usernames.length),
      }))
      .sort(compareProfiles);

    const overlapProfiles = profiles.filter((profile) => profile.followed_by_count > 1);
    const outputs = buildOutputs(usernames, profiles, overlapProfiles);
    const today = new Date().toISOString().slice(0, 10);
    const stem = usernames.length === 1 ? usernames[0] : `${usernames[0]}-and-${usernames.length - 1}-more`;

    return {
      usernames,
      total: profiles.length,
      overlapCount: overlapProfiles.length,
      sources: exports.map((item) => ({
        username: item.username,
        total: item.total,
      })),
      profiles,
      outputs,
      files: {
        markdown: `${stem}-following-${today}.md`,
        json: `${stem}-following-${today}.json`,
        brief: `${stem}-following-brief-${today}.md`,
      },
    };
  } finally {
    if (initialState.url) {
      try {
        await setArcUrl(initialState.url);
      } catch (error) {
        console.error("Failed to restore Arc tab:", error.message);
      }
    }
  }
}

function serveStatic(req, res) {
  const requestedPath = req.url === "/" ? "/index.html" : req.url;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") {
        sendText(res, 404, "Not found");
        return;
      }

      sendText(res, 500, "Internal server error");
      return;
    }

    const ext = path.extname(filePath);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
    };

    sendText(res, 200, content, types[ext] || "application/octet-stream");
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/jobs/")) {
      const jobId = req.url.split("/").pop();
      const job = jobs.get(jobId);
      if (!job) {
        sendJson(res, 404, { error: "Job not found" });
        return;
      }
      sendJson(res, 200, job);
      return;
    }

    if (req.method === "POST" && req.url === "/api/export") {
      const rawBody = await readRequestBody(req);
      const body = rawBody ? JSON.parse(rawBody) : {};
      const job = createJob();
      updateJob(job, {
        status: "running",
        stage: "Starting export",
        progress: 1,
      });

      exportFollowing(body.usernames || body.username, (patch) => updateJob(job, patch))
        .then((result) => {
          updateJob(job, {
            status: "completed",
            stage: "Completed",
            progress: 100,
            result,
          });
        })
        .catch((error) => {
          console.error(error);
          updateJob(job, {
            status: "failed",
            stage: "Failed",
            progress: 100,
            error: error.message || "Unknown error",
          });
        });

      sendJson(res, 202, { jobId: job.id });
      return;
    }

    if (req.method === "GET") {
      serveStatic(req, res);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: error.message || "Unknown error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`xfinder listening on http://${HOST}:${PORT}`);
});
