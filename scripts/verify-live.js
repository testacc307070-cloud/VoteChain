async function testLiveProduction() {
  const baseUrl = 'https://vote-chain-pi.vercel.app';
  console.log(`\n======================================================`);
  console.log(`VERIFYING LIVE PRODUCTION: ${baseUrl}`);
  console.log(`======================================================\n`);

  // 1. Check Login page
  console.log(`--- [1] Checking /login ---`);
  const loginRes = await fetch(`${baseUrl}/login`, { headers: { 'Cache-Control': 'no-cache' } });
  const loginHtml = await loginRes.text();
  console.log(`HTTP Status: ${loginRes.status}`);
  console.log(`Contains 'VERIFIABLE VOTING':`, loginHtml.includes('VERIFIABLE VOTING'));
  console.log(`Contains 'PHASE 1':`, loginHtml.includes('PHASE 1'));
  console.log(`Contains 'Show password' (eye toggle button):`, loginHtml.includes('Show password'));
  console.log(`Contains 'Hide password':`, loginHtml.includes('Hide password'));
  console.log(`Contains 'password-toggle-btn':`, loginHtml.includes('password-toggle-btn'));

  // 2. Check Register page
  console.log(`\n--- [2] Checking /register ---`);
  const regRes = await fetch(`${baseUrl}/register`, { headers: { 'Cache-Control': 'no-cache' } });
  const regHtml = await regRes.text();
  console.log(`HTTP Status: ${regRes.status}`);
  console.log(`Contains 'Show password':`, regHtml.includes('Show password'));
  console.log(`Contains 'password-toggle-btn':`, regHtml.includes('password-toggle-btn'));
  console.log(`Mentions 'Phase':`, /Phase\s+\d+/i.test(regHtml));

  // 3. Check Reset Password page
  console.log(`\n--- [3] Checking /reset-password ---`);
  const resetRes = await fetch(`${baseUrl}/reset-password`, { headers: { 'Cache-Control': 'no-cache' } });
  const resetHtml = await resetRes.text();
  console.log(`HTTP Status: ${resetRes.status}`);
  console.log(`Contains 'Show password':`, resetHtml.includes('Show password'));
  console.log(`Contains 'password-toggle-btn':`, resetHtml.includes('password-toggle-btn'));

  // 4. Check Results page
  console.log(`\n--- [4] Checking /results ---`);
  const resRes = await fetch(`${baseUrl}/results`, { headers: { 'Cache-Control': 'no-cache' } });
  const resHtml = await resRes.text();
  console.log(`HTTP Status: ${resRes.status}`);
  console.log(`Contains 'results-metadata-grid':`, resHtml.includes('results-metadata-grid'));
  console.log(`Contains 'results-meta-card':`, resHtml.includes('results-meta-card'));
  console.log(`Contains 'candidate-tally-bar':`, resHtml.includes('candidate-tally-bar'));
  console.log(`Contains 'results-verification-section':`, resHtml.includes('results-verification-section'));
  console.log(`Mentions 'Phase':`, /Phase\s+\d+/i.test(resHtml));

  // 5. Check Audit page
  console.log(`\n--- [5] Checking /audit ---`);
  const auditRes = await fetch(`${baseUrl}/audit`, { headers: { 'Cache-Control': 'no-cache' } });
  const auditHtml = await auditRes.text();
  console.log(`HTTP Status: ${auditRes.status}`);
  console.log(`Mentions 'Phase':`, /Phase\s+\d+/i.test(auditHtml));

  // 6. Check Home page (Command Palette, Search, Notifications)
  console.log(`\n--- [6] Checking / (Dashboard / Header Controls) ---`);
  const homeRes = await fetch(`${baseUrl}`, { headers: { 'Cache-Control': 'no-cache' } });
  const homeHtml = await homeRes.text();
  console.log(`HTTP Status: ${homeRes.status}`);
  console.log(`Contains 'search-modal':`, homeHtml.includes('search-modal'));
  console.log(`Contains 'notifications-popover':`, homeHtml.includes('notifications-popover'));
  console.log(`Contains 'Quick Navigation':`, homeHtml.includes('Quick Navigation'));
  console.log(`Contains 'Mark all as read':`, homeHtml.includes('Mark all as read'));

  // 7. Check CSS styles bundle
  console.log(`\n--- [7] Checking Live CSS Stylesheet ---`);
  const cssMatches = [...homeHtml.matchAll(/href="(\/_next\/static\/[^"]+\.css)"/g)];
  console.log(`Found ${cssMatches.length} stylesheet links`);
  for (const match of cssMatches) {
    const cssUrl = `${baseUrl}${match[1]}`;
    const cssRes = await fetch(cssUrl);
    const css = await cssRes.text();
    console.log(`Stylesheet ${match[1]}: size=${css.length} bytes`);
    if (css.includes('search-modal')) {
      console.log(`  -> search-modal class: FOUND`);
      console.log(`  -> notifications-popover class: FOUND`);
      console.log(`  -> results-metadata-grid class: FOUND`);
      console.log(`  -> candidate-tally-bar class: FOUND`);
      console.log(`  -> password-toggle-btn class: FOUND`);
    }
  }
}

testLiveProduction().catch(console.error);
