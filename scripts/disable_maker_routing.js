const fs = require('fs');

const paths = [
  'C:/Users/Administrator/Desktop/AI_Hedge_Cockpit/web/data/users/usr_admin_varsha/bot_daemon_state.json',
  'C:/Users/Administrator/Desktop/AI_Hedge_Cockpit/web/bot_daemon_state.json',
  'C:/Users/Administrator/Desktop/AI_Hedge_Cockpit/bot_daemon_state.json'
];

paths.forEach(p => {
  if (fs.existsSync(p)) {
    let content = fs.readFileSync(p, 'utf8');
    const updated = content.replaceAll('"enableMakerRouting": true', '"enableMakerRouting": false');
    fs.writeFileSync(p, updated, 'utf8');
    console.log(`Updated ${p}`);
  }
});
