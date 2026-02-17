const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome-canary',
    slowMo: 1500,
  });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  console.log('🌐 Navigating to Amazon.in iPhones search...');
  await page.goto('https://www.amazon.in/s?k=iphones', { waitUntil: 'networkidle' });

  console.log('📜 Scrolling down search results...');
  await page.evaluate(() => window.scrollBy(0, 1000));
  await page.waitForTimeout(4000);

  console.log('🖱️ Looking for iPhone 17 or first iPhone...');
  // Prefer iPhone 17, fallback to prominent iPhone
  const iphone17 = page.locator('h2 a span:has-text("iPhone 17")').first();
  if (await iphone17.count() === 0) {
    // Fallback: first iPhone product link
    const firstIphone = page.locator('[data-component-type="s-search-result"] a[href*="/dp/"]:has(span:has-text("iPhone"))').first();
    await firstIphone.click();
  } else {
    await iphone17.click();
  }
  await page.waitForURL('**/dp/**', { timeout: 10000 });

  console.log('📱 On product page - scrolling up/down...');
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.scrollTo(0, 0));

  console.log('✅ FLOW COMPLETE! Browser OPEN - manual control now (add to cart, zoom, etc.). Close when done.');
  // Pause indefinitely
  process.stdin.resume();
  await new Promise(() => {});  // Never resolve
})();
