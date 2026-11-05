const fs = require("fs");

// 1. Fix binanceTradeStream.ts TS2531
const btsPath = "C:/AI-Hedge-Cockpit/web/lib/binanceTradeStream.ts";
let bts = fs.readFileSync(btsPath, "utf8");
const oldPing = `  public async sendTestPing(): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return { success: false, latencyMs: 0, error: "Socket not open" };
    }

    return new Promise((resolve) => {
      const pingStart = Date.now();
      const pingId = \`BN-TEST-\${pingStart}\`;

      const timer = setTimeout(() => {
        this.ws?.removeListener("message", handler);
        resolve({ success: false, latencyMs: 0, error: "Ping timeout" });
      }, 2000);

      const handler = (raw: WebSocket.Data) => {
        try {
          const data = JSON.parse(raw.toString());
          if (data.id === pingId) {
            clearTimeout(timer);
            this.ws?.removeListener("message", handler);
            const latency = Date.now() - pingStart;
            this.lastPingLatencyMs = latency;
            resolve({ success: true, latencyMs: latency });
          }
        } catch {}
      };

      this.ws.on("message", handler);

      try {
        this.ws.send(JSON.stringify({ id: pingId, method: "server.time" }));
      } catch (err: any) {
        clearTimeout(timer);
        this.ws.removeListener("message", handler);
        resolve({ success: false, latencyMs: 0, error: err.message });
      }
    });
  }`;

const newPing = `  public async sendTestPing(): Promise<{ success: boolean; latencyMs: number; error?: string }> {
    const socket = this.ws;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return { success: false, latencyMs: 0, error: "Socket not open" };
    }

    return new Promise((resolve) => {
      const pingStart = Date.now();
      const pingId = \`BN-TEST-\${pingStart}\`;

      const timer = setTimeout(() => {
        socket.removeListener("message", handler);
        resolve({ success: false, latencyMs: 0, error: "Ping timeout" });
      }, 2000);

      const handler = (raw: WebSocket.Data) => {
        try {
          const data = JSON.parse(raw.toString());
          if (data.id === pingId) {
            clearTimeout(timer);
            socket.removeListener("message", handler);
            const latency = Date.now() - pingStart;
            this.lastPingLatencyMs = latency;
            resolve({ success: true, latencyMs: latency });
          }
        } catch {}
      };

      socket.on("message", handler);

      try {
        socket.send(JSON.stringify({ id: pingId, method: "server.time" }));
      } catch (err: any) {
        clearTimeout(timer);
        socket.removeListener("message", handler);
        resolve({ success: false, latencyMs: 0, error: err.message });
      }
    });
  }`;

bts = bts.replace(oldPing, newPing);
fs.writeFileSync(btsPath, bts, "utf8");

// 2. Fix botEngine.ts resolveUserStoragePath import
const botEnginePath = "C:/AI-Hedge-Cockpit/web/lib/botEngine.ts";
let botEngine = fs.readFileSync(botEnginePath, "utf8");
botEngine = botEngine.replace(
  'import {\n  resolveDataFilePath,\n  readDataFile,',
  'import {\n  resolveDataFilePath,\n  resolveUserStoragePath,\n  readDataFile,'
);
fs.writeFileSync(botEnginePath, botEngine, "utf8");

// 3. Fix AutoBotPanel.tsx showToast
const abpPath = "C:/AI-Hedge-Cockpit/web/components/AutoBotPanel.tsx";
let abp = fs.readFileSync(abpPath, "utf8");
abp = abp.replace("const showToast = (msg: string) => {", "const showToast = (msg: string, type?: string) => {");
fs.writeFileSync(abpPath, abp, "utf8");

// 4. Fix PositionsTable.tsx Position interface
const ptPath = "C:/AI-Hedge-Cockpit/web/components/PositionsTable.tsx";
let pt = fs.readFileSync(ptPath, "utf8");
pt = pt.replace(
  "  isPaper?: boolean;\n}",
  "  isPaper?: boolean;\n  size?: number;\n  side?: string;\n  unrealisedPnl?: number;\n}"
);
fs.writeFileSync(ptPath, pt, "utf8");

console.log("All type errors patched!");
