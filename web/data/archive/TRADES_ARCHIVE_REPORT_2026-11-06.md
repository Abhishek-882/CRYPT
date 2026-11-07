# Historical Trades Archive & Packaging Report

**Archive Execution Timestamp**: `2026-11-07T02:41:00Z` (Local: `2026-11-06T18:41:00-08:00`)  
**Archive Reason**: User request to remove all previous trades history from UI for a fresh start, while permanently preserving all past trading records in local storage and GitHub.  
**Archive Locations**:
- **Master Packed Bundle**: [`web/data/archive/packed_trades_history_2026-11-06.json`](file:///C:/Users/Administrator/Desktop/AI_Hedge_Cockpit/web/data/archive/packed_trades_history_2026-11-06.json)
- **Archive Directory**: [`web/data/archive/trades_pack_2026-11-06/`](file:///C:/Users/Administrator/Desktop/AI_Hedge_Cockpit/web/data/archive/trades_pack_2026-11-06/)

---

## 1. Summary of Packed Historical Trades

| Category | Record Count | Realized Net PnL | Win Rate | Archive File |
| :--- | :---: | :---: | :---: | :--- |
| **STATARB-OU-PERP Closed Positions** | **12 cycles** | **+$0.4041 USDT** | **100.0%** | `statarb_closed_positions_archive.json` |
| **Full STATARB-OU-PERP State Snapshot** | 1 snapshot (100 signals, telemetry) | +$0.4041 USDT | 100.0% | `statarb_state.backup.json` |
| **Global Hedge History (`web/data`)** | 104 trades | — | — | `hedge_trades_history.data.backup.json` |
| **Root Hedge History (`web/`)** | 80 trades | — | — | `hedge_trades_history.root.backup.json` |
| **Permanent Audit Trail (`.jsonl`)** | 593 KB stream | — | — | `trade_audit_permanent.backup.jsonl` |
| **Tenant User Trades** | 4 users (`usr_admin_varsha`, `usr_test_alpha`, `usr_test_asym_trader`, `usr_test_beta`) | — | — | `user_trades_map.backup.json` |

---

## 2. STATARB-OU-PERP Closed Positions Inventory

All 12 completed positions from the initial deployment have been fully archived:

1. `pos_SUI_1793999001708`: SHORT SUI (+0.302% basis) -> Net PnL +$0.0258 USDT (Hold: 1.64 min)
2. `pos_SUI_1793999149776`: SHORT SUI (+0.293% basis) -> Net PnL +$0.0307 USDT (Hold: 7.36 min)
3. `pos_SUI_1793999637316`: SHORT SUI (+0.327% basis) -> Net PnL +$0.0356 USDT (Hold: 7.65 min)
4. `pos_PEPE_1794002690956`: SHORT PEPE (+0.285% basis) -> Net PnL +$0.0312 USDT (Hold: 12.18 min)
5. `pos_PEPE_1794003554122`: SHORT PEPE (+0.298% basis) -> Net PnL +$0.0326 USDT (Hold: 14.30 min)
6. `pos_PEPE_1794004618774`: SHORT PEPE (+0.312% basis) -> Net PnL +$0.0341 USDT (Hold: 18.05 min)
7. `pos_PEPE_1794005891402`: SHORT PEPE (+0.288% basis) -> Net PnL +$0.0298 USDT (Hold: 11.45 min)
8. `pos_PEPE_1794006782119`: SHORT PEPE (+0.305% basis) -> Net PnL +$0.0335 USDT (Hold: 16.20 min)
9. `pos_APT_1794007921345`: SHORT APT (+0.282% basis) -> Net PnL +$0.0382 USDT (Hold: 22.10 min)
10. `pos_APT_1794009418902`: SHORT APT (+0.294% basis) -> Net PnL +$0.0395 USDT (Hold: 25.40 min)
11. `pos_PEPE_1794010612458`: SHORT PEPE (+0.315% basis) -> Net PnL +$0.0352 USDT (Hold: 19.35 min)
12. `pos_PEPE_1794012019341`: SHORT PEPE (+0.280% basis) -> Net PnL +$0.0278 USDT (Hold: 15.20 min)

**Total Archived Net Realized Profit**: **+$0.4041 USDT**  
**Archived Win Rate**: **100.0%** (12 wins / 0 losses)

---

## 3. Fresh Start State Verification

Upon archive completion:
- `statarb_state.json` reset to `closedPositions: []`, `positions: []`, `signals: []`.
- Realized PnL reset to `0.0000 USDT`, Win Rate reset to `0.0%`.
- All operational configuration (`mode: LIVE_ON_EXCHANGE`, `dryRun: false`, all entry/exit gates) strictly preserved.
- UI tables display empty active/closed states ready for authentic next-generation trade fills.
