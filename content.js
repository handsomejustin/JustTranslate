const INLINE_TAGS = new Set([
  'SPAN', 'A', 'STRONG', 'B', 'EM', 'I', 'SMALL', 'SUB', 'SUP',
  'MARK', 'U', 'DEL', 'INS', 'S', 'ABBR', 'TIME',
  'WBR', 'BR', 'IMG', 'BDI', 'BDO', 'DATA', 'DFN', 'KBD',
  'SAMP', 'VAR', 'CITE', 'Q'
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

function isLeafBlock(el) {
  for (const child of el.children) {
    if (SKIP_TAGS.has(child.tagName)) continue;
    if (INLINE_TAGS.has(child.tagName)) {
      if (!isLeafBlock(child)) return false;
      continue;
    }
    return false;
  }
  return true;
}

function getTranslatableText(el) {
  let text = '';
  function walk(node) {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (SKIP_TAGS.has(child.tagName)) {
          text += ' ';
        } else {
          walk(child);
        }
      }
    }
  }
  walk(el);
  return text.replace(/\s+/g, ' ').trim();
}

function collectTranslatableBlocks(root) {
  const results = [];

  (function walk(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
    if (SKIP_TAGS.has(el.tagName)) return;
    if (el.classList?.contains('fanyi-trans')) return;
    if (el.dataset.fanyi) return;

    if (isLeafBlock(el)) {
      const text = getTranslatableText(el);
      if (text.length >= 5 && hasForeignText(text) && !looksLikeCode(text)) {
        el.dataset.fanyi = 'pending';
        results.push(el);
        return;
      }
    }

    for (const child of el.children) walk(child);
  })(root);
  return results;
}

function insertTranslation(element, text, bilingual) {
  if (!element.parentNode) { element.dataset.fanyi = 'done'; return; }
  element.dataset.fanyiOriginal = element.innerHTML;
  if (!bilingual) {
    element.textContent = text;
  } else {
    const isInline = INLINE_TAGS.has(element.tagName);
    const trans = document.createElement(isInline ? 'span' : 'div');
    trans.className = 'fanyi-trans';
    trans.textContent = text;
    element.parentNode.insertBefore(trans, element.nextSibling);
  }
  element.dataset.fanyi = 'done';
}

async function translateBatch(elements, bilingual) {
  if (!chrome.runtime?.id) { stopWatching(); return; }
  const texts = elements.map(el => el.textContent.trim());
  let response;
  try {
    response = await chrome.runtime.sendMessage({ type: 'translate', texts, to: 'zh-CN' });
  } catch { stopWatching(); return; }
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

  const elements = collectTranslatableBlocks(document.body);
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
