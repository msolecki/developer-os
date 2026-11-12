/* developer-os site: the terminal session on the landing page, and the daily loop, the life of a note and the
   hook timeline on workflow.html. Each block starts only when all of its elements are on the page, so each
   diagram lives on one page; with reduced motion everything renders at rest. */
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var NS = 'http://www.w3.org/2000/svg';
  function $(id) { return document.getElementById(id); }
  function svg(tag, attrs) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function tint(node, c, s) { node.style.setProperty('--c', 'var(' + c + ')'); if (s) node.style.setProperty('--soft', 'var(' + s + ')'); }

  /* The daily loop: a ring of seven steps with a list beside it. */
  var STEPS = [
    { t: 'Session start', who: 'SessionStart hook', c: '--pine', s: '--pine-soft',
      d: 'The core rules load. After a compaction, resume or fork the state card from docs/plans/.devos-state.md comes back. On a fresh start: the plugin version and an inbox or garden reminder when one is due.' },
    { t: 'Search before you plan', who: 'brain-search', c: '--ok', s: '--ok-soft',
      d: 'The agent reads active notes first, cites their paths and says when a hit is still in the inbox. Nothing found is useful too: you are in new territory.' },
    { t: 'The plan lives in the repository', who: 'docs/plans/<date>-<task>.md', c: '--pine', s: '--pine-soft',
      d: 'Goal, decisions, steps, next action, updated after each step. The fast check runs before each commit; the guard asks before risky commands.' },
    { t: 'A decision is made: capture it', who: 'brain-capture', c: '--ask', s: '--ask-soft',
      d: 'One note in _inbox/ with status: inbox, its type, project and a one-line summary. Secrets are redacted; on a secret-pattern match nothing is written.' },
    { t: 'End of session', who: 'session-retro · Stop hook', c: '--ask', s: '--ask-soft',
      d: 'Checks for unpushed work, closes or updates the plan, proposes lessons and rules. After 30+ tool calls the Stop hook offers this once.' },
    { t: 'Weekly: review the inbox', who: 'brain-review', c: '--ok', s: '--ok-soft',
      d: 'Keep, merge, reject or supersede, only for the notes you name. Approval is the one step that keeps the vault trustworthy, so it stays human.' },
    { t: 'Monthly: garden', who: 'brain-garden · brain-compile', c: '--ok', s: '--ok-soft',
      d: 'A report of stale notes, broken links, duplicates and rules restated across notes. Changes apply only after you approve; brain-compile folds a topic into one note.' }
  ];
  (function loop() {
    var ring = $('wf-ring'), list = $('wf-steps');
    if (!ring || !list) return;
    var R = 110, CX = 150, CY = 150, segs = [], span = (Math.PI * 2) / STEPS.length, gap = 0.06;
    function polar(a, r) { return [CX + r * Math.cos(a), CY + r * Math.sin(a)]; }
    STEPS.forEach(function (st, i) {
      var a0 = -Math.PI / 2 + i * span + gap / 2, a1 = a0 + span - gap, p0 = polar(a0, R), p1 = polar(a1, R);
      var seg = svg('path', { d: 'M' + p0[0] + ' ' + p0[1] + ' A' + R + ' ' + R + ' 0 0 1 ' + p1[0] + ' ' + p1[1], 'class': 'seg' });
      tint(seg, st.c); ring.appendChild(seg); segs.push(seg);
      var lp = polar((a0 + a1) / 2, R + 26), tx = svg('text', { x: lp[0], y: lp[1] + 4, 'text-anchor': 'middle' });
      tx.textContent = i + 1; ring.appendChild(tx);
      var li = document.createElement('li'); tint(li, st.c, st.s);
      var b = document.createElement('button'); b.type = 'button';
      b.innerHTML = '<span class="n"></span><span><strong></strong><span class="who"></span><span class="d"></span></span>';
      b.querySelector('.n').textContent = i + 1; b.querySelector('strong').textContent = st.t;
      b.querySelector('.who').textContent = st.who; b.querySelector('.d').textContent = st.d;
      b.addEventListener('click', function () { go(i); stop(); });
      li.appendChild(b); list.appendChild(li);
    });
    var c1 = svg('text', { x: CX, y: CY - 4, 'text-anchor': 'middle', 'class': 'center-t' }); c1.textContent = 'the loop'; ring.appendChild(c1);
    var c2 = svg('text', { x: CX, y: CY + 16, 'text-anchor': 'middle' }); c2.textContent = 'session → vault → session'; ring.appendChild(c2);
    var marker = svg('circle', { r: 9, fill: 'var(--ink)' }); ring.appendChild(marker);
    var cur = 0, timer = null, held = false, play = $('wf-play'), pos = $('wf-pos');
    function go(i) {
      cur = i;
      segs.forEach(function (s, k) { s.classList.toggle('on', k === i); });
      Array.prototype.forEach.call(list.children, function (li, k) {
        li.classList.toggle('on', k === i); li.firstChild.setAttribute('aria-current', k === i ? 'step' : 'false');
      });
      var p = polar(-Math.PI / 2 + (i + 0.5) * span, R); marker.setAttribute('cx', p[0]); marker.setAttribute('cy', p[1]);
      if (pos) pos.textContent = 'step ' + (i + 1) + ' of ' + STEPS.length;
    }
    function start() { if (timer || reduce) return; timer = setInterval(function () { if (!held) go((cur + 1) % STEPS.length); }, 3400); if (play) { play.textContent = 'Pause'; play.setAttribute('aria-pressed', 'true'); } }
    function stop() { clearInterval(timer); timer = null; if (play) { play.textContent = 'Play'; play.setAttribute('aria-pressed', 'false'); } }
    if (play) play.addEventListener('click', function () { if (timer) stop(); else start(); });
    // The text under the reader's cursor or focus does not change while they read it.
    ['mouseenter', 'focusin'].forEach(function (e) { list.addEventListener(e, function () { held = true; }); });
    ['mouseleave', 'focusout'].forEach(function (e) { list.addEventListener(e, function () { held = false; }); });
    go(0);
    if (reduce) { stop(); if (play) play.hidden = true; } else start();
  })();

  /* The life of a note: review decisions move a note card between folders. */
  (function life() {
    var note = $('wf-note'), noteSt = $('wf-note-st'), cap = $('wf-cap'), old = $('wf-old'), oldSt = $('wf-old-st'), oldSb = $('wf-old-sb');
    if (!note || !noteSt || !cap || !old || !oldSt || !oldSb) return;
    var ACTS = {
      capture: { col: 0, s: 'inbox', c: '--ask', old: 'active',
        txt: 'The agent writes the decision to _inbox/ with status: inbox. It is a draft: brain-search shows it with a warning that nobody has reviewed it yet.' },
      keep: { col: 1, s: 'active', c: '--ok', old: 'active',
        txt: 'Keep: the summary is fixed if needed, status becomes active and the note moves to its topic folder. From now on it is trusted knowledge.' },
      merge: { col: 2, s: 'archived', c: '--muted', old: 'active',
        txt: 'Merge: the new part goes into the active note that already covers it, and the inbox note moves to _archive/ with status: archived.' },
      reject: { col: 2, s: 'archived', c: '--muted', old: 'active',
        txt: 'Reject: it was only true for that afternoon. The note moves to _archive/; nothing is deleted, so it can be recovered.' },
      supersede: { col: 1, s: 'active', c: '--ok', old: 'superseded',
        txt: 'Supersede: the new note becomes active, the old one gets status: superseded and superseded_by: "[[queue-kafka]]". It stays in its folder as history, and brain-search follows the chain to the current note.' }
    };
    var btns = document.querySelectorAll('.wf-actions .wf-btn');
    function act(k) {
      var a = ACTS[k], sup = a.old === 'superseded';
      note.style.left = 'calc(' + a.col + ' * (100% + 12px) / 3 + 8px)';
      note.style.setProperty('--nc', 'var(' + a.c + ')'); noteSt.textContent = a.s;
      oldSt.textContent = a.old; oldSb.innerHTML = sup ? '<br>superseded_by: "[[queue-kafka]]"' : '';
      old.style.setProperty('--nc', sup ? 'var(--muted)' : 'var(--ok)'); old.style.opacity = sup ? '0.7' : '1';
      cap.textContent = a.txt;
      btns.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-a') === k ? 'true' : 'false'); });
    }
    btns.forEach(function (b) { b.addEventListener('click', function () { act(b.getAttribute('data-a')); }); });
    act('capture');
  })();

  /* Hooks in one session: a timeline lights each hook as the session passes it. */
  (function hooks() {
    var track = $('wf-track'), fill = $('wf-fill'), cards = $('wf-hooks');
    if (!track || !fill || !cards) return;
    var HOOKS = [
      { at: 4, lbl: 'start', ev: 'SessionStart', c: '--pine', s: '--pine-soft', name: 'core.md · notices.py',
        p: 'The core rules on every start. On a fresh start, at most a few one-line notices: a new version, inbox notes older than 7 days, no garden run for 30 days.' },
      { at: 30, lbl: 'git push --force?', ev: 'PreToolUse', c: '--ask', s: '--ask-soft', name: 'guard.py',
        p: 'Before Bash, Edit, Write and MultiEdit: asks before destructive commands, cloud deletes, database drops, publish and merge commands, dependency installs and writes to protected files. On git commit it reminds the agent of the fast check.' },
      { at: 43, lbl: 'edit adds eval(', ev: 'PostToolUse', c: '--pine', s: '--pine-soft', name: 'patterns.py',
        p: 'After Edit, Write and MultiEdit: when the edit adds a known risky construct, one note with the safer form. It never blocks.' },
      { at: 55, lbl: 'same failure, third time', ev: 'PostToolUseFailure', c: '--ask', s: '--ask-soft', name: 'repeat-failure.py',
        p: 'The same failed call a third time in one run: one reminder to change the approach instead of retrying.' },
      { at: 72, lbl: 'compaction', ev: 'SessionStart', c: '--pine', s: '--pine-soft', name: 'state-card.py',
        p: 'After a compaction, resume or fork: a card from the active plan and docs/plans/.devos-state.md, so the agent knows where it stopped.' },
      { at: 96, lbl: 'end', ev: 'Stop', c: '--ok', s: '--ok-soft', name: 'capture-nudge.py',
        p: 'After a long session (30+ tool calls) it offers session-retro once, to keep what the session learned.' }
    ];
    var evs = [], cs = [];
    HOOKS.forEach(function (h) {
      var e = document.createElement('div'); e.className = 'wf-ev'; e.style.left = h.at + '%'; tint(e, h.c);
      var sp = document.createElement('span'); sp.textContent = h.lbl; e.appendChild(sp); track.appendChild(e); evs.push(e);
      var c = document.createElement('div'); c.className = 'wf-hook'; tint(c, h.c, h.s);
      c.innerHTML = '<span class="ev"></span><b></b><span class="p"></span>';
      c.querySelector('.ev').textContent = h.ev; c.querySelector('b').textContent = h.name; c.querySelector('.p').textContent = h.p;
      cards.appendChild(c); cs.push(c);
    });
    function paint(pct) {
      fill.style.width = pct + '%';
      HOOKS.forEach(function (h, i) { var lit = pct >= h.at && pct < h.at + 18; evs[i].classList.toggle('lit', lit); cs[i].classList.toggle('lit', lit); });
    }
    var btn = $('wf-hooks-play');
    function rest() { fill.style.width = '100%'; evs.forEach(function (e) { e.classList.add('lit'); }); cs.forEach(function (c) { c.classList.remove('lit'); }); }
    if (reduce) { rest(); if (btn) btn.hidden = true; return; }
    // One pass, started when the timeline is on screen; the button pauses, resumes and replays it.
    var DUR = 14000, elapsed = 0, last = null, running = false, frameId = null;
    function label(t) { if (btn) btn.textContent = t; }
    function frame(ts) {
      if (last !== null) elapsed += ts - last;
      last = ts;
      paint(Math.min(elapsed / DUR * 100, 100));
      if (elapsed >= DUR) { running = false; rest(); label('Replay'); return; }
      frameId = requestAnimationFrame(frame);
    }
    function run() { running = true; last = null; label('Pause'); frameId = requestAnimationFrame(frame); }
    function pause() { running = false; cancelAnimationFrame(frameId); label('Resume'); }
    if (btn) btn.addEventListener('click', function () {
      if (running) pause();
      else { if (elapsed >= DUR) { elapsed = 0; evs.forEach(function (e) { e.classList.remove('lit'); }); } run(); }
    });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es, o) { if (es[0].isIntersecting) { run(); o.disconnect(); } }, { threshold: 0.4 }).observe(track);
    } else run();
  })();

  /* One session in a terminal: the hook and skill lines are the plugin's own wording; the task is an example. */
  var SESSION = [
    { ch: 'Session starts', lines: [
      ['cmd', '$ claude'],
      ['hook', 'SessionStart · Vault: 3 inbox notes older than 7 days. Ask for brain-review.']
    ] },
    { ch: 'Searches first', lines: [
      ['you', '> What did we decide about webhook retries?'],
      ['dim', '  brain-search webhook retries'],
      ['out', 'Process each webhook once per event id; retries reuse the stored result.'],
      ['dim', '  — DEV/process-webhooks-once-per-event-id.md (active, updated 2026-10-02)'],
      ['out', 'The retry budget is three attempts with backoff.'],
      ['dim', '  — _inbox/retry-budget.md (inbox, unreviewed)']
    ] },
    { ch: 'Asks before risk', lines: [
      ['cmd', '$ pnpm add p-retry'],
      ['ask', 'guard asks · Dependency install, update or removal rewrites dependencies and the lockfile.'],
      ['you', '  Allow? yes']
    ] },
    { ch: 'Stops a retry loop', lines: [
      ['cmd', '$ pnpm test webhooks   ✗ failed (third time)'],
      ['hook', 'PostToolUseFailure · developer-os: this exact Bash call has failed 3 times, each within 10 minutes of the last. If nothing changed between the runs, do not run it again unchanged: read the error, find the cause, then change the approach or ask the user.']
    ] },
    { ch: 'Captures a decision', lines: [
      ['you', '> capture the decision: retries back off at 1, 4 and 16 seconds'],
      ['out', 'Wrote _inbox/retry-backoff-schedule.md'],
      ['dim', '  type: decision · status: inbox · summary: "Webhook retries back off at 1, 4 and 16 seconds."']
    ] },
    { ch: 'Commits with a check', lines: [
      ['cmd', '$ git commit -m "fix: back off webhook retries"'],
      ['hook', 'PreToolUse · Before this commit, run the project\'s fast check (lint, types, tests of the changed area) if you have not.']
    ] },
    { ch: 'You decide what stays', lines: [
      ['hook', 'Stop · developer-os: this session made 34 tool calls. Run the developer-os:session-retro skill: propose the wrap-up to the user and apply only what they approve. If nothing qualifies, end your turn with no output.'],
      ['ok', 'Done: retry backoff; fast check green (lint, types, 18 tests)'],
      ['ask', 'Not done: the e2e retry test, blocked on a staging key'],
      ['acc', 'Needs you: approve the push of fix/webhook-retries'],
      ['out', '1. Promote _inbox/retry-backoff-schedule.md after review   2. Delete the finished plan'],
      ['you', '> 2']
    ] }
  ];
  (function term() {
    var out = $('wf-term'), chips = $('wf-term-steps'), btn = $('wf-term-play');
    if (!out || !chips) return;
    var chipEls = [], ops = [], idx = 0, k = 0, cur = null, timer = null, paused = false, started = false;
    function line(kind, text) {
      // Follow the newest line only while the reader is already at the bottom.
      var follow = out.scrollHeight - out.scrollTop - out.clientHeight < 40;
      var d = document.createElement('div'); d.className = 'tl-' + kind; d.textContent = text; out.appendChild(d);
      if (follow) out.scrollTop = out.scrollHeight;
      return d;
    }
    function mark(i) { chipEls.forEach(function (c, j) { c.setAttribute('aria-current', j === i ? 'step' : 'false'); }); }
    function renderUpTo(n) { out.textContent = ''; for (var i = 0; i < n; i++) SESSION[i].lines.forEach(function (l) { line(l[0], l[1]); }); }
    function label(t) { if (btn) btn.textContent = t; }
    // One queue and one timer, so pause, resume and jump never leave a stray timeout behind.
    function tick() {
      timer = null;
      if (paused) return;
      var op = ops[idx];
      if (!op) { label('Replay'); return; }
      if (op.chap !== undefined) { mark(op.chap); idx++; return later(0); }
      if (op.wait) { idx++; return later(op.wait); }
      if (op.typed) {
        if (k === 0) cur = line(op.kind, '');
        cur.textContent = op.text.slice(0, ++k);
        if (k < op.text.length) return later(24);
        k = 0; idx++; return later(450);
      }
      line(op.kind, op.text); idx++; later(650);
    }
    function later(ms) { timer = setTimeout(tick, ms); }
    function playFrom(i) {
      started = true; clearTimeout(timer); renderUpTo(i);
      ops = []; idx = 0; k = 0; paused = false;
      for (var c = i; c < SESSION.length; c++) {
        ops.push({ chap: c });
        SESSION[c].lines.forEach(function (l) { ops.push({ kind: l[0], text: l[1], typed: l[0] === 'cmd' || l[0] === 'you' }); });
        ops.push({ wait: 1100 });
      }
      label('Pause'); tick();
    }
    SESSION.forEach(function (s, i) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = s.ch;
      b.addEventListener('click', function () { if (reduce) { renderUpTo(i + 1); mark(i); } else playFrom(i); });
      chips.appendChild(b); chipEls.push(b);
    });
    if (btn) btn.addEventListener('click', function () {
      if (!ops[idx]) return playFrom(0);
      paused = !paused; label(paused ? 'Resume' : 'Pause');
      if (!paused && !timer) tick();
    });
    if (reduce) { renderUpTo(SESSION.length); mark(SESSION.length - 1); if (btn) btn.hidden = true; return; }
    renderUpTo(1); mark(0); label('Play');
    function begin() { if (!started) playFrom(1); }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es, o) { if (es[0].isIntersecting) { begin(); o.disconnect(); } }, { threshold: 0.3 }).observe(out);
    } else begin();
  })();
})();
