const fs = require("fs");
const path = require("path");

const basePath = "C:/AI-Hedge-Cockpit";

// 1. Update scripts/generate_client_presentation.js
const presPath = path.join(basePath, "scripts/generate_client_presentation.js");
let presCode = fs.readFileSync(presPath, "utf8");

// Update totalSlides default
presCode = presCode.replace(
  "function addSlideFooter(slide, currentSlide, totalSlides = 13)",
  "function addSlideFooter(slide, currentSlide, totalSlides = 14)"
);

// Define Slide 4 code
const slide4PresCode = `
  // =========================================================================
  // SLIDE 4: Exchange Commissions & Dual-Venue Fee Structure
  // =========================================================================
  {
    const s4 = pres.addSlide();
    s4.background = { color: C_BG_DARK };
    addSlideHeader(s4, 'Transparent Transaction Costs & Round-Trip Friction Breakdown', 'Exchange Commissions & Dual-Venue Fee Structure');

    s4.addShape(pres.ShapeType.roundRect, {
      x: 0.8, y: 1.5, w: 11.73, h: 0.65,
      fill: { color: C_CARD_DARK },
      line: { color: C_BORDER, width: 1 }
    });
    s4.addText('TRANSACTION FRICTION TRANSPARENCY: Delta-neutral arbitrage requires simultaneous two-legged market execution. The terminal accounts for Maker/Taker schedules across both venues to guarantee that entries are only triggered when the net funding harvest exceeds all round-trip commissions.', {
      x: 1.0, y: 1.55, w: 11.33, h: 0.55,
      fontSize: 9.2, fontFace: 'Calibri', color: C_CYAN_LT, leading: 1.25
    });

    const feeTableHeader = [
      { text: 'Exchange Venue', options: { bold: true, color: 'FFFFFF', fill: '1E293B' } },
      { text: 'Contract Type', options: { bold: true, color: 'FFFFFF', fill: '1E293B', align: 'center' } },
      { text: 'Maker Fee (Limit)', options: { bold: true, color: 'FFFFFF', fill: '1E293B', align: 'center' } },
      { text: 'Taker Fee (Market / Bot Default)', options: { bold: true, color: 'FFFFFF', fill: '1E293B', align: 'center' } },
      { text: 'Round-Trip Fee (Open + Close)', options: { bold: true, color: 'FFFFFF', fill: '1E293B', align: 'center' } }
    ];

    const feeTableRows = [
      [
        { text: 'Bybit', options: { bold: true } },
        { text: 'USDT Perpetual (VIP 0)', options: { align: 'center' } },
        { text: '0.020%', options: { align: 'center', color: '94A3B8' } },
        { text: '0.055%', options: { align: 'center', color: 'FBBF24', bold: true } },
        { text: '0.110% (Taker)', options: { align: 'center', color: 'F87171', bold: true } }
      ],
      [
        { text: 'CoinDCX', options: { bold: true } },
        { text: 'USDT Futures Contracts', options: { align: 'center' } },
        { text: '0.020%', options: { align: 'center', color: '94A3B8' } },
        { text: '0.050%', options: { align: 'center', color: 'FBBF24', bold: true } },
        { text: '0.100% (Taker)', options: { align: 'center', color: 'F87171', bold: true } }
      ],
      [
        { text: 'Combined Both Legs\\n(Dual-Venue Hedge)', options: { bold: true, color: '34D399', fill: '064E3B' } },
        { text: 'Dual-Venue Arbitrage\\nSimultaneous Fills', options: { align: 'center', color: '34D399', fill: '064E3B' } },
        { text: '0.040%\\n(Combined Maker)', options: { align: 'center', color: '34D399', fill: '064E3B' } },
        { text: '0.105% per side\\n(Market Entry)', options: { align: 'center', bold: true, color: '34D399', fill: '064E3B' } },
        { text: '~0.210% – 0.220% Total\\n(Full Round-Trip)', options: { align: 'center', bold: true, color: '34D399', fill: '064E3B' } }
      ]
    ];

    s4.addTable([feeTableHeader, ...feeTableRows], {
      x: 0.8, y: 2.3, w: 11.73, h: 2.5,
      colW: [2.53, 2.5, 2.0, 2.4, 2.3],
      fontSize: 9.5,
      fontFace: 'Calibri',
      color: C_TEXT_WHITE,
      fill: { color: '151E2E' },
      border: { pt: 0.5, color: C_BORDER }
    });

    const feeCallouts = [
      {
        title: 'DUAL-TAKER DEFAULT EXECUTION (~0.210%)',
        subtitle: 'ZERO LEG-DROP PROTECTION',
        color: C_AMBER_LT,
        desc: 'Simultaneous market orders eliminate leg-drop risk. The round-trip entry + exit cost across both venues is ~0.210% (0.105% in + 0.105% out), automatically factored into the bot\\'s entry gate calculations.'
      },
      {
        title: 'MINIMUM FUNDING SPREAD THRESHOLD',
        subtitle: 'PROFIT COMPOUNDING POLICY',
        color: C_EMERALD_LT,
        desc: 'Because combined fees equal ~0.210%, the bot targets high spreads (>0.50%) or holds hedges across multiple 8h payouts. Funding harvests compound over time while round-trip commissions remain flat.'
      },
      {
        title: 'MAKER & VIP OPTIMIZATION POTENTIAL',
        subtitle: 'PASSIVE POST-ONLY REBALANCING',
        color: C_CYAN_LT,
        desc: 'For slow-moving structural spreads, limit post-only execution compresses total friction to 0.080% round-trip (0.040% maker). Institutional VIP volume tiers further discount fees by up to 60%.'
      }
    ];

    feeCallouts.forEach((fc, i) => {
      const x = 0.8 + i * 4.0;
      s4.addShape(pres.ShapeType.roundRect, {
        x, y: 5.0, w: 3.75, h: 1.6,
        fill: { color: C_CARD_BG },
        line: { color: C_BORDER, width: 1 }
      });
      s4.addText(fc.title, {
        x: x + 0.15, y: 5.12, w: 3.45, h: 0.25,
        fontSize: 8.5, fontFace: 'Calibri', color: fc.color, bold: true
      });
      s4.addText(fc.subtitle, {
        x: x + 0.15, y: 5.37, w: 3.45, h: 0.22,
        fontSize: 8, fontFace: 'Calibri', color: C_TEXT_MUTED
      });
      s4.addText(fc.desc, {
        x: x + 0.15, y: 5.62, w: 3.45, h: 0.85,
        fontSize: 8.5, fontFace: 'Calibri', color: C_TEXT_WHITE, leading: 1.25
      });
    });

    addSlideFooter(s4, 4);
  }
`;

// Renumber old slides s4..s13 to s5..s14
const oldSlide4Comment = "  // SLIDE 4: Why It Is Safe (Risk Architecture)";
const newSlide5Header = "  // SLIDE 5: Why It Is Safe (Risk Architecture)\n  {\n    const s5 = pres.addSlide();\n    s5.background = { color: C_BG_DARK };\n    addSlideHeader(s5, 'Mathematical Certainty & Institutional Risk Engineering', 'Why It Is Safe: Multi-Layer Risk Architecture');";

// Replace slide footers for subsequent slides:
presCode = presCode.replace("addSlideFooter(s4, 4);", "addSlideFooter(s5, 5);");
presCode = presCode.replace("addSlideFooter(s5, 5);", "addSlideFooter(s6, 6);");
presCode = presCode.replace("addSlideFooter(s6, 6);", "addSlideFooter(s7, 7);");
presCode = presCode.replace("addSlideFooter(s7, 7);", "addSlideFooter(s8, 8);");
presCode = presCode.replace("addSlideFooter(s8, 8);", "addSlideFooter(s9, 9);");
presCode = presCode.replace("addSlideFooter(s9, 9);", "addSlideFooter(s10, 10);");
presCode = presCode.replace("addSlideFooter(s10, 10);", "addSlideFooter(s11, 11);");
presCode = presCode.replace("addSlideFooter(s11, 11);", "addSlideFooter(s12, 12);");
presCode = presCode.replace("addSlideFooter(s12, 12);", "addSlideFooter(s13, 13);");
presCode = presCode.replace("addSlideFooter(s13, 13);", "addSlideFooter(s14, 14);");

// Rename variables s4..s13 in those slide blocks to avoid collision if desired, or insert slide4PresCode before oldSlide4
presCode = presCode.replace(
  oldSlide4Comment,
  slide4PresCode + "\n" + oldSlide4Comment
);

// In the old slide 4 block, rename const s4 to const s5 and variables s4. -> s5.
// Let's replace the old slide 4 header:
presCode = presCode.replace(
  `  // SLIDE 4: Why It Is Safe (Risk Architecture)
  {
    const s4 = pres.addSlide();
    s4.background = { color: C_BG_DARK };
    addSlideHeader(s4, 'Mathematical Certainty & Institutional Risk Engineering', 'Why It Is Safe: Multi-Layer Risk Architecture');`,
  `  // SLIDE 5: Why It Is Safe (Risk Architecture)
  {
    const s5 = pres.addSlide();
    s5.background = { color: C_BG_DARK };
    addSlideHeader(s5, 'Mathematical Certainty & Institutional Risk Engineering', 'Why It Is Safe: Multi-Layer Risk Architecture');`
);
// replace s4.add in slide 5
presCode = presCode.replace(/s4\.addShape/g, "s5.addShape");
presCode = presCode.replace(/s4\.addText/g, "s5.addText");

// Write updated presentation script
fs.writeFileSync(presPath, presCode, "utf8");
console.log("Updated scripts/generate_client_presentation.js successfully.");


// 2. Update scripts/generate_client_pdf.js
const pdfPath = path.join(basePath, "scripts/generate_client_pdf.js");
let pdfCode = fs.readFileSync(pdfPath, "utf8");

// Replace all "Slide X of 13" in pdfCode
for (let i = 13; i >= 4; i--) {
  pdfCode = pdfCode.split(`Slide ${i} of 13`).join(`Slide ${i + 1} of 14`);
}
pdfCode = pdfCode.split("Slide 1 of 13").join("Slide 1 of 14");
pdfCode = pdfCode.split("Slide 2 of 13").join("Slide 2 of 14");
pdfCode = pdfCode.split("Slide 3 of 13").join("Slide 3 of 14");

// Define Slide 4 HTML
const slide4PdfHtml = `
  <!-- ========================================================================= -->
  <!-- SLIDE 4: Exchange Commissions & Dual-Venue Fee Structure                  -->
  <!-- ========================================================================= -->
  <div class="slide">
    <div class="slide-header">
      <div class="header-left">
        <div class="category">QUANTITATIVE ARBITRAGE TERMINAL</div>
        <div class="title">Exchange Commissions & Dual-Venue Fee Structure</div>
        <div class="kicker">Transparent Transaction Costs & Round-Trip Friction Breakdown</div>
      </div>
      <div class="confidential-badge">CLIENT BRIEFING // 2026</div>
    </div>

    <div style="background:#151E2E; border:1px solid #1E293B; border-radius:10px; padding:12px 16px; margin-bottom:14px;">
      <span style="color:#06B6D4; font-weight:700; font-size:11px;">TRANSACTION FRICTION TRANSPARENCY:</span>
      <span style="color:#94A3B8; font-size:11px;"> Delta-neutral arbitrage requires simultaneous two-legged market execution. The terminal accounts for Maker/Taker schedules across both venues to guarantee that entries are only triggered when the net funding harvest exceeds all round-trip commissions.</span>
    </div>

    <table style="width:100%; border-collapse:collapse; margin-bottom:16px; font-size:11px;">
      <thead>
        <tr style="background:#1E293B; color:#FFFFFF;">
          <th style="padding:10px; text-align:left; border:1px solid #334155;">Exchange Venue</th>
          <th style="padding:10px; text-align:center; border:1px solid #334155;">Contract Type</th>
          <th style="padding:10px; text-align:center; border:1px solid #334155;">Maker Fee (Limit)</th>
          <th style="padding:10px; text-align:center; border:1px solid #334155;">Taker Fee (Market / Bot Default)</th>
          <th style="padding:10px; text-align:center; border:1px solid #334155;">Round-Trip Fee (Open + Close)</th>
        </tr>
      </thead>
      <tbody>
        <tr style="background:#0F172A; color:#E2E8F0;">
          <td style="padding:10px; font-weight:700; border:1px solid #1E293B;">Bybit</td>
          <td style="padding:10px; text-align:center; border:1px solid #1E293B;">USDT Perpetual (VIP 0)</td>
          <td style="padding:10px; text-align:center; color:#94A3B8; border:1px solid #1E293B;">0.020%</td>
          <td style="padding:10px; text-align:center; font-weight:700; color:#FBBF24; border:1px solid #1E293B;">0.055%</td>
          <td style="padding:10px; text-align:center; font-weight:700; color:#F87171; border:1px solid #1E293B;">0.110% (Taker)</td>
        </tr>
        <tr style="background:#151E2E; color:#E2E8F0;">
          <td style="padding:10px; font-weight:700; border:1px solid #1E293B;">CoinDCX</td>
          <td style="padding:10px; text-align:center; border:1px solid #1E293B;">USDT Futures Contracts</td>
          <td style="padding:10px; text-align:center; color:#94A3B8; border:1px solid #1E293B;">0.020%</td>
          <td style="padding:10px; text-align:center; font-weight:700; color:#FBBF24; border:1px solid #1E293B;">0.050%</td>
          <td style="padding:10px; text-align:center; font-weight:700; color:#F87171; border:1px solid #1E293B;">0.100% (Taker)</td>
        </tr>
        <tr style="background:#064E3B; color:#34D399; font-weight:700;">
          <td style="padding:10px; border:1px solid #047857;">Combined Both Legs<br><span style="font-size:9.5px; font-weight:400; color:#A7F3D0;">(Dual-Venue Hedge)</span></td>
          <td style="padding:10px; text-align:center; border:1px solid #047857;">Dual-Venue Arbitrage<br><span style="font-size:9.5px; font-weight:400; color:#A7F3D0;">Simultaneous Fills</span></td>
          <td style="padding:10px; text-align:center; border:1px solid #047857;">0.040%<br><span style="font-size:9.5px; font-weight:400; color:#A7F3D0;">(Combined Maker)</span></td>
          <td style="padding:10px; text-align:center; border:1px solid #047857; color:#FDE047;">0.105% per side<br><span style="font-size:9.5px; font-weight:400; color:#A7F3D0;">(Market Entry)</span></td>
          <td style="padding:10px; text-align:center; border:1px solid #047857; color:#FFFFFF; font-size:12px;">~0.210% – 0.220% Total<br><span style="font-size:9.5px; font-weight:400; color:#A7F3D0;">(Full Round-Trip)</span></td>
        </tr>
      </tbody>
    </table>

    <div class="grid-3" style="display:grid; grid-template-columns: repeat(3, 1fr); gap:14px;">
      <div class="card" style="background:#151E2E; border:1px solid #1E293B; border-radius:10px; padding:12px;">
        <div style="font-size:9.5px; font-weight:700; color:#FBBF24; margin-bottom:4px;">DUAL-TAKER DEFAULT EXECUTION (~0.210%)</div>
        <div style="font-size:8px; color:#94A3B8; margin-bottom:6px;">ZERO LEG-DROP PROTECTION</div>
        <div style="font-size:9.5px; line-height:1.4; color:#E2E8F0;">
          Simultaneous market orders eliminate leg-drop risk. The full round-trip entry + exit cost across both venues is ~0.210% (0.105% in + 0.105% out), automatically factored into the bot's entry gate calculations.
        </div>
      </div>
      <div class="card" style="background:#151E2E; border:1px solid #1E293B; border-radius:10px; padding:12px;">
        <div style="font-size:9.5px; font-weight:700; color:#34D399; margin-bottom:4px;">MINIMUM FUNDING SPREAD THRESHOLD</div>
        <div style="font-size:8px; color:#94A3B8; margin-bottom:6px;">PROFIT COMPOUNDING POLICY</div>
        <div style="font-size:9.5px; line-height:1.4; color:#E2E8F0;">
          Because combined fees equal ~0.210%, the bot targets high spreads (>0.50%) or holds hedges across multiple 8h payouts. Funding harvests compound over time while round-trip commissions remain flat.
        </div>
      </div>
      <div class="card" style="background:#151E2E; border:1px solid #1E293B; border-radius:10px; padding:12px;">
        <div style="font-size:9.5px; font-weight:700; color:#06B6D4; margin-bottom:4px;">MAKER & VIP OPTIMIZATION POTENTIAL</div>
        <div style="font-size:8px; color:#94A3B8; margin-bottom:6px;">PASSIVE POST-ONLY REBALANCING</div>
        <div style="font-size:9.5px; line-height:1.4; color:#E2E8F0;">
          For slow-moving structural spreads, limit post-only execution compresses total friction to 0.080% round-trip (0.040% maker). Institutional VIP volume tiers further discount fees by up to 60%.
        </div>
      </div>
    </div>

    <div class="slide-footer">
      <div>Quantitative Arbitrage Terminal • Institutional Delta-Neutral Desk • Strictly Confidential</div>
      <div>Slide 4 of 14</div>
    </div>
  </div>
`;

// Insert slide4PdfHtml before the old Slide 4 comment
const oldPdfSlide4Anchor = "  <!-- SLIDE 4: Why It Is Safe (Risk Architecture)                               -->";
pdfCode = pdfCode.replace(oldPdfSlide4Anchor, slide4PdfHtml + "\n  <!-- SLIDE 5: Why It Is Safe (Risk Architecture)                               -->");

fs.writeFileSync(pdfPath, pdfCode, "utf8");
console.log("Updated scripts/generate_client_pdf.js successfully.");
