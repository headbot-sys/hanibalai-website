/**
 * Sample leads for offline demo / testing without hitting live sources.
 */
export const DEMO_LEADS = [
  {
    id: 'demo-1',
    source: 'reddit',
    title: 'Looking for ATM company to place machine in my laundry',
    url: 'https://www.reddit.com/r/smallbusiness/comments/example_atm_laundry',
    snippet:
      'We run a 24h laundromat in Houston and customers keep asking for cash. Looking for someone who can host/place an ATM — revenue share preferred.',
    location: 'Houston',
    score: 85,
    tier: 'high',
    reasons: ['high:looking for ... atm'],
    query: 'looking for ATM',
  },
  {
    id: 'demo-2',
    source: 'craigslist',
    title: 'Need an ATM for busy corner market — NYC',
    url: 'https://newyork.craigslist.org/mnh/bfs/example_need_atm.html',
    snippet:
      'Bodega near Midtown. High foot traffic evenings. Want ATM installation / host. Call mornings.',
    location: 'New York',
    score: 80,
    tier: 'high',
    reasons: ['high:need ... atm'],
    query: 'need ATM',
  },
  {
    id: 'demo-3',
    source: 'news',
    title: 'Rural truck stops seek cash access as banks close branches',
    url: 'https://news.example.com/truck-stops-atm-access',
    snippet:
      'Operators say host ATM partnerships help travelers after local branches shuttered.',
    location: 'Denver',
    score: 45,
    tier: 'medium',
    reasons: ['medium:atm partnership'],
    query: 'host ATM retail location',
  },
  {
    id: 'demo-4',
    source: 'web',
    title: 'Bar owner seeking ATM operator for nightlife corridor',
    url: 'https://example.com/forum/atm-for-my-bar',
    snippet:
      'Want ATM in my bar on weekends — place ATM at my location, split surcharge.',
    location: 'Miami',
    score: 70,
    tier: 'high',
    reasons: ['high:place atm', 'medium:bar ... atm'],
    query: 'ATM for my bar',
  },
  {
    id: 'demo-5',
    source: 'craigslist',
    title: 'Used ATM for sale — turnkey',
    url: 'https://chicago.craigslist.org/bfs/example_atm_sale.html',
    snippet: 'We provide ATMs for hire. Buy an ATM today. ATM company for hire.',
    location: 'Chicago',
    score: 10,
    tier: 'noise',
    reasons: ['downrank:vendor-pitch'],
    query: 'ATM',
  },
];
