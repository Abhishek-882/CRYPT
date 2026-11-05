const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "..", "web", "lib", "binanceSigner.ts");
let content = fs.readFileSync(filePath, "utf8");

content = content.replace(
  '  "https://www.binance.com",\r\n  "https://fapi.binance.com",',
  '  "https://fapi.binance.com",\r\n  "https://www.binance.com",'
).replace(
  '  "https://www.binance.com",\n  "https://fapi.binance.com",',
  '  "https://fapi.binance.com",\n  "https://www.binance.com",'
);

fs.writeFileSync(filePath, content, "utf8");
console.log("Updated binanceSigner.ts successfully!");
