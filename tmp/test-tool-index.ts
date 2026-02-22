/**
 * Quick test for tool-index + search-tools-tool.
 * Run: npx tsx tmp/test-tool-index.ts
 */

import { discoverAllTools } from '../src/tools/auto-loader';
import { buildToolIndex, searchTools, getCategories, getAllToolEntries, formatSearchResults, formatCategorySummary } from '../src/tools/tool-index';

console.log('=== Discovering tools ===\n');
const { staticTools, factories } = discoverAllTools();

// Factory tools need deps — skip them, just use static for testing
console.log(`\nStatic tools found: ${Object.keys(staticTools).length}`);
console.log('Tool names:', Object.keys(staticTools).sort().join(', '));

console.log('\n=== Building index ===\n');
buildToolIndex(staticTools);

const entries = getAllToolEntries();
console.log(`Indexed: ${entries.length} tools`);

console.log('\n=== Categories ===\n');
console.log(formatCategorySummary());

console.log('\n=== Search: "file" ===\n');
console.log(formatSearchResults(searchTools('file')));

console.log('\n=== Search: "telegram" ===\n');
console.log(formatSearchResults(searchTools('telegram')));

console.log('\n=== Search: "web search" ===\n');
console.log(formatSearchResults(searchTools('web search')));

console.log('\n=== Search: "voice" ===\n');
console.log(formatSearchResults(searchTools('voice')));

console.log('\n=== Search: "think" ===\n');
console.log(formatSearchResults(searchTools('think')));

console.log('\n=== Search: "send message" ===\n');
console.log(formatSearchResults(searchTools('send message')));

console.log('\n=== Search: "secret" ===\n');
console.log(formatSearchResults(searchTools('secret')));

console.log('\n=== Search: "presentation" ===\n');
console.log(formatSearchResults(searchTools('presentation')));

console.log('\n=== Search: "budget" ===\n');
console.log(formatSearchResults(searchTools('budget')));

console.log('\n=== Search: "tv" ===\n');
console.log(formatSearchResults(searchTools('tv')));

console.log('\n✅ Done');
