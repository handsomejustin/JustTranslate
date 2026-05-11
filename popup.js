const toggle = document.getElementById('toggle');
const status = document.getElementById('status');
const bilingualToggle = document.getElementById('bilingual');
const modeStatus = document.getElementById('mode-status');

function sendToActiveTab(msg) {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, msg).catch(() => {});
    }
  });
}

chrome.storage.local.get(['enabled', 'bilingual'], ({ enabled, bilingual }) => {
  toggle.checked = !!enabled;
  updateStatus(!!enabled);
  bilingualToggle.checked = !!bilingual;
  updateModeStatus(!!bilingual);
});

toggle.addEventListener('change', () => {
  const enabled = toggle.checked;
  chrome.storage.local.set({ enabled });
  updateStatus(enabled);
  sendToActiveTab({ type: 'toggle', enabled });
});

bilingualToggle.addEventListener('change', () => {
  const bilingual = bilingualToggle.checked;
  chrome.storage.local.set({ bilingual });
  updateModeStatus(bilingual);
  sendToActiveTab({ type: 'setBilingual', bilingual });
});

function updateStatus(on) {
  status.textContent = on ? '翻译已开启' : '已关闭';
  status.style.color = on ? '#3b82f6' : '#6b7280';
}

function updateModeStatus(bilingual) {
  modeStatus.textContent = bilingual ? '原文 + 译文' : '纯中文模式';
  modeStatus.style.color = bilingual ? '#3b82f6' : '#6b7280';
}
