const fs = require("fs");
const http = require("http");
const path = require("path");
const { execFile } = require("child_process");

const HOST = "127.0.0.1";
const PORT = process.env.PORT || 4321;
const PUBLIC_DIR = path.join(__dirname, "public");
const BEARER_TOKEN =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

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

function escapeForAppleScript(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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

function buildFetchScript(username) {
  const markdownKey = "codex_following_md_export";
  const metaKey = "codex_following_meta_export";
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
        const handles = [];
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
              handles.push("@" + user.screen_name);
            }
          }
          const nextCursor = Number(data.next_cursor_str || 0);
          cursor = Number.isFinite(nextCursor) ? nextCursor : 0;
          guard += 1;
        }
        const uniqueHandles = [...new Set(handles)];
        const markdown = [
          "# X Following",
          "",
          "Source: @" + username,
          "Exported at: " + new Date().toISOString(),
          "Total: " + uniqueHandles.length,
          "",
          ...uniqueHandles.map((handle) => "- " + handle)
        ].join("\\n");
        localStorage.setItem(${JSON.stringify(markdownKey)}, markdown);
        localStorage.setItem(${JSON.stringify(metaKey)}, JSON.stringify({
          username,
          total: uniqueHandles.length,
          length: markdown.length
        }));
        location.hash = "READY_" + uniqueHandles.length + "_" + markdown.length;
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
      const text = localStorage.getItem("codex_following_md_export") || "";
      location.hash = "CHUNK_${start}_" + encodeURIComponent(text.slice(${start}, ${end}));
    })();
    void 0;
  `;
  return `javascript:${js.replace(/\n\s*/g, " ")}`;
}

async function collectMarkdown(totalLength) {
  const chunkSize = 1200;
  let markdown = "";

  for (let offset = 0; offset < totalLength; offset += chunkSize) {
    const end = Math.min(totalLength, offset + chunkSize);
    await setArcUrl(buildChunkScript(offset, end));
    await sleep(700);
    const currentUrl = await getArcUrl();
    const marker = `#CHUNK_${offset}_`;
    const markerIndex = currentUrl.indexOf(marker);
    if (markerIndex === -1) {
      throw new Error(`Failed to read chunk at offset ${offset}.`);
    }
    markdown += decodeURIComponent(currentUrl.slice(markerIndex + marker.length));
  }

  return markdown;
}

async function exportFollowing(usernameInput) {
  const username = sanitizeUsername(usernameInput);
  const initialState = await getArcActiveTabState();

  try {
    await setArcUrl("https://x.com/home");
    await sleep(3000);
    await setArcUrl(buildFetchScript(username));

    const { hash } = await pollArcHash(["READY_", "ERR_"], 120000);
    if (hash.startsWith("ERR_")) {
      throw new Error(decodeURIComponent(hash.slice(4)));
    }

    const [, totalText, lengthText] = hash.match(/^READY_(\d+)_(\d+)$/) || [];
    if (!totalText || !lengthText) {
      throw new Error(`Unexpected Arc response: ${hash}`);
    }

    const total = Number(totalText);
    const markdownLength = Number(lengthText);
    const markdown = await collectMarkdown(markdownLength);

    return {
      username,
      total,
      markdown,
      filename: `${username}-following-${new Date().toISOString().slice(0, 10)}.md`,
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

    if (req.method === "POST" && req.url === "/api/export") {
      const rawBody = await readRequestBody(req);
      const body = rawBody ? JSON.parse(rawBody) : {};
      const result = await exportFollowing(body.username);
      sendJson(res, 200, result);
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
  console.log(`x-following-markdown-exporter listening on http://${HOST}:${PORT}`);
});
