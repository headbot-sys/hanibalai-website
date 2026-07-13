import { scoreIntent } from '../src/scorer.js';
import { stripHtml } from '../src/http.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const high = scoreIntent(
  'Looking for ATM company to place machine in my laundry. Want to host an ATM.'
);
assert(high.tier === 'high', `expected high, got ${high.tier}/${high.score}`);

const crime = scoreIntent('Police looking for suspects who put skimmer on ATM');
assert(crime.tier === 'noise' || crime.score < 30, `crime should be low, got ${crime.tier}/${crime.score}`);

const vendor = scoreIntent('We provide ATMs for hire. Buy an ATM today. ATM company for hire.');
assert(vendor.tier === 'noise' || vendor.score < 30, `vendor should be low, got ${vendor.tier}/${vendor.score}`);

const decoded = stripHtml('&lt;a href=&quot;https://x.test&quot;&gt;Need an ATM for my store&lt;/a&gt;');
assert(decoded === 'Need an ATM for my store', `stripHtml failed: ${decoded}`);

console.log('ok — scorer + stripHtml tests passed');
