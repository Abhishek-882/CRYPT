const fs = require("fs");

const ptPath = "C:/AI-Hedge-Cockpit/web/components/PositionsTable.tsx";
let pt = fs.readFileSync(ptPath, "utf8");

pt = pt.replace(
  /interface Position \{[\s\S]*?\}/,
  `interface Position {
  venue?: string;
  symbol: string;
  amount: number;
  entryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  leverage: number;
  isPaper?: boolean;
  size?: number;
  side?: string;
  unrealisedPnl?: number;
}`
);

fs.writeFileSync(ptPath, pt, "utf8");
console.log("PositionsTable.tsx patched!");
