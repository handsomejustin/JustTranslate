const GOOGLE_API = 'https://translate.googleapis.com/translate_a/single';
const BING_PAGE = 'https://www.bing.com/translator';
const BING_API = 'https://www.bing.com/ttranslatev3';

let bingTokens = { ig: '', iid: '', ts: 0 };

async function refreshBingTokens() {
  if (bingTokens.ig && Date.now() - bingTokens.ts < 300000) return;
  const res = await fetch(BING_PAGE);
  const html = await res.text();
  bingTokens = {
    ig: html.match(/IG:"([^"]+)"/)?.[1] || '',
    iid: html.match(/data-iid="([^"]+)"/)?.[1] || '',
    ts: Date.now()
  };
}

async function parallelLimit(tasks, limit) {
  const results = new Array(tasks.length);
  const executing = new Set();
  for (let i = 0; i < tasks.length; i++) {
    const p = tasks[i]().then(r => { executing.delete(p); results[i] = r; });
    executing.add(p);
    if (executing.size >= limit) await Promise.race(executing);
  }
  await Promise.all(executing);
  return results;
}

const ZH_LANGS = new Set(['zh', 'zh-CN', 'zh-TW', 'zh-Hans', 'zh-Hant', 'zh-CHS', 'zh-CHT']);

async function googleTranslate(texts, to) {
  return parallelLimit(texts.map(text => async () => {
    const url = `${GOOGLE_API}?client=gtx&sl=auto&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Google ${res.status}`);
    const data = await res.json();
    if (ZH_LANGS.has(data[2])) return null;
    return data[0].map(item => item[0]).filter(Boolean).join('');
  }), 5);
}

async function bingTranslate(texts, to) {
  await refreshBingTokens();
  const bingTo = to === 'zh-CN' ? 'zh-Hans' : to;
  return parallelLimit(texts.map(text => async () => {
    const url = `${BING_API}?isVertical=1&IG=${bingTokens.ig}&IID=${bingTokens.iid}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `fromLang=auto-detect&to=${bingTo}&text=${encodeURIComponent(text)}`
    });
    if (!res.ok) throw new Error(`Bing ${res.status}`);
    const data = await res.json();
    const detected = data[0]?.detectedLanguage?.language;
    if (ZH_LANGS.has(detected)) return null;
    return data[0]?.translations?.[0]?.text || null;
  }), 3);
}

async function translate(texts, to = 'zh-CN') {
  try {
    const results = await googleTranslate(texts, to);
    if (results.some(r => r !== null)) return results;
    throw new Error('all null');
  } catch (err) {
    console.warn('Google failed, trying Bing:', err.message);
    return bingTranslate(texts, to);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'translate') {
    translate(msg.texts, msg.to)
      .then(results => sendResponse({ results }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ enabled: false });
});
