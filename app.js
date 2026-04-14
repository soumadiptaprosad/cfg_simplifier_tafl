/* ============================================
   CFG Simplification Visualizer — Animated Application
   ============================================ */

(function () {
  'use strict';

  // ===================== PRESET GRAMMARS =====================

  const PRESETS = {
    example1: {
      label: 'Null + Unit + Useless',
      text: 'S -> A B | a\nA -> a | ε\nB -> b | A\nC -> c'
    },
    example2: {
      label: 'Multiple Null Productions',
      text: 'S -> A B C\nA -> a A | ε\nB -> b B | ε\nC -> c'
    },
    example3: {
      label: 'Chain Unit Productions',
      text: 'S -> A\nA -> B\nB -> C | b\nC -> D | c\nD -> a'
    },
    example4: {
      label: 'Already Simplified',
      text: 'S -> a B | b A | a\nA -> a B | a\nB -> b A | b'
    }
  };

  // ===================== GRAMMAR PARSER =====================

  function parseGrammar(text) {
    const lines = text.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) throw new Error('No productions entered.');

    const productions = new Map();
    const nonTerminals = new Set();
    const terminals = new Set();
    let startSymbol = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const arrowMatch = line.match(/^([A-Z])\s*(?:->|→)\s*(.+)$/);
      if (!arrowMatch) throw new Error(`Line ${i + 1}: Invalid format "${line}". Expected: A -> ...`);

      const lhs = arrowMatch[1];
      const rhsStr = arrowMatch[2];
      if (startSymbol === null) startSymbol = lhs;
      nonTerminals.add(lhs);

      const alternatives = rhsStr.split('|').map(alt => alt.trim());
      const rhsList = [];

      for (const alt of alternatives) {
        if (alt === 'ε') {
          rhsList.push(['ε']);
        } else {
          const symbols = [];
          for (const ch of alt.replace(/\s+/g, '')) symbols.push(ch);
          if (symbols.length === 0) throw new Error(`Line ${i + 1}: Empty alternative.`);
          rhsList.push(symbols);
        }
      }

      if (productions.has(lhs)) productions.get(lhs).push(...rhsList);
      else productions.set(lhs, rhsList);
    }

    for (const [, rhsList] of productions) {
      for (const rhs of rhsList) {
        for (const sym of rhs) {
          if (sym !== 'ε' && !nonTerminals.has(sym)) terminals.add(sym);
        }
      }
    }

    return { startSymbol, nonTerminals: new Set(nonTerminals), terminals: new Set(terminals), productions };
  }

  function cloneGrammar(g) {
    const prods = new Map();
    for (const [lhs, rhsList] of g.productions) prods.set(lhs, rhsList.map(rhs => [...rhs]));
    return { startSymbol: g.startSymbol, nonTerminals: new Set(g.nonTerminals), terminals: new Set(g.terminals), productions: prods };
  }

  function grammarToLines(g) {
    const lines = [];
    const order = [g.startSymbol, ...[...g.nonTerminals].filter(n => n !== g.startSymbol).sort()];
    for (const nt of order) {
      if (!g.productions.has(nt)) continue;
      const rhsList = g.productions.get(nt);
      if (rhsList.length === 0) continue;
      const rhsStrs = rhsList.map(rhs => rhs.join(' '));
      lines.push({ lhs: nt, rhsStrs, raw: `${nt} → ${rhsStrs.join(' | ')}` });
    }
    return lines;
  }

  function prodStr(lhs, rhs) { return `${lhs} → ${rhs.join(' ')}`; }

  function rebuildTerminals(g) {
    g.terminals = new Set();
    for (const [, rhsList] of g.productions) {
      for (const rhs of rhsList) {
        for (const sym of rhs) {
          if (sym !== 'ε' && !g.nonTerminals.has(sym)) g.terminals.add(sym);
        }
      }
    }
  }

  // ===================== ALGORITHM 1: NULL PRODUCTIONS =====================

  function removeNullProductions(grammar) {
    const frames = [];
    const g = cloneGrammar(grammar);

    // Find nullable set
    const nullable = new Set();
    for (const [lhs, rhsList] of g.productions) {
      for (const rhs of rhsList) {
        if (rhs.length === 1 && rhs[0] === 'ε') nullable.add(lhs);
      }
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const [lhs, rhsList] of g.productions) {
        if (nullable.has(lhs)) continue;
        for (const rhs of rhsList) {
          if (rhs.every(sym => nullable.has(sym))) { nullable.add(lhs); changed = true; break; }
        }
      }
    }

    frames.push({
      phase: 1,
      title: 'Identify Nullable Symbols',
      subtitle: nullable.size > 0
        ? 'A symbol is <strong>nullable</strong> if it can derive ε (empty string). We use fixed-point iteration to find all nullable symbols.'
        : 'No symbol derives ε — there are no null productions to remove. This grammar is already free of ε-productions.',
      grammar: g,
      sets: nullable.size > 0 ? [{ label: 'Nullable Set', items: [...nullable].sort(), cls: 'nullable' }] : [],
      noChange: nullable.size === 0
    });

    if (nullable.size === 0) return { grammar: g, frames };

    // Remove ε and generate combinations
    const newProductions = new Map();
    const removedProds = [];
    const addedProds = [];

    for (const [lhs, rhsList] of g.productions) {
      const newRhsList = [];
      for (const rhs of rhsList) {
        if (rhs.length === 1 && rhs[0] === 'ε') { removedProds.push(prodStr(lhs, rhs)); continue; }

        const nullablePos = [];
        for (let i = 0; i < rhs.length; i++) { if (nullable.has(rhs[i])) nullablePos.push(i); }

        if (nullablePos.length === 0) { newRhsList.push([...rhs]); continue; }

        const subsetCount = 1 << nullablePos.length;
        for (let mask = 0; mask < subsetCount; mask++) {
          const newRhs = [];
          for (let i = 0; i < rhs.length; i++) {
            const npIdx = nullablePos.indexOf(i);
            if (npIdx !== -1 && (mask & (1 << npIdx))) continue;
            newRhs.push(rhs[i]);
          }
          if (newRhs.length > 0) newRhsList.push(newRhs);
        }
      }

      const seen = new Set();
      const deduped = [];
      for (const rhs of newRhsList) {
        const key = rhs.join(',');
        if (!seen.has(key)) { seen.add(key); deduped.push(rhs); }
      }
      if (deduped.length > 0) newProductions.set(lhs, deduped);
    }

    for (const [lhs, rhsList] of newProductions) {
      const origKeys = new Set((g.productions.get(lhs) || []).map(r => r.join(',')));
      for (const rhs of rhsList) { if (!origKeys.has(rhs.join(','))) addedProds.push(prodStr(lhs, rhs)); }
    }

    // Frame: show removed ε-productions (with strikethrough on original grammar)
    frames.push({
      phase: 1,
      title: 'Remove ε-Productions',
      subtitle: 'All direct ε-productions are removed. For every production containing nullable symbols, we generate all combinations with and without those symbols.',
      grammarBefore: g,
      removedProds,
      callout: removedProds.length > 0 ? { type: 'removed', icon: '🗑️', text: `Removed: ${removedProds.join(', ')}` } : null
    });

    if (addedProds.length > 0) {
      frames.push({
        phase: 1,
        title: 'Add Compensating Productions',
        subtitle: 'New alternative productions are added to preserve the language generated by the grammar.',
        callout: { type: 'added', icon: '➕', text: `Added: ${addedProds.join(', ')}` }
      });
    }

    const result = { startSymbol: g.startSymbol, nonTerminals: new Set([...newProductions.keys()]), terminals: new Set(), productions: newProductions };
    rebuildTerminals(result);

    frames.push({
      phase: 1,
      title: 'Result: Null-Free Grammar',
      subtitle: 'The grammar after removing all null productions and adding compensating alternatives.',
      grammar: result,
      isPhaseResult: true
    });

    return { grammar: result, frames };
  }

  // ===================== ALGORITHM 2: UNIT PRODUCTIONS =====================

  function removeUnitProductions(grammar) {
    const frames = [];
    const g = cloneGrammar(grammar);

    const unitPairs = new Map();
    for (const nt of g.nonTerminals) unitPairs.set(nt, new Set([nt]));

    let changed = true;
    while (changed) {
      changed = false;
      for (const [A, reachable] of unitPairs) {
        for (const B of [...reachable]) {
          for (const rhs of (g.productions.get(B) || [])) {
            if (rhs.length === 1 && g.nonTerminals.has(rhs[0])) {
              if (!reachable.has(rhs[0])) { reachable.add(rhs[0]); changed = true; }
            }
          }
        }
      }
    }

    const displayPairs = [];
    for (const [A, reachable] of unitPairs) { for (const B of reachable) { if (A !== B) displayPairs.push(`(${A}, ${B})`); } }

    const unitProdsList = [];
    for (const [lhs, rhsList] of g.productions) {
      for (const rhs of rhsList) { if (rhs.length === 1 && g.nonTerminals.has(rhs[0])) unitProdsList.push(prodStr(lhs, rhs)); }
    }

    if (unitProdsList.length === 0) {
      frames.push({
        phase: 2,
        title: 'No Unit Productions Found',
        subtitle: 'There are no productions of the form A → B (where B is a non-terminal). The grammar is already free of unit productions.',
        grammar: g,
        noChange: true
      });
      return { grammar: g, frames };
    }

    frames.push({
      phase: 2,
      title: 'Identify Unit Productions',
      subtitle: 'A <strong>unit production</strong> has the form A → B where B is a single non-terminal. We compute all unit pairs (A, B) where A derives B through unit productions.',
      grammar: g,
      unitProds: unitProdsList,
      sets: [{ label: 'Unit Pairs', items: displayPairs, cls: 'unit' }]
    });

    // Build new productions
    const newProductions = new Map();
    const addedProds = [];

    for (const [A, reachable] of unitPairs) {
      const newRhsList = [];
      const seen = new Set();
      for (const B of reachable) {
        for (const rhs of (g.productions.get(B) || [])) {
          if (rhs.length === 1 && g.nonTerminals.has(rhs[0])) continue;
          const key = rhs.join(',');
          if (!seen.has(key)) { seen.add(key); newRhsList.push([...rhs]); if (A !== B) addedProds.push(prodStr(A, rhs)); }
        }
      }
      if (newRhsList.length > 0) newProductions.set(A, newRhsList);
    }

    frames.push({
      phase: 2,
      title: 'Remove & Replace Unit Productions',
      subtitle: 'Each unit production A → B is replaced by all non-unit productions of B (and transitively all NTs reachable from B).',
      grammarBefore: g,
      removedProds: unitProdsList,
      callout: { type: 'removed', icon: '🗑️', text: `Removed: ${unitProdsList.join(', ')}` }
    });

    if (addedProds.length > 0) {
      frames.push({
        phase: 2,
        title: 'Add Replacement Productions',
        subtitle: 'For each unit pair (A, B), all non-unit productions of B are copied to A.',
        callout: { type: 'added', icon: '➕', text: `Added: ${addedProds.join(', ')}` }
      });
    }

    const result = { startSymbol: g.startSymbol, nonTerminals: new Set([...newProductions.keys()]), terminals: new Set(), productions: newProductions };
    rebuildTerminals(result);

    frames.push({
      phase: 2,
      title: 'Result: Unit-Free Grammar',
      subtitle: 'The grammar after removing all unit productions and adding replacements.',
      grammar: result,
      isPhaseResult: true
    });

    return { grammar: result, frames };
  }

  // ===================== ALGORITHM 3: USELESS SYMBOLS =====================

  function removeUselessSymbols(grammar) {
    const frames = [];
    const g = cloneGrammar(grammar);

    // Phase A: generating
    const generating = new Set([...g.terminals]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [lhs, rhsList] of g.productions) {
        if (generating.has(lhs)) continue;
        for (const rhs of rhsList) {
          if (rhs.every(sym => generating.has(sym))) { generating.add(lhs); changed = true; break; }
        }
      }
    }

    const nonGenerating = [...g.nonTerminals].filter(nt => !generating.has(nt));

    frames.push({
      phase: 3,
      title: 'Phase A — Find Generating Symbols',
      subtitle: 'A symbol is <strong>generating</strong> if it can derive a string of terminals. We compute this via fixed-point iteration.',
      grammar: g,
      sets: [
        { label: 'Generating', items: [...generating].filter(s => g.nonTerminals.has(s)).sort(), cls: 'generating' },
        ...(nonGenerating.length > 0 ? [{ label: 'Non-Generating', items: nonGenerating.sort(), cls: 'useless' }] : [])
      ]
    });

    let midGrammar = cloneGrammar(g);
    if (nonGenerating.length > 0) {
      const removedProds = [];
      const newProductions = new Map();
      for (const [lhs, rhsList] of midGrammar.productions) {
        if (!generating.has(lhs)) { for (const rhs of rhsList) removedProds.push(prodStr(lhs, rhs)); continue; }
        const filtered = rhsList.filter(rhs => {
          const keep = rhs.every(sym => generating.has(sym));
          if (!keep) removedProds.push(prodStr(lhs, rhs));
          return keep;
        });
        if (filtered.length > 0) newProductions.set(lhs, filtered);
      }
      midGrammar.productions = newProductions;
      midGrammar.nonTerminals = new Set([...newProductions.keys()]);
      rebuildTerminals(midGrammar);

      frames.push({
        phase: 3,
        title: 'Remove Non-Generating Productions',
        subtitle: 'Productions containing non-generating symbols are removed from the grammar.',
        callout: { type: 'removed', icon: '🗑️', text: `Removed: ${removedProds.join(', ')}` },
        grammar: midGrammar
      });
    }

    // Phase B: reachable
    const reachable = new Set();
    const queue = [midGrammar.startSymbol];
    reachable.add(midGrammar.startSymbol);
    while (queue.length > 0) {
      const sym = queue.shift();
      for (const rhs of (midGrammar.productions.get(sym) || [])) {
        for (const s of rhs) {
          if (!reachable.has(s)) { reachable.add(s); if (midGrammar.nonTerminals.has(s)) queue.push(s); }
        }
      }
    }

    const unreachable = [...midGrammar.nonTerminals].filter(nt => !reachable.has(nt));

    frames.push({
      phase: 3,
      title: 'Phase B — Find Reachable Symbols',
      subtitle: `Starting from the start symbol <strong>${midGrammar.startSymbol}</strong>, we find all reachable symbols via BFS traversal.`,
      grammar: midGrammar,
      sets: [
        { label: 'Reachable', items: [...reachable].filter(s => midGrammar.nonTerminals.has(s)).sort(), cls: 'reachable' },
        ...(unreachable.length > 0 ? [{ label: 'Unreachable', items: unreachable.sort(), cls: 'useless' }] : [])
      ]
    });

    let result = cloneGrammar(midGrammar);
    if (unreachable.length > 0) {
      const removedProds = [];
      const newProductions = new Map();
      for (const [lhs, rhsList] of result.productions) {
        if (!reachable.has(lhs)) { for (const rhs of rhsList) removedProds.push(prodStr(lhs, rhs)); continue; }
        const filtered = rhsList.filter(rhs => {
          const keep = rhs.every(sym => reachable.has(sym));
          if (!keep) removedProds.push(prodStr(lhs, rhs));
          return keep;
        });
        if (filtered.length > 0) newProductions.set(lhs, filtered);
      }
      result.productions = newProductions;
      result.nonTerminals = new Set([...newProductions.keys()]);
      rebuildTerminals(result);

      frames.push({
        phase: 3,
        title: 'Remove Unreachable Productions',
        subtitle: 'Productions containing unreachable symbols are removed.',
        callout: { type: 'removed', icon: '🗑️', text: `Removed: ${removedProds.join(', ')}` },
        grammar: result
      });
    }

    if (nonGenerating.length === 0 && unreachable.length === 0) {
      frames.push({
        phase: 3,
        title: 'No Useless Symbols',
        subtitle: 'All symbols are generating and reachable. No changes needed.',
        grammar: result,
        noChange: true
      });
    }

    frames.push({
      phase: 3,
      title: 'Result: Clean Grammar',
      subtitle: 'The grammar after removing all useless (non-generating and unreachable) symbols.',
      grammar: result,
      isPhaseResult: true
    });

    return { grammar: result, frames };
  }

  // ===================== HTML HELPERS =====================

  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function renderProdLineHTML(lhs, rhsStrs, extraClass) {
    const cls = extraClass ? ` ${extraClass}` : '';
    let html = `<div class="prod-line${cls}">`;
    html += `<span class="non-terminal">${esc(lhs)}</span><span class="arrow"> → </span>`;
    rhsStrs.forEach((alt, i) => {
      if (i > 0) html += `<span class="pipe"> | </span>`;
      for (const sym of alt.split(' ')) {
        if (sym === 'ε') html += `<span class="epsilon">ε</span>`;
        else if (/^[A-Z]$/.test(sym)) html += `<span class="non-terminal">${esc(sym)}</span>`;
        else html += `<span class="terminal">${esc(sym)}</span>`;
        html += ' ';
      }
    });
    html += `</div>`;
    return html;
  }

  function renderGrammarBlock(g, opts) {
    const o = opts || {};
    const lines = grammarToLines(g);
    if (lines.length === 0) return '<div class="prod-line" style="color:var(--text-muted);font-style:italic">∅ (empty grammar)</div>';

    const removedSet = new Set(o.removedProds || []);
    const addedSet = new Set(o.addedProds || []);
    const unitSet = new Set(o.unitProds || []);

    return lines.map(line => {
      let cls = '';
      if (removedSet.has(line.raw)) cls = 'highlight-remove strike';
      else if (addedSet.has(line.raw)) cls = 'highlight-add';
      else if (unitSet.has(line.raw)) cls = 'highlight-change';
      return renderProdLineHTML(line.lhs, line.rhsStrs, cls);
    }).join('');
  }

  function renderSetsHTML(sets) {
    if (!sets || sets.length === 0) return '';
    return sets.map(s => {
      const badges = s.items.length === 0
        ? '<span class="frame-badge ' + s.cls + '">∅</span>'
        : s.items.map(item => `<span class="frame-badge ${s.cls}">${esc(item)}</span>`).join('');
      return `<div class="frame-set-section"><div class="frame-set-label">${s.label}</div><div class="frame-set-badges">${badges}</div></div>`;
    }).join('');
  }

  function renderCallout(callout) {
    if (!callout) return '';
    return `<div class="frame-callout ${callout.type}"><span class="frame-callout-icon">${callout.icon}</span><div>${esc(callout.text)}</div></div>`;
  }

  const PHASE_NAMES = { 0: 'Original Grammar', 1: 'Null Productions', 2: 'Unit Productions', 3: 'Useless Symbols', final: 'Simplified' };
  const PHASE_ICONS = { 0: '📝', 1: '🚫', 2: '🔗', 3: '🧹', final: '✨' };

  /** Build HTML for a single animation frame */
  function buildFrameHTML(frame, index) {
    const phaseKey = frame.phase === 'final' ? 'final' : frame.phase;
    const phaseCls = frame.phase === 'final' ? 'phase-final' : `phase-${frame.phase}`;

    let html = `<div class="anim-frame" data-index="${index}" id="frame-${index}">`;

    // Phase badge
    html += `<div class="frame-phase-badge ${phaseCls}"><span class="frame-phase-dot"></span>${PHASE_NAMES[phaseKey]}</div>`;

    // Title
    html += `<div class="frame-title">${esc(frame.title)}</div>`;

    // Subtitle
    if (frame.subtitle) html += `<div class="frame-subtitle">${frame.subtitle}</div>`;

    // Callout
    if (frame.callout) html += renderCallout(frame.callout);

    // Sets
    if (frame.sets) html += renderSetsHTML(frame.sets);

    // Grammar display (before with highlights, or result)
    if (frame.grammarBefore) {
      html += `<div class="frame-grammar-card"><div class="frame-grammar-label">Grammar (with changes highlighted)</div><div class="frame-grammar-body">`;
      html += renderGrammarBlock(frame.grammarBefore, { removedProds: frame.removedProds, unitProds: frame.unitProds });
      html += `</div></div>`;
    }

    if (frame.grammar) {
      const isFinal = frame.isPhaseResult || frame.phase === 'final';
      html += `<div class="frame-grammar-card${isFinal ? ' final-card' : ''}"><div class="frame-grammar-label">${isFinal ? (frame.phase === 'final' ? '✨ Final Simplified Grammar' : '📋 Resulting Grammar') : 'Current Grammar'}</div><div class="frame-grammar-body">`;
      html += renderGrammarBlock(frame.grammar);
      html += `</div></div>`;
    }

    if (frame.noChange) {
      html += `<div class="frame-callout info"><span class="frame-callout-icon">✅</span><div>No changes were needed in this phase.</div></div>`;
    }

    html += `</div>`;
    return html;
  }

  // ===================== ANIMATION CONTROLLER =====================

  let animFrames = [];
  let currentFrame = 0;
  let isPlaying = false;
  let playTimer = null;
  let playDelay = 3; // seconds pause per frame

  const vizPanel = document.getElementById('viz-panel');

  function clearViz() {
    vizPanel.innerHTML = '';
    animFrames = [];
    currentFrame = 0;
    isPlaying = false;
    if (playTimer) { clearTimeout(playTimer); playTimer = null; }
  }

  function buildControllerHTML() {
    return `
      <div class="anim-controller" id="anim-controller">
        <button class="anim-btn" id="anim-prev" title="Previous Step">⏮</button>
        <button class="anim-btn play-btn" id="anim-play" title="Play / Pause">▶</button>
        <button class="anim-btn" id="anim-next" title="Next Step">⏭</button>
        <div class="anim-progress-wrap">
          <div class="anim-progress-bar" id="anim-progress-bar">
            <div class="anim-progress-fill" id="anim-progress-fill" style="width:0%"></div>
          </div>
          <div class="anim-step-label">
            <span class="current-step-text" id="anim-step-text">Step 1</span>
            <span id="anim-step-count">1 / 1</span>
          </div>
        </div>
        <div class="speed-control">
          <span class="speed-label" id="speed-label">3s</span>
          <input type="range" class="speed-slider" id="speed-slider" min="1" max="10" step="0.5" value="3" title="Pause duration per step">
        </div>
      </div>
    `;
  }

  function showFrame(index, direction) {
    if (index < 0 || index >= animFrames.length) return;

    const prevEl = vizPanel.querySelector('.anim-frame.active');
    if (prevEl) {
      prevEl.classList.remove('active');
      prevEl.classList.add(direction === 'next' ? 'exit-left' : 'exit-right');
      setTimeout(() => {
        prevEl.classList.remove('exit-left', 'exit-right');
      }, 500);
    }

    currentFrame = index;
    const el = document.getElementById(`frame-${index}`);
    if (el) {
      // Small delay so exit animation starts first
      setTimeout(() => {
        el.classList.add('active');
      }, direction ? 80 : 0);
    }

    updateControls();
  }

  function updateControls() {
    const prevBtn = document.getElementById('anim-prev');
    const nextBtn = document.getElementById('anim-next');
    const playBtn = document.getElementById('anim-play');
    const fill = document.getElementById('anim-progress-fill');
    const stepText = document.getElementById('anim-step-text');
    const stepCount = document.getElementById('anim-step-count');

    if (!prevBtn) return;

    prevBtn.disabled = currentFrame === 0;
    nextBtn.disabled = currentFrame === animFrames.length - 1;
    playBtn.innerHTML = isPlaying ? '⏸' : '▶';

    const pct = animFrames.length > 1 ? (currentFrame / (animFrames.length - 1)) * 100 : 100;
    fill.style.width = pct + '%';

    stepText.textContent = animFrames[currentFrame]?.title || '';
    stepCount.textContent = `${currentFrame + 1} / ${animFrames.length}`;
  }

  function goNext() {
    if (currentFrame < animFrames.length - 1) showFrame(currentFrame + 1, 'next');
    else stopPlaying();
  }

  function goPrev() {
    if (currentFrame > 0) showFrame(currentFrame - 1, 'prev');
  }

  function startPlaying() {
    isPlaying = true;
    updateControls();
    scheduleNext();
  }

  function stopPlaying() {
    isPlaying = false;
    if (playTimer) { clearTimeout(playTimer); playTimer = null; }
    updateControls();
  }

  function scheduleNext() {
    if (!isPlaying) return;
    if (currentFrame >= animFrames.length - 1) { stopPlaying(); return; }
    playTimer = setTimeout(() => {
      goNext();
      scheduleNext();
    }, playDelay * 1000);
  }

  function togglePlay() {
    if (isPlaying) stopPlaying();
    else {
      if (currentFrame >= animFrames.length - 1) showFrame(0, null); // restart from beginning
      startPlaying();
    }
  }

  function initController() {
    // Play/pause
    document.getElementById('anim-play').addEventListener('click', togglePlay);
    document.getElementById('anim-prev').addEventListener('click', goPrev);
    document.getElementById('anim-next').addEventListener('click', goNext);

    // Progress bar click
    document.getElementById('anim-progress-bar').addEventListener('click', (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const targetFrame = Math.round(ratio * (animFrames.length - 1));
      const dir = targetFrame > currentFrame ? 'next' : 'prev';
      showFrame(targetFrame, dir);
    });

    // Speed slider
    const slider = document.getElementById('speed-slider');
    const speedLabel = document.getElementById('speed-label');
    slider.addEventListener('input', () => {
      playDelay = parseFloat(slider.value);
      speedLabel.textContent = playDelay % 1 === 0 ? playDelay + 's' : playDelay.toFixed(1) + 's';
    });

    // Keyboard nav
    document.addEventListener('keydown', (e) => {
      if (animFrames.length === 0) return;
      if (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); goNext(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
      else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); togglePlay(); }
    });
  }

  // ===================== MAIN SIMPLIFY =====================

  function simplify(text) {
    let grammar;
    try { grammar = parseGrammar(text); }
    catch (err) { renderError(err.message); return; }

    clearViz();

    // Build all frames
    const allFrames = [];

    // Frame 0: Original grammar
    allFrames.push({
      phase: 0,
      title: 'Original Grammar',
      subtitle: 'This is the grammar you entered. We will simplify it through <strong>three phases</strong>: removing null productions, unit productions, and useless symbols.',
      grammar: grammar
    });

    // Phase 1
    const p1 = removeNullProductions(grammar);
    allFrames.push(...p1.frames);

    // Phase 2
    const p2 = removeUnitProductions(p1.grammar);
    allFrames.push(...p2.frames);

    // Phase 3
    const p3 = removeUselessSymbols(p2.grammar);
    allFrames.push(...p3.frames);

    // Final frame
    allFrames.push({
      phase: 'final',
      title: 'Simplified Grammar',
      subtitle: 'The fully simplified grammar after all three phases. It has no null productions, no unit productions, and no useless symbols.',
      grammar: p3.grammar
    });

    animFrames = allFrames;

    // Render
    let html = buildControllerHTML();
    html += '<div class="anim-stage">';
    allFrames.forEach((frame, i) => { html += buildFrameHTML(frame, i); });
    html += '</div>';

    vizPanel.innerHTML = html;
    initController();
    showFrame(0, null);
  }

  function renderError(msg) {
    clearViz();
    vizPanel.innerHTML = `<div class="error-display"><span class="error-icon">⚠️</span><div>${esc(msg)}</div></div>`;
  }

  // ===================== EVENT HANDLERS =====================

  const inputEl = document.getElementById('grammar-input');
  const presetEl = document.getElementById('preset-select');
  const btnSimplify = document.getElementById('btn-simplify');
  const btnReset = document.getElementById('btn-reset');

  presetEl.addEventListener('change', () => {
    const key = presetEl.value;
    if (key && PRESETS[key]) inputEl.value = PRESETS[key].text;
  });

  btnSimplify.addEventListener('click', () => {
    const text = inputEl.value.trim();
    if (!text) { renderError('Please enter at least one production rule.'); return; }
    simplify(text);
  });

  btnReset.addEventListener('click', () => {
    inputEl.value = '';
    presetEl.value = '';
    clearViz();
    vizPanel.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔧</div>
        <div class="empty-title">Enter a Grammar to Begin</div>
        <div class="empty-desc">
          Type your context-free grammar in the input panel or load a preset example. 
          Then click <strong>Simplify</strong> to see the step-by-step animation.
        </div>
      </div>`;
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); btnSimplify.click(); }
  });

})();
