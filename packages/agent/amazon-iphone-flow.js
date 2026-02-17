const { chromium } = require('playwright');

async function main() {
  try {
    const userDataDir = './playwright-canary-persist';
    const launchOptions = {
      headless: false,
      slowMo: 1500,
      executablePath: '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'
    };
    console.log('🚀 Launching persistent VISIBLE Chrome Canary...');
    const context = await chromium.launchPersistentContext(userDataDir, launchOptions);
    const page = await context.newPage();
    console.log('📱 Navigating to Amazon.in iPhones...');
    await page.goto('https://www.amazon.in/s?k=iphone+16+pro', { waitUntil: 'networkidle' });
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('.s-main-slot', { timeout: 15000 });
    console.log('🔄 Scrolling DOWN (3x human-like)...');
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(2000);
    }
    console.log('🔄 Scrolling UP...');
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(1500);
    console.log('🛒 Finding & CLICKING iPhone 17 (fallback top iPhone)...');
    let iphoneLink = page.locator('.s-result-item[data-component-type="s-search-result"] h2 a').filter({ hasText: /iPhone 17/i }).first();
    if (await iphoneLink.count() === 0) {
      iphoneLink = page.locator('.s-result-item[data-component-type="s-search-result"] h2 a').first();
      console.log('No iPhone 17 - using top result');
    }
    await iphoneLink.waitFor({ state: 'visible', timeout: 10000 });
    await iphoneLink.scrollIntoViewIfNeeded();
    await iphoneLink.click({ force: true });
    await page.waitForURL('**/dp/**', { timeout: 15000 });
    console.log('📄 On PRODUCT PAGE - scrolling DOWN/UP...');
    await page.waitForLoadState('networkidle');
    for (let i = 0; i < 2; i++) {
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(2000);
    }
    await page.mouse.wheel(0, -500);
    console.log('⏸️ PAUSED w/ INSPECTOR - LIVE MANUAL CONTROL FOREVER! (Ctrl+C to stop script)');
    await page.pause();  // Opens Playwright Inspector - perfect live!
  } catch (error) {
    console.error('❌ ERROR:', error.message);
  }
  // NO close - stays open!
}

main();