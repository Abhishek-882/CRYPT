const fs = require('fs');

// 1. Update bot_set_files.json in web/data/users/usr_admin_varsha/bot_set_files.json
const userSetPath = 'C:/AI-Hedge-Cockpit/web/data/users/usr_admin_varsha/bot_set_files.json';
if (fs.existsSync(userSetPath)) {
  const sets = JSON.parse(fs.readFileSync(userSetPath, 'utf8'));
  sets.forEach(s => {
    if (s.config) {
      s.config.maxDivergenceSpreadRatioPct = s.config.maxDivergenceSpreadRatioPct ?? 50;
      s.config.maxPriceDivergenceCapPct = s.config.maxPriceDivergenceCapPct ?? 0.50;
    }
    if (s.contentText && !s.contentText.includes('MaxDivergenceSpreadRatioPct')) {
      s.contentText += '\nMaxDivergenceSpreadRatioPct=' + (s.config.maxDivergenceSpreadRatioPct || 50) + '\nMaxPriceDivergenceCapPct=' + (s.config.maxPriceDivergenceCapPct || 0.50);
    }
  });
  fs.writeFileSync(userSetPath, JSON.stringify(sets, null, 2), 'utf8');
  console.log('Updated usr_admin_varsha bot_set_files.json');
}

// 2. Update root web/bot_set_files.json
const rootSetPath = 'C:/AI-Hedge-Cockpit/web/bot_set_files.json';
if (fs.existsSync(rootSetPath)) {
  const sets = JSON.parse(fs.readFileSync(rootSetPath, 'utf8'));
  sets.forEach(s => {
    if (s.config) {
      s.config.maxDivergenceSpreadRatioPct = s.config.maxDivergenceSpreadRatioPct ?? 50;
      s.config.maxPriceDivergenceCapPct = s.config.maxPriceDivergenceCapPct ?? 0.50;
    }
    if (s.contentText && !s.contentText.includes('MaxDivergenceSpreadRatioPct')) {
      s.contentText += '\nMaxDivergenceSpreadRatioPct=' + (s.config.maxDivergenceSpreadRatioPct || 50) + '\nMaxPriceDivergenceCapPct=' + (s.config.maxPriceDivergenceCapPct || 0.50);
    }
  });
  fs.writeFileSync(rootSetPath, JSON.stringify(sets, null, 2), 'utf8');
  console.log('Updated web/bot_set_files.json');
}
