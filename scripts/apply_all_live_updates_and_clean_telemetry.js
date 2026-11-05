const fs = require("fs");
const path = require("path");

// ===============================================
// 1. Patch web/lib/botEngine.ts
// ===============================================
const botEnginePath = path.resolve("C:/AI-Hedge-Cockpit/web/lib/botEngine.ts");
let botEngine = fs.readFileSync(botEnginePath, "utf8").replace(/\r\n/g, "\n");

// Add tenantStateSignatures to globalForBot
if (!botEngine.includes("tenantStateSignatures?:")) {
  botEngine = botEngine.replace(
    "  tenantStates?: Record<string, BotEngineState>;\n  tenantLocks?: Set<string>;",
    "  tenantStates?: Record<string, BotEngineState>;\n  tenantStateSignatures?: Record<string, string>;\n  tenantLocks?: Set<string>;"
  );
  botEngine = botEngine.replace(
    "if (!globalForBot.tenantStates) {\n  globalForBot.tenantStates = {};\n}",
    "if (!globalForBot.tenantStates) {\n  globalForBot.tenantStates = {};\n}\nif (!globalForBot.tenantStateSignatures) {\n  globalForBot.tenantStateSignatures = {};\n}"
  );
}

// Add getBotStateFileSignature function before loadBotState
const sigFunc = `function getBotStateFileSignature(userId?: string): string {
  try {
    let sig = "0_0";
    if (userId && userId !== "global_default") {
      const userFilePath = resolveUserStoragePath(userId, STATE_FILE_NAME);
      if (fs.existsSync(userFilePath)) {
        const stat = fs.statSync(userFilePath);
        sig = \`\${stat.mtimeMs}_\${stat.size}\`;
      }
    }
    const globalFilePath = resolveDataFilePath(STATE_FILE_NAME);
    if (fs.existsSync(globalFilePath)) {
      const gStat = fs.statSync(globalFilePath);
      sig += \`|\${gStat.mtimeMs}_\${gStat.size}\`;
    }
    return sig;
  } catch {}
  return "0_0";
}

export function loadBotState(userId?: string, forceDiskRead: boolean = false): BotEngineState {
  const tenantKey = userId || "usr_admin_varsha";
  const diskSig = getBotStateFileSignature(userId);

  if (
    !forceDiskRead &&
    globalForBot.tenantStates?.[tenantKey] &&
    globalForBot.tenantStateSignatures?.[tenantKey] === diskSig &&
    diskSig !== "0_0"
  ) {
    return globalForBot.tenantStates[tenantKey];
  }`;

if (!botEngine.includes("function getBotStateFileSignature")) {
  botEngine = botEngine.replace(
    `export function loadBotState(userId?: string): BotEngineState {
  const tenantKey = userId || "usr_admin_varsha";

  if (globalForBot.tenantStates?.[tenantKey]) {
    return globalForBot.tenantStates[tenantKey];
  }`,
    sigFunc
  );
}

// Update loadBotState returning block to record diskSig
botEngine = botEngine.replace(
  `      globalForBot.tenantStates![tenantKey] = state;\n      if (!userId || userId === "usr_admin_varsha") {\n        globalForBot.botEngineState = state;\n      }\n      return state;`,
  `      globalForBot.tenantStates![tenantKey] = state;\n      globalForBot.tenantStateSignatures![tenantKey] = diskSig;\n      if (!userId || userId === "usr_admin_varsha") {\n        globalForBot.botEngineState = state;\n      }\n      return state;`
);

// Update saveBotState to update tenantStateSignatures
botEngine = botEngine.replace(
  `  globalForBot.tenantStates![tenantKey] = state;\n\n  if (userId && userId !== "usr_admin_varsha" && userId !== "global_default") {`,
  `  globalForBot.tenantStates![tenantKey] = state;\n  globalForBot.tenantStateSignatures![tenantKey] = getBotStateFileSignature(userId);\n\n  if (userId && userId !== "usr_admin_varsha" && userId !== "global_default") {`
);

fs.writeFileSync(botEnginePath, botEngine, "utf8");
console.log("botEngine.ts updated with reactive disk signature tracking");

// ===============================================
// 2. Patch web/app/api/bot/daemon/route.ts
// ===============================================
const routePath = path.resolve("C:/AI-Hedge-Cockpit/web/app/api/bot/daemon/route.ts");
let routeContent = fs.readFileSync(routePath, "utf8").replace(/\r\n/g, "\n");

// Force disk read in GET handler
routeContent = routeContent.replace(
  "  const state = loadBotState(userId);",
  "  const state = loadBotState(userId, true);"
);

// Add anti-cache headers to GET response
const getTarget = `  return NextResponse.json({
    success: true,
    daemon: {
      ...state,
      uptimeSeconds,
      serverTime: Date.now(),
      userId,
      userEmail: user?.email || "admin",
      statusText: state.isRunning
        ? activeBot?.enabled
          ? activeBot?.statusText || "RUNNING_24_7"
          : "PAUSED_BY_USER"
        : "STOPPED",
    },
  });`;

const getRepl = `  return NextResponse.json(
    {
      success: true,
      daemon: {
        ...state,
        uptimeSeconds,
        serverTime: Date.now(),
        userId,
        userEmail: user?.email || "admin",
        statusText: state.isRunning
          ? activeBot?.enabled
            ? activeBot?.statusText || "RUNNING_24_7"
            : "PAUSED_BY_USER"
          : "STOPPED",
      },
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
      },
    }
  );`;

if (routeContent.includes(getTarget)) {
  routeContent = routeContent.replace(getTarget, getRepl);
}

// Add anti-cache headers to POST return
const postTarget = `  return NextResponse.json({
    success: true,
    action,
    daemon: {
      ...state,
      uptimeSeconds,
      serverTime: Date.now(),
      userId,
      userEmail: user?.email || "admin",
      statusText: state.isRunning
        ? activeBot?.enabled
          ? activeBot?.statusText || "RUNNING_24_7"
          : "PAUSED_BY_USER"
        : "STOPPED",
    },
  });`;

const postRepl = `  return NextResponse.json(
    {
      success: true,
      action,
      daemon: {
        ...state,
        uptimeSeconds,
        serverTime: Date.now(),
        userId,
        userEmail: user?.email || "admin",
        statusText: state.isRunning
          ? activeBot?.enabled
            ? activeBot?.statusText || "RUNNING_24_7"
            : "PAUSED_BY_USER"
          : "STOPPED",
      },
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
      },
    }
  );`;

if (routeContent.includes(postTarget)) {
  routeContent = routeContent.replace(postTarget, postRepl);
}

fs.writeFileSync(routePath, routeContent, "utf8");
console.log("route.ts updated with forced disk reading and anti-cache headers");

// ===============================================
// 3. Patch web/components/AutoBotPanel.tsx
// ===============================================
const panelPath = path.resolve("C:/AI-Hedge-Cockpit/web/components/AutoBotPanel.tsx");
let panelContent = fs.readFileSync(panelPath, "utf8").replace(/\r\n/g, "\n");

// Add timestamp query parameter and anti-cache headers to client fetchStatus
panelContent = panelContent.replace(
  '      const res = await fetch("/api/bot/daemon", { cache: "no-store" });',
  '      const res = await fetch(`/api/bot/daemon?_t=${Date.now()}`, { cache: "no-store", headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" } });'
);

// Clean Close Telemetry: TRUE DATA ONLY - NEVER copy entry latency!
const oldCloseTelemetry = `                      {/* Unwind / Close Telemetry (if available) */}
                      {(item.closeLeg1PlacedAt || item.closeLeg2PlacedAt || isClosed) && (
                        <div className="bg-zinc-900/30 p-2.5 rounded-lg border border-zinc-850/60 space-y-1.5 text-[10px]">
                          <div className="text-zinc-400 font-bold uppercase tracking-wider flex items-center justify-between">
                            <span>UNWIND / CLOSE TELEMETRY</span>
                            <span className="text-zinc-500">{item.closeTime ? new Date(item.closeTime).toLocaleTimeString() : "Closed"}</span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            <div>
                              Close {item.venueA || "CoinDCX"}: <strong className="text-cyan-400">{closeLeg1PlacedStr}</strong> ({item.closeLeg1LatencyMs !== undefined ? \`\${item.closeLeg1LatencyMs}ms\` : (item.leg1LatencyMs !== undefined ? \`\${item.leg1LatencyMs}ms\` : "260ms")})
                            </div>
                            <div>
                              Close {item.venueB || "Bybit"}: <strong className="text-amber-400">{closeLeg2PlacedStr}</strong> ({item.closeLeg2LatencyMs !== undefined ? \`\${item.closeLeg2LatencyMs}ms\` : (item.leg2LatencyMs !== undefined ? \`\${item.leg2LatencyMs}ms\` : "75ms")})
                            </div>
                            <div>
                              Close Skew: <strong className="text-zinc-100">{closeInterLegSkew !== null ? \`\${closeInterLegSkew} ms\` : "15 ms"}</strong>
                            </div>
                          </div>
                        </div>
                      )}`;

const newCloseTelemetry = `                      {/* Unwind / Close Telemetry (True Measured Exchange Data) */}
                      {(item.closeLeg1PlacedAt || item.closeLeg2PlacedAt || isClosed) && (
                        <div className="bg-zinc-900/30 p-2.5 rounded-lg border border-zinc-850/60 space-y-1.5 text-[10px]">
                          <div className="text-zinc-400 font-bold uppercase tracking-wider flex items-center justify-between">
                            <span>UNWIND / CLOSE TELEMETRY</span>
                            <span className="text-zinc-500">{item.closeTime ? new Date(item.closeTime).toLocaleTimeString() : "Closed"}</span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            <div>
                              Close {item.venueA || "CoinDCX"}:{" "}
                              <strong className="text-cyan-400">{item.closeLeg1PlacedAt ? formatMillisecondTime(item.closeLeg1PlacedAt) : (item.closeTime ? formatMillisecondTime(item.closeTime) : "—")}</strong>{" "}
                              {item.closeLeg1LatencyMs !== undefined ? (
                                <span className="text-zinc-300 font-semibold">({item.closeLeg1LatencyMs}ms)</span>
                              ) : (
                                <span className="text-zinc-500 italic">[Manual Exit]</span>
                              )}
                            </div>
                            <div>
                              Close {item.venueB || "Bybit"}:{" "}
                              <strong className="text-amber-400">{item.closeLeg2PlacedAt ? formatMillisecondTime(item.closeLeg2PlacedAt) : (item.closeTime ? formatMillisecondTime(item.closeTime) : "—")}</strong>{" "}
                              {item.closeLeg2LatencyMs !== undefined ? (
                                <span className="text-zinc-300 font-semibold">({item.closeLeg2LatencyMs}ms)</span>
                              ) : (
                                <span className="text-zinc-500 italic">[Manual Exit]</span>
                              )}
                            </div>
                            <div>
                              Close Skew:{" "}
                              {item.closeInterLegDeltaMs !== undefined ? (
                                <strong className="text-zinc-100">{item.closeInterLegDeltaMs} ms</strong>
                              ) : (
                                <span className="text-zinc-500 italic">Manual Flat</span>
                              )}
                            </div>
                          </div>
                        </div>
                      )}`;

if (panelContent.includes(oldCloseTelemetry)) {
  panelContent = panelContent.replace(oldCloseTelemetry, newCloseTelemetry);
  console.log("AutoBotPanel.tsx patched with authentic telemetry display");
} else {
  console.log("Could not find oldCloseTelemetry directly; checking variations");
}

fs.writeFileSync(panelPath, panelContent, "utf8");
console.log("AutoBotPanel.tsx saved.");
