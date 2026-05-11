const BLOCK_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'LI', 'TD', 'TH', 'DD', 'DT', 'BLOCKQUOTE', 'FIGCAPTION', 'DIV'
]);
const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'TEXTAREA',
  'SVG', 'MATH', 'SELECT', 'TEMPLATE', 'SLOT', 'IFRAME', 'OBJECT'
]);

let translating = false;
let viewObserver = null;
let currentBilingual = false;

function looksLikeCode(text) {
  let hits = 0;
  if (/\bfunction\s*\w*\s*\(/.test(text)) hits++;
  if (/\b(const|let|var)\s+\w+\s*[=;]/.test(text)) hits++;
  if (/\b(document|window|console)\.\w+/.test(text)) hits++;
  if (/=>\s*[{(]/.test(text)) hits++;
  if (/\breturn\s+/.test(text)) hits++;
  if (/\b(if|for|while|switch|try|catch)\s*\(/.test(text)) hits++;
  if (/\b(removeAttribute|setAttribute|querySelector|getElementById|addEventListener)\b/.test(text)) hits++;
  if (/\b\w+\s*=\s*\w+\.\w+/.test(text)) hits++;
  return hits >= 2;
}

function isInSkipTag(el) {
  let node = el;
  while (node && node !== document.body) {
    if (SKIP_TAGS.has(node.tagName)) return true;
    node = node.parentElement;
  }
  return false;
}

function hasForeignText(text) {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length < 5) return false;
  if (looksLikeCode(trimmed)) return false;
  const letters = trimmed.replace(/[\s\d\p{P}\p{S}\p{M}\p{N}]/gu, '');
  if (letters.length < 4) return false;
  if (/[぀-ゟ゠-ヿ]/.test(letters)) return true;
  if (/[가-힯]/.test(letters)) return true;
  const cjk = letters.match(/[一-鿿㐀-䶿]/g) || [];
  if (cjk.length / letters.length > 0.3) return false;
  return letters.length >= 4;
}

function findBlockParent(el) {
  while (el && el !== document.body) {
    if (BLOCK_TAGS.has(el.tagName)) return el;
    el = el.parentElement;
  }
  return null;
}

function findTranslatable() {
  const results = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (isInSkipTag(parent)) return NodeFilter.FILTER_REJECT;
      if (parent.classList.contains('fanyi-trans')) return NodeFilter.FILTER_REJECT;
      if (parent.dataset.fanyi) return NodeFilter.FILTER_REJECT;
      const text = node.textContent;
      if (!text || text.trim().length < 5) return NodeFilter.FILTER_SKIP;
      return hasForeignText(text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    }
  });
  while (walker.nextNode()) {
    const block = findBlockParent(walker.currentNode.parentElement);
    if (block && !seen.has(block) && !block.dataset.fanyi) {
      // Check code at BLOCK element level, not text node level
      if (looksLikeCode(block.textContent)) {
        block.dataset.fanyi = 'skip';
        continue;
      }
      seen.add(block);
      block.dataset.fanyi = 'pending'; // Mark immediately to prevent rediscovery
      results.push(block);
    }
  }
  return results;
}

function insertTranslation(element, text, bilingual) {
  if (!bilingual) {
    // Pure Chinese: replace element's content in-place, keep tag/classes/CSS intact
    element.dataset.fanyiOriginal = element.innerHTML;
    element.textContent = text;
  } else {
    // Bilingual: keep original untouched, insert matching sibling below
    const useSameTag = element.tagName === 'LI';
    const tag = useSameTag ? 'li' : 'div';
    const trans = document.createElement(tag);
    trans.className = 'fanyi-trans';
    trans.textContent = text;
    if (element.tagName === 'TD' || element.tagName === 'TH') {
      element.appendChild(trans);
    } else {
      element.parentNode.insertBefore(trans, element.nextSibling);
    }
  }
  element.dataset.fanyi = 'done';
}

async function translateBatch(elements, bilingual) {
  const texts = elements.map(el => el.textContent.trim());
  const response = await chrome.runtime.sendMessage({ type: 'translate', texts, to: 'zh-CN' });
  if (response.error) {
    console.error('Translation error:', response.error);
    elements.forEach(el => delete el.dataset.fanyi);
    return;
  }
  elements.forEach((el, i) => {
    const translated = response.results[i];
    if (translated) {
      insertTranslation(el, translated, bilingual);
    } else {
      delete el.dataset.fanyi;
    }
  });
}

async function translatePage(bilingual) {
  if (translating) return;
  translating = true;
  currentBilingual = bilingual;

  const elements = findTranslatable();
  if (elements.length === 0) { translating = false; return; }

  // Reuse observer across calls — lazy-loaded elements get added to the same one
  if (!viewObserver) {
    viewObserver = new IntersectionObserver((entries) => {
      const visible = entries.filter(e => e.isIntersecting).map(e => e.target);
      if (!visible.length) return;
      visible.forEach(el => viewObserver.unobserve(el));
      for (let i = 0; i < visible.length; i += 10) {
        translateBatch(visible.slice(i, i + 10), currentBilingual);
      }
    }, { rootMargin: '300px' });
  }

  elements.forEach(el => viewObserver.observe(el));
  translating = false;
}

function removeTranslations() {
  document.querySelectorAll('[data-fanyi-original]').forEach(el => {
    el.innerHTML = el.dataset.fanyiOriginal;
    delete el.dataset.fanyiOriginal;
  });
  document.querySelectorAll('.fanyi-trans').forEach(el => el.remove());
  document.querySelectorAll('[data-fanyi]').forEach(el => delete el.dataset.fanyi);
  // Only destroy observer on full clear, not on incremental updates
  if (viewObserver) { viewObserver.disconnect(); viewObserver = null; }
}

// Watch for dynamic content (SPA / lazy load)
let mutationObserver = null;
function startWatching() {
  if (mutationObserver) return;
  let debounce = null;
  mutationObserver = new MutationObserver(mutations => {
    const hasNew = mutations.some(m =>
      Array.from(m.addedNodes).some(n =>
        n.nodeType === Node.ELEMENT_NODE && !n.classList?.contains('fanyi-trans')
      )
    );
    if (!hasNew) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      chrome.storage.local.get('bilingual', ({ bilingual }) => translatePage(!!bilingual));
    }, 1000);
  });
  mutationObserver.observe(document.body, { childList: true, subtree: true });
}

function stopWatching() {
  if (mutationObserver) { mutationObserver.disconnect(); mutationObserver = null; }
  if (viewObserver) { viewObserver.disconnect(); viewObserver = null; }
}

// Init
chrome.storage.local.get(['enabled', 'bilingual'], ({ enabled, bilingual }) => {
  if (enabled) { translatePage(!!bilingual); startWatching(); }
});

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'toggle') {
    if (msg.enabled) {
      removeTranslations();
      chrome.storage.local.get('bilingual', ({ bilingual }) => {
        translatePage(!!bilingual);
        startWatching();
      });
    } else {
      removeTranslations();
      stopWatching();
    }
  }
  if (msg.type === 'setBilingual') {
    removeTranslations();
    chrome.storage.local.get('enabled', ({ enabled }) => {
      if (enabled) { translatePage(msg.bilingual); startWatching(); }
    });
  }
});
