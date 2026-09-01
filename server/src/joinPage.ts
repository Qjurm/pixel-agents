/**
 * The page a colleague lands on to join the office.
 *
 * Server-rendered rather than part of the React app on purpose: it has to work
 * for somebody who has installed nothing, and it is the one page whose whole
 * job is to be copied from. Styled with CODE14's own palette so it reads as
 * part of the office rather than a debug endpoint.
 */

import { CODE14 } from './brandPalette.js';

/** Escape for HTML text and attribute contexts. The token is ours, but the
 *  office URL is built from a caller-supplied Host header. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function joinPageHtml(officeUrl: string, teamToken: string): string {
  const command = `curl -fsSL ${officeUrl}/join.sh | sh`;
  const manual = `node join.js "${officeUrl}/?token=${teamToken}" --as YOURNAME`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Join the office</title>
<style>
  :root {
    --dark: ${CODE14.dark}; --coral: ${CODE14.coral}; --mint: ${CODE14.mint};
    --pale: ${CODE14.paleMint}; --paper: ${CODE14.paper}; --ink: ${CODE14.darker};
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 3rem 1.25rem 5rem; background: var(--paper); color: var(--ink);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.6;
  }
  main { max-width: 44rem; margin: 0 auto; }
  .tag { color: var(--coral); font-size: .72rem; letter-spacing: .18em; text-transform: uppercase; }
  h1 { font-size: 1.9rem; margin: .4rem 0 .3rem; letter-spacing: -.02em; }
  p { margin: 0 0 1rem; max-width: 34rem; }
  .step { border-left: 3px solid var(--mint); padding: 0 0 0 1rem; margin: 2rem 0; }
  .step h2 { font-size: .95rem; margin: 0 0 .5rem; }
  .cmd {
    display: flex; gap: .5rem; align-items: stretch; background: var(--dark);
    border-radius: 3px; overflow: hidden;
  }
  .cmd code {
    flex: 1; color: var(--paper); padding: .8rem .9rem; font-size: .82rem;
    overflow-x: auto; white-space: pre;
  }
  button {
    border: 0; background: var(--coral); color: var(--dark); font: inherit; font-size: .78rem;
    padding: 0 1rem; cursor: pointer; font-weight: 600;
  }
  button:hover { filter: brightness(1.06); }
  button:focus-visible { outline: 2px solid var(--ink); outline-offset: -4px; }
  .note { background: var(--pale); padding: .8rem .9rem; border-radius: 3px; font-size: .84rem; }
  ul { padding-left: 1.1rem; margin: .4rem 0 0; }
  footer { margin-top: 2.5rem; font-size: .78rem; color: ${CODE14.muted}; }
</style>
</head>
<body>
<main>
  <span class="tag">Pixel Agents</span>
  <h1>Join this office</h1>
  <p>
    One command on your own machine. No clone, no npm, no build — the office
    hands you everything it needs you to have.
  </p>

  <div class="step">
    <h2>1 · Run this in a terminal</h2>
    <div class="cmd">
      <code id="cmd">${esc(command)}</code>
      <button type="button" data-copy="cmd">Copy</button>
    </div>
    <p style="margin-top:.7rem">
      It downloads a small joiner, shows you exactly what it will write to
      <code>~/.claude/settings.json</code>, and asks before touching anything.
      Add <code>--as YOURNAME</code> to pick the name you wear in the office.
    </p>
  </div>

  <div class="step">
    <h2>2 · Start Claude Code anywhere</h2>
    <p style="margin:0">
      Your character walks in within a few seconds. Already running? You appear
      on your next action — nothing to restart.
    </p>
  </div>

  <div class="note">
    <strong>What the office sees:</strong> that you are busy, and roughly what kind
    of work it is — reading, writing, running something. Never your file paths,
    your project names, your prompts or your code.
    <ul>
      <li>Node is required; the hook Claude runs is a Node script.</li>
      <li>Anyone who can open this page can join, so keep it on your own network.</li>
      <li>Leave any time: the same command with <code>--leave</code> on the end.</li>
    </ul>
  </div>

  <footer>
    No <code>curl</code>, or want to look first? Download
    <a href="/api/join.js">join.js</a> and run:<br>
    <code>${esc(manual)}</code>
  </footer>
</main>
<script>
  document.querySelectorAll('button[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var el = document.getElementById(btn.getAttribute('data-copy'));
      var text = el ? el.textContent : '';
      var done = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy'; }, 1600); };
      // Clipboard API needs a secure context; a plain-HTTP office on the LAN is
      // not one, so fall back to the old selection trick rather than failing.
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done, function () { fallback(text, done); });
      } else {
        fallback(text, done);
      }
    });
  });
  function fallback(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* leave it selected to copy by hand */ }
    document.body.removeChild(ta);
  }
</script>
</body>
</html>`;
}
