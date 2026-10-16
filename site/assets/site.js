// developer-os site: sidebar navigation, on-page contents, heading anchors, copy buttons.
// Every page sets <html data-root="../"> (the path back to site/); links below are relative to site/.
(function () {
  var NAV = [
    ['Start', [
      ['index.html', 'Home'],
      ['docs/index.html', 'Documentation index'],
      ['docs/readme.html', 'README'],
      ['docs/workflow.html', 'How to work: brain + code'],
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
      ['docs/CURRENT-STATE.html', 'Current state'],
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
        var cur = isCurrent(item[0]) ? ' aria-current="page"' : '';
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
      var text = h.firstChild ? h.childNodes[0].textContent : h.textContent;
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

  document.querySelectorAll('pre').forEach(function (pre) {
    if (!pre.hasAttribute('tabindex')) pre.setAttribute('tabindex', '0');
    if (pre.hasAttribute('data-nocopy')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy';
    btn.textContent = 'Copy';
    btn.setAttribute('aria-live', 'polite');
    btn.addEventListener('click', function () {
      var code = pre.querySelector('code') || pre;
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
  }
})();
