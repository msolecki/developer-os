// developer-os site: sidebar navigation, on-page contents, heading anchors, copy buttons, full-size diagrams, the skill filter.
// Every page sets <html data-root="../"> (the path back to site/); links below are relative to site/.
(function () {
  var NAV = [
    ['Start', [
      ['index.html', 'Home'],
      ['docs/index.html', 'Documentation index'],
      ['docs/readme.html', 'README'],
      ['docs/getting-started.html', 'Your first 30 minutes'],
      ['docs/workflow.html', 'How to work: brain + code'],
      ['workflow.html', 'Workflow at a glance'],
    ]],
    ['Product', [
      ['docs/product/overview.html', 'Product overview'],
      ['docs/product/functional-spec.html', 'Functional specification'],
      ['docs/product/decisions.html', 'Decisions'],
    ]],
    ['Architecture and reference', [
      ['docs/architecture/overview.html', 'Architecture overview'],
      ['docs/reference/hooks.html', 'Hooks reference'],
      ['docs/reference/configuration.html', 'Configuration reference'],
      ['docs/reference/skills.html', 'Skills reference'],
      ['docs/glossary.html', 'Glossary'],
    ]],
    ['Components', [
      ['skills/index.html', 'Skills'],
      ['agents.html', 'Agents'],
      ['output-styles.html', 'Output styles'],
    ]],
    ['Contribute', [
      ['docs/development.html', 'Development guide'],
      ['docs/pitfalls.html', 'Pitfalls'],
      ['docs/contributing.html', 'Contributing'],
      ['docs/security.html', 'Security'],
    ]],
    ['Status', [
      ['docs/changelog.html', 'Changelog'],
    ]],
  ];

  var root = document.documentElement.getAttribute('data-root') || '';
  var here = location.pathname.replace(/index\.html$/, '');

  function isCurrent(href) {
    var a = document.createElement('a');
    a.href = root + href;
    return a.pathname.replace(/index\.html$/, '') === here;
  }

  var side = document.getElementById('sidebar-nav');
  if (side) {
    var html = '';
    NAV.forEach(function (group) {
      html += '<h2>' + group[0] + '</h2><ul>';
      group[1].forEach(function (item) {
        var cur = isCurrent(item[0]) || (item[0] === 'skills/index.html' && /\/skills\/[^/]+$/.test(location.pathname)) ? ' aria-current="page"' : '';
        html += '<li><a href="' + root + item[0] + '"' + cur + '>' + item[1] + '</a></li>';
      });
      html += '</ul>';
    });
    side.innerHTML = html;
    var details = side.closest('details');
    if (details && window.matchMedia('(min-width: 861px)').matches) details.open = true;
  }

  document.querySelectorAll('.site-nav a').forEach(function (a) {
    var h = a.getAttribute('href');
    if (h && h.charAt(0) !== '#' && h.indexOf(':') < 0 && isCurrent(h.slice(root.length))) a.setAttribute('aria-current', 'page');
  });

  var article = document.querySelector('.prose');
  var heads = article ? article.querySelectorAll('h2[id], h3[id]') : [];
  heads.forEach(function (h) {
    var a = document.createElement('a');
    a.className = 'anchor';
    a.href = '#' + h.id;
    a.setAttribute('aria-label', 'Link to this section');
    a.textContent = '#';
    h.appendChild(a);
  });

  var toc = document.getElementById('toc');
  if (toc && heads.length > 1) {
    var list = '<p>On this page</p><ul>';
    heads.forEach(function (h) {
      var copy = h.cloneNode(true);
      copy.querySelectorAll('.anchor').forEach(function (a) { a.remove(); });
      var text = copy.textContent;
      list += '<li class="' + h.tagName.toLowerCase() + '"><a href="#' + h.id + '">' + text.replace(/</g, '&lt;') + '</a></li>';
    });
    toc.innerHTML = list + '</ul>';
    if ('IntersectionObserver' in window) {
      var links = toc.querySelectorAll('a');
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          links.forEach(function (l) { l.classList.toggle('active', l.getAttribute('href') === '#' + e.target.id); });
        });
      }, { rootMargin: '0px 0px -75% 0px' });
      heads.forEach(function (h) { io.observe(h); });
    }
  } else if (toc) {
    toc.remove();
  }

  document.querySelectorAll('pre, .install-line').forEach(function (pre) {
    if (!pre.hasAttribute('tabindex')) pre.setAttribute('tabindex', '0');
    if (pre.hasAttribute('data-nocopy')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy';
    btn.textContent = 'Copy';
    btn.setAttribute('aria-live', 'polite');
    btn.addEventListener('click', function () {
      var code = pre.querySelector('code') || pre;
      if (!navigator.clipboard) { btn.textContent = 'Select and copy'; return; }
      navigator.clipboard.writeText(code.textContent.replace(/\n$/, '')).then(function () {
        btn.textContent = 'Copied';
        setTimeout(function () { btn.textContent = 'Copy'; }, 1600);
      }, function () { btn.textContent = 'Select and copy'; });
    });
    pre.appendChild(btn);
  });

  document.querySelectorAll('[role="tablist"]').forEach(function (list) {
    var tabs = list.querySelectorAll('[role="tab"]');
    function select(tab) {
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      });
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { select(t); });
      t.addEventListener('keydown', function (e) {
        var k = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
        if (!k) return;
        e.preventDefault();
        var next = tabs[(i + k + tabs.length) % tabs.length];
        select(next); next.focus();
      });
    });
  });

  // Wide diagrams (.table-wrap.wide-fig): an "Open full size" button under each opens the diagram in a
  // full-viewport dialog, and the on-page contents step aside while a diagram passes them.
  var figs = document.querySelectorAll('.table-wrap.wide-fig');
  if (figs.length) {
    var dlg = null, figHome = null, figOpener = null;
    var figTitle = function (wrap) {
      for (var e = wrap.previousElementSibling; e; e = e.previousElementSibling) {
        if (/^H[1-4]$/.test(e.tagName)) {
          var copy = e.cloneNode(true);
          copy.querySelectorAll('.anchor').forEach(function (a) { a.remove(); });
          return copy.textContent;
        }
      }
      return 'Diagram';
    };
    var openFig = function (wrap, btn) {
      var svg = wrap.querySelector('svg');
      if (!svg) return;
      if (!dlg) {
        dlg = document.createElement('dialog');
        dlg.className = 'fig-dialog';
        dlg.innerHTML = '<div class="fig-bar"><span></span><button type="button" class="wf-btn">Close</button></div><div class="fig-body" tabindex="0"></div>';
        document.body.appendChild(dlg);
        dlg.querySelector('button').addEventListener('click', function () { dlg.close(); });
        // Escape closes a modal dialog by itself; either way the diagram goes back and focus returns to its button.
        dlg.addEventListener('close', function () {
          var moved = dlg.querySelector('.fig-body svg');
          if (moved && figHome) figHome.appendChild(moved);
          if (figHome) figHome.style.minHeight = '';
          document.documentElement.classList.remove('fig-lock');
          if (figOpener) figOpener.focus();
        });
      }
      figHome = wrap; figOpener = btn;
      var title = figTitle(wrap);
      dlg.setAttribute('aria-label', title + ', full size');
      dlg.querySelector('.fig-bar span').textContent = title;
      wrap.style.minHeight = wrap.offsetHeight + 'px';
      dlg.querySelector('.fig-body').appendChild(svg);
      document.documentElement.classList.add('fig-lock');
      dlg.showModal();
    };
    if (window.HTMLDialogElement) {
      figs.forEach(function (wrap) {
        var p = document.createElement('p');
        p.className = 'fig-tools';
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wf-btn';
        btn.textContent = 'Open full size';
        btn.addEventListener('click', function () { openFig(wrap, btn); });
        p.appendChild(btn);
        wrap.insertAdjacentElement('afterend', p);
      });
    }
    if (toc && toc.isConnected) {
      var asked = false;
      var clearToc = function () {
        asked = false;
        var t = toc.getBoundingClientRect(), hit = false;
        if (t.width) {
          figs.forEach(function (f) {
            var r = f.getBoundingClientRect();
            if (r.right > t.left - 8 && r.bottom > t.top - 8 && r.top < t.bottom + 8) hit = true;
          });
        }
        toc.classList.toggle('is-covered', hit);
      };
      var askClear = function () { if (!asked) { asked = true; requestAnimationFrame(clearToc); } };
      window.addEventListener('scroll', askClear, { passive: true });
      window.addEventListener('resize', askClear);
      clearToc();
    }
  }

  // 404.html sets <base>, so a "#id" link there would lead to the base URL: move within the page instead.
  if (document.querySelector('base')) {
    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var target = document.getElementById(a.getAttribute('href').slice(1));
        if (!target) return;
        e.preventDefault();
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        target.focus();
        target.scrollIntoView();
      });
    });
  }

  var filter = document.getElementById('skill-filter');
  if (filter) {
    filter.addEventListener('input', function () {
      var q = filter.value.trim().toLowerCase();
      document.querySelectorAll('.lib li').forEach(function (li) {
        li.hidden = q && li.textContent.toLowerCase().indexOf(q) < 0;
      });
      document.querySelectorAll('.lib-group').forEach(function (g) {
        g.hidden = !g.querySelector('.lib li:not([hidden])');
      });
    });
    // skills/index.html?q=review arrives filtered: the form on 404.html sends its query this way.
    var asked0 = window.URLSearchParams ? new URLSearchParams(location.search).get('q') : '';
    if (asked0) {
      filter.value = asked0;
      filter.dispatchEvent(new Event('input'));
    }
  }
})();
