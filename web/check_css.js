async function run() {
  const res = await fetch('http://localhost:3000/');
  const html = await res.text();
  const cssMatches = html.match(/href="[^"]+\.css"/g);
  console.log('CSS links:', cssMatches);
  if (cssMatches) {
    for (const m of cssMatches) {
      const url = m.replace(/href="|"/g, '');
      const fullUrl = url.startsWith('http') ? url : 'http://localhost:3000' + url;
      const cssRes = await fetch(fullUrl);
      console.log(fullUrl, 'Status:', cssRes.status, 'Length:', (await cssRes.text()).length);
    }
  }
}
run();
