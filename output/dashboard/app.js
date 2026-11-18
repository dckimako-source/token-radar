// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, filterable and sortable, a per-protocol detail drawer with the model's own inputs
// and the protocol's farm plan, and the live-token protocols set aside. No network: every byte it
// shows is in data.js, and the page recomputes the model from the same figures the board carries.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', watch: false, sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function mult(n) { return (Math.round(n * 1000) / 1000).toFixed(3); }

  // ---- The model, mirrored from lib/model.ts (radar-2). The page recomputes every row from the
  // snapshot figures the board carries and checks the number board.json carries, so the page's code
  // and the board's data are visibly the same arithmetic.
  function catWeight(category) {
    var c = (category || '').toLowerCase();
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('option') >= 0) return 1.08;
    if (c.indexOf('dex') >= 0 || c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateralized') >= 0) return 1.06;
    if (c.indexOf('yield') >= 0 || c.indexOf('liquidity') >= 0) return 1.04;
    if (c.indexOf('bridge') >= 0 || c.indexOf('canonical') >= 0) return 0.85;
    return 1;
  }
  function factorsOf(row, model) {
    var scale = Math.min(model.scale_cap, Math.max(model.scale_base, model.scale_base + model.scale_slope * Math.log10(Math.max(row.tvl_usd, 1e6) / 1e6)));
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var gMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var aMult = model.age_floor + (Math.min(Math.max(age, 0), model.age_days) / model.age_days) * model.age_range;
    var cMult = 1 + Math.min(Math.max((row.chains || []).length - 1, 0), model.chain_cap) * model.chain_step;
    var w = catWeight(row.category);
    return { scale: scale, gMult: gMult, aMult: aMult, cMult: cMult, w: w };
  }
  function impliedOf(row, model) {
    var f = factorsOf(row, model);
    return Math.max(1, Math.round(row.tvl_usd * f.scale * f.gMult * f.aMult * f.cMult * f.w));
  }

  // ---- The farm plan, mirrored from lib/model.ts: category, chains, TVL and age decide the action,
  // the capital, the hold, the gas and every step. No protocol name is special-cased.
  var CHEAP_GAS = ['arbitrum', 'base', 'optimism', 'polygon', 'zksync', 'linea', 'scroll', 'blast', 'mode', 'mantle', 'nova', 'unichain', 'soneium', 'sonic', 'berachain', 'abstract', 'ink', 'bob'];
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasFor(p) {
    var chains = (p.chains || []).map(function (c) { return c.toLowerCase(); });
    var main = chains.some(function (c) { return c.indexOf('ethereum') >= 0 || c === 'bitcoin'; });
    var cheap = chains.some(function (c) { return CHEAP_GAS.some(function (g) { return c.indexOf(g) >= 0; }); });
    if (main) return { gas: 12, note: 'Ethereum or a mainnet, where a transaction costs real gas' };
    if (cheap) return { gas: 1, note: 'a rollup, where a transaction costs cents' };
    if (!chains.length) return { gas: 6, note: 'gas is unknown, so budget for a mainnet' };
    return { gas: 4, note: 'gas on its main chain' };
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 300;
    if (p.tvl_usd >= 1e9) return 200;
    if (p.tvl_usd >= 2.5e8) return 120;
    if (p.tvl_usd >= 5e7) return 80;
    return 40;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 75;
    if (age < 365) return 60;
    return 45;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC as collateral to ' + name + ' on ' + chain + ', then borrow against it at under 40% loan-to-value so the position earns on both sides.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s deepest pool on " + chain + ', split 50/50 unless the pool asks for one-sided.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ', then use the funds inside ' + name + "'s app so the transfer is more than a pass-through.";
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's native asset through " + name + ' on ' + chain + ' and keep the liquid receipt token in your wallet.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small long, then close it; keep leverage under 2x.';
    if (c.indexOf('option') >= 0) return 'Fund $' + capital + ' on ' + name + ' and sell one covered option or buy one cheap long, whichever the vault interface offers.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and take one position on ' + name + "'s largest market, then hold it to resolution.";
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into the ' + name + ' vault on ' + chain + ' with the deepest assets and keep the receipt shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold the balance in the app.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + ' of ' + name + "'s yield asset on " + chain + ' and hold it for the full hold window.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' for a 90-day term and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function secondActionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'In ' + name + ', repay the borrow once mid-window and redraw, so the wallet shows a full borrow-repay cycle.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0) return 'Swap once on ' + name + ' from the same wallet (about $' + Math.max(20, Math.round(capital / 4)) + '), and vote or stake the LP fees if the page offers it.';
    if (c.indexOf('bridge') >= 0) return 'Move $' + Math.max(20, Math.round(capital / 2)) + ' back the other way through ' + name + ', so the record shows volume in both directions.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'On ' + name + ', add a second trade in the opposite direction at low size, so the account shows volume both ways.';
    if (c.indexOf('prediction') >= 0) return 'Take one more small position on ' + name + ' in a different market the next week.';
    return 'Return to ' + name + ' once a week and make any one transaction, however small, from the same wallet.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(p);
    var steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'no cost, only discipline', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital plus about $' + gas.gas + ' of gas on ' + gas.note, time: '15 to 20 minutes to set up' }
    ];
    var cheap = p.chains && p.chains.length > 0 && CHEAP_GAS.some(function (g) { return p.chains[0].toLowerCase().indexOf(g) >= 0; });
    if (!cheap && p.chains && p.chains.length > 0) {
      steps.push({ text: 'Move the farming capital to ' + p.chains[0] + ' first through an official bridge, not a third-party one, and send a test transfer before the full amount.', cost: '$' + gas.gas + ' to $' + (gas.gas * 2) + ' of bridge gas', time: '20 minutes plus bridge wait' });
    }
    steps.push({ text: secondActionFor(p, capital, chain), cost: '$' + Math.max(4, Math.round(capital / 4)) + ' of capital at risk, plus $' + Math.max(1, Math.round(gas.gas / 3)) + ' of gas', time: '10 minutes' });
    steps.push(
      { text: "Make one qualifying action each week for the first month - a deposit, a borrow, a swap or a vote - so the wallet's history has more than one cluster.", cost: 'about $' + Math.max(1, Math.round(gas.gas / 4)) + ' of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days - ' + (p.age_days === null || p.age_days === undefined ? 'the snapshot lists no date, so assume a young protocol' : 'the protocol has run ' + p.age_days + ' days with no token') + ' - so the activity lands in more than one snapshot.', cost: 'the $' + capital + ' stays locked in the position', time: hold + ' days' },
      { text: "Watch the protocol's own announcements for a points program or governance test, and join it the week it opens; the cheap phases are early.", cost: 'no fee to join', time: '15 minutes a fortnight' },
      { text: "Before you withdraw, check the protocol's own page for a claim; claim only from a link it publishes, and never pay anyone to unlock an airdrop.", cost: 'no fee; a claim that asks for payment is a scam', time: '10 minutes' },
      { text: 'Write the wallet, dates and every transaction hash in a farm log so you can repeat the position or unwind it cleanly.', cost: 'nothing but the log', time: '5 minutes' }
    );
    return steps;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('watch') === '1') state.watch = true;
    if (params.get('sort')) state.sort = params.get('sort');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.watch) params.set('watch', '1');
    if (state.sort !== 'implied') params.set('sort', state.sort);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    try {
      if (next) window.history.replaceState(null, '', '#' + next);
      else window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (e) {
      // A file:// page may refuse history writes; the filters and the drawer still work without the hash.
      if (next) window.location.hash = next;
    }
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.watch && !r.on_watchlist) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function stats() {
    var rows = DATA.rows;
    var total = rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var growing = rows.filter(function (r) { return r.change_7d !== null && r.change_7d > 0; }).length;
    var watch = rows.filter(function (r) { return r.on_watchlist; }).length;
    return el('div', { class: 'stat-row' },
      stat('Rows scored', String(rows.length)),
      stat('Watchlist covered', watch + ' of ' + DATA.watchlist_size),
      stat('Early finds below the floor', String(DATA.early_size)),
      stat('Board implied value', fmtUsd(total)),
      stat('Growing 7d', growing + ' rows')
    );
  }
  function stat(label, value) {
    return el('div', { class: 'stat' }, el('span', { class: 'stat-label', text: label }), el('b', { class: 'num stat-value', text: value }));
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise: it says what the protocol\'s token would be worth if its record stayed as it is, not whether a token comes.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist floor' }), el('b', { text: fmtUsd(DATA.floor_usd) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var watchBox = el('input', { type: 'checkbox', id: 'watch' });
    watchBox.checked = state.watch;
    watchBox.addEventListener('change', function () { state.watch = watchBox.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('label', { class: 'check', for: 'watch' }, watchBox, ' Watchlist only'),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search, chain or category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watch = false; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', null, el('span', { class: 'chip' + (r.on_watchlist ? ' chip-watch' : ''), text: r.on_watchlist ? 'watchlist' : 'early' })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            el('th', { scope: 'col', text: 'Source' }),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot\'s own figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x scaleMult x growthMult x ageMult x chainMult x catWeight )',
        el('br'),
        'scaleMult  = clamp(' + m.scale_base + ' + ' + m.scale_slope + ' x log10(max(tvl, $1M)/$1M), ' + m.scale_base + ', ' + m.scale_cap + ')',
        el('br'),
        'growthMult = 1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight,
        el('br'),
        'ageMult    = ' + m.age_floor + ' + min(age_days, ' + m.age_days + ') / ' + m.age_days + ' x ' + m.age_range + '   (age unknown: ' + m.unknown_age_days + 'd)',
        el('br'),
        'chainMult  = 1 + min(chains - 1, ' + m.chain_cap + ') x ' + m.chain_step + '   catWeight = ' + '0.85 .. 1.08, from the category field'
      ),
      el('p', { class: 'sub', text: 'TVL, seven-day growth, listing age, chain count and category all come from the snapshot. The scale multiple says a dollar of TVL is worth more in a bigger protocol, with diminishing returns per decade. Growth is momentum with a floor so a bad week does not erase a protocol. Age is how long the protocol has run with no token, the best record of how established it is. The category weight is a propensity judgement from the category field alone: usage a farmer can repeat on-chain (trading, lending) reads worth more; a bridge\'s one-shot transfers read worth less. Live-token protocols are set aside with their market caps shown - the market already prices them.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function signalChips(row) {
    var chips = [];
    if (row.change_7d !== null && row.change_7d > 10) chips.push('growing fast');
    else if (row.change_7d !== null && row.change_7d < -10) chips.push('TVL falling');
    if (row.age_days !== null && row.age_days >= 730) chips.push('long-running, no token');
    else if (row.age_days !== null && row.age_days <= 180) chips.push('young protocol');
    if ((row.chains || []).length >= 4) chips.push('multi-chain');
    if (row.on_watchlist) chips.push('on the watchlist');
    else chips.push('below the watchlist floor');
    return chips;
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    var m = DATA.model;
    var f = factorsOf(row, m);
    var steps = farmSteps(row);
    var check = impliedOf(row, m);
    var chainName = row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain';
    dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + chainName })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('div', { class: 'chip-row' }, signalChips(row).map(function (c) { return el('span', { class: 'chip', text: c }); })));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Model breakdown' }),
      el('div', { class: 'equation' },
        factor('TVL', fmtUsd(row.tvl_usd), 1, 1),
        factor('Scale (TVL size)', mult(f.scale), f.scale, m.scale_cap),
        factor('Growth 7d (' + fmtPct(row.change_7d) + ')', mult(f.gMult), f.gMult, Math.max(1.6, f.gMult)),
        factor('Age (' + fmtAge(row.age_days) + ')', mult(f.aMult), f.aMult, 1),
        factor('Chain breadth (' + (row.chains || []).length + ')', mult(f.cMult), f.cMult, 1 + m.chain_cap * m.chain_step),
        factor('Category weight', mult(f.w), f.w, 1.1),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(check) + (check === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price, and it does not predict whether a token is issued.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('p', { class: 'sub', text: 'Derived from this protocol\'s category, chains, TVL and age. Each step carries its cost and its time.' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        return el('li', null, el('b', { text: s.text }), el('span', { class: 'cost', text: 'Cost: ' + s.cost + '. Time: ' + s.time + '.' }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }
  function factor(label, value, part, max) {
    return el('div', null,
      el('span', { text: label }),
      el('span', { class: 'factor-right' },
        el('span', { class: 'bar mini', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(6, Math.round((part / max) * 100)) + '%' })),
        el('b', { class: 'num', text: value })
      )
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(stats());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
