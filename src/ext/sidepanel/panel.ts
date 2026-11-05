/**
 * RTTS Extension Sidepanel Controller — TypeScript
 * Compliant with Chrome MV3 CSP, zero dependencies, pure vanilla JS.
 *
 * Imports shared types from src/lib/providers.ts for config schema consistency.
 */

import type { AppConfig, ProviderProfile } from '../../lib/providers'
import { uid } from '../../lib/utils'

(() => {
  let currentConfig: AppConfig = {
    providers: [
      {
        id: 'moss-official',
        name: 'MOSS 官方',
        baseUrl: 'https://api.mosi.cn/v1',
        apiKey: '',
        protocol: 'moss',
        note: '官方 MOSS 网关',
        models: [],
        lastSyncedAt: null,
        status: 'unknown',
        lastError: ''
      }
    ],
    routes: {
      llm: { providerId: 'moss-official', model: 'moss-vl-1.0' },
      audio: { providerId: 'moss-official', model: 'moss-transcribe-1.0' },
      video: { providerId: 'moss-official', model: 'moss-vl-realtime-1.0' }
    }
  };

  const noticeBanner = document.getElementById('noticeBanner')!;
  const providersList = document.getElementById('providersList')!;
  const addProviderBtn = document.getElementById('addProviderBtn')!;
  const saveConfigBtn = document.getElementById('saveConfigBtn')!;

  const routeLlmProvider = document.getElementById('route-llm-provider') as HTMLSelectElement;
  const routeLlmModel = document.getElementById('route-llm-model') as HTMLInputElement;
  const routeAudioProvider = document.getElementById('route-audio-provider') as HTMLSelectElement;
  const routeAudioModel = document.getElementById('route-audio-model') as HTMLInputElement;
  const routeVideoProvider = document.getElementById('route-video-provider') as HTMLSelectElement;
  const routeVideoModel = document.getElementById('route-video-model') as HTMLInputElement;

  function showNotice(text: string, isError = false) {
    if (!noticeBanner) return;
    noticeBanner.textContent = text;
    noticeBanner.className = `notice-banner ${isError ? 'error' : 'success'}`;
    noticeBanner.hidden = false;
    setTimeout(() => {
      noticeBanner.hidden = true;
    }, 5000);
  }

  async function loadConfig() {
    try {
      const res = await chrome.runtime.sendMessage({ target: 'background', type: 'GET_CONFIG' });
      if (res && res.ok && res.config) {
        currentConfig = res.config;
      }
    } catch (err) {
      // Background might be waking up or fallback to default
    }
    renderAll();
  }

  function syncFormToConfig() {
    // Read route selections
    currentConfig.routes.llm.providerId = routeLlmProvider.value;
    currentConfig.routes.llm.model = routeLlmModel.value.trim();

    currentConfig.routes.audio.providerId = routeAudioProvider.value;
    currentConfig.routes.audio.model = routeAudioModel.value.trim();

    currentConfig.routes.video.providerId = routeVideoProvider.value;
    currentConfig.routes.video.model = routeVideoModel.value.trim();

    // Read provider cards DOM
    const cards = providersList.querySelectorAll('.provider-card');
    cards.forEach((card, idx) => {
      const id = card.getAttribute('data-id');
      const provider = currentConfig.providers.find(p => p.id === id);
      if (!provider) return;

      const nameInput = card.querySelector('.provider-name') as HTMLInputElement;
      const urlInput = card.querySelector('.provider-url') as HTMLInputElement;
      const keyInput = card.querySelector('.provider-key') as HTMLInputElement;
      const protocolSelect = card.querySelector('.provider-protocol') as HTMLSelectElement;
      const noteInput = card.querySelector('.provider-note') as HTMLInputElement;

      if (nameInput) provider.name = nameInput.value.trim();
      if (urlInput) provider.baseUrl = urlInput.value.trim();
      if (keyInput) provider.apiKey = keyInput.value.trim();
      if (protocolSelect) provider.protocol = protocolSelect.value as 'moss' | 'openai';
      if (noteInput) provider.note = noteInput.value.trim();
    });
  }

  function renderRoutes() {
    const providers = currentConfig.providers || [];
    const populateSelect = (selectEl: HTMLSelectElement, selectedId: string) => {
      selectEl.textContent = '';
      if (providers.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '暂无可用服务商';
        selectEl.appendChild(opt);
        return;
      }
      providers.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name || '未命名服务商';
        if (p.id === selectedId) opt.selected = true;
        selectEl.appendChild(opt);
      });
    };

    populateSelect(routeLlmProvider, currentConfig.routes.llm.providerId);
    routeLlmModel.value = currentConfig.routes.llm.model || '';

    populateSelect(routeAudioProvider, currentConfig.routes.audio.providerId);
    routeAudioModel.value = currentConfig.routes.audio.model || '';

    populateSelect(routeVideoProvider, currentConfig.routes.video.providerId);
    routeVideoModel.value = currentConfig.routes.video.model || '';
  }

  function renderProviders() {
    providersList.textContent = '';
    const providers = currentConfig.providers || [];

    providers.forEach((p, index) => {
      const card = document.createElement('div');
      card.className = 'provider-card';
      card.setAttribute('data-id', p.id);

      const header = document.createElement('div');
      header.className = 'provider-card-header';

      const titleWrap = document.createElement('div');
      titleWrap.className = 'provider-title-wrap';

      const idxSpan = document.createElement('span');
      idxSpan.className = 'provider-index';
      idxSpan.textContent = `#${index + 1}`;

      const nameDisplay = document.createElement('strong');
      nameDisplay.style.fontSize = '13px';
      nameDisplay.textContent = p.name || '新服务商';

      titleWrap.appendChild(idxSpan);
      titleWrap.appendChild(nameDisplay);
      header.appendChild(titleWrap);

      if (providers.length > 1) {
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'btn-danger-ghost';
        deleteBtn.title = '删除此服务商';
        deleteBtn.setAttribute('aria-label', `删除服务商 ${p.name}`);
        deleteBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        `;
        deleteBtn.addEventListener('click', () => {
          syncFormToConfig();
          currentConfig.providers = currentConfig.providers.filter(item => item.id !== p.id);
          // Ensure routes still point to a valid provider
          (['llm', 'audio', 'video'] as const).forEach(k => {
            if (!currentConfig.providers.some(item => item.id === currentConfig.routes[k].providerId)) {
              currentConfig.routes[k].providerId = currentConfig.providers[0].id;
            }
          });
          renderAll();
        });
        header.appendChild(deleteBtn);
      }

      card.appendChild(header);

      const grid = document.createElement('div');
      grid.className = 'form-grid';

      // Name field
      const fgName = document.createElement('div');
      fgName.className = 'field-group';
      fgName.innerHTML = `
        <label class="field-label">服务商名称</label>
        <input type="text" class="field-input provider-name" value="${escapeHtml(p.name)}" placeholder="例如 MOSS 官方" spellcheck="false" autocomplete="off">
      `;
      grid.appendChild(fgName);

      // Protocol select
      const fgProto = document.createElement('div');
      fgProto.className = 'field-group';
      fgProto.innerHTML = `
        <label class="field-label">协议类型</label>
        <select class="field-select provider-protocol">
          <option value="moss" ${p.protocol === 'moss' ? 'selected' : ''}>MOSS 原生</option>
          <option value="openai" ${p.protocol === 'openai' ? 'selected' : ''}>OpenAI 兼容中转</option>
        </select>
      `;
      grid.appendChild(fgProto);

      // Base URL
      const fgUrl = document.createElement('div');
      fgUrl.className = 'field-group full';
      fgUrl.innerHTML = `
        <label class="field-label">Base URL</label>
        <input type="text" class="field-input provider-url" value="${escapeHtml(p.baseUrl)}" placeholder="https://api.mosi.cn/v1" spellcheck="false" autocomplete="off">
      `;
      grid.appendChild(fgUrl);

      // API Key with password visibility toggle
      const fgKey = document.createElement('div');
      fgKey.className = 'field-group full';
      const keyWrapId = `pw_${p.id}`;
      fgKey.innerHTML = `
        <label class="field-label">API Key (密钥)</label>
        <div class="password-wrap">
          <input id="${keyWrapId}" type="password" class="field-input provider-key" value="${escapeHtml(p.apiKey)}" placeholder="sk-..." spellcheck="false" autocomplete="off">
          <button type="button" class="toggle-pw-btn" title="显示/隐藏密钥" aria-label="显示或隐藏API Key">
            <svg class="eye-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </button>
        </div>
      `;
      grid.appendChild(fgKey);

      // Bind show/hide password toggle
      const toggleBtn = fgKey.querySelector('.toggle-pw-btn') as HTMLButtonElement;
      const keyInput = fgKey.querySelector('.provider-key') as HTMLInputElement;
      toggleBtn.addEventListener('click', () => {
        if (keyInput.type === 'password') {
          keyInput.type = 'text';
          toggleBtn.title = '隐藏密钥';
        } else {
          keyInput.type = 'password';
          toggleBtn.title = '显示密钥';
        }
      });

      // Note
      const fgNote = document.createElement('div');
      fgNote.className = 'field-group full';
      fgNote.innerHTML = `
        <label class="field-label">备注说明 (可选)</label>
        <input type="text" class="field-input provider-note" value="${escapeHtml(p.note || '')}" placeholder="例如 备用中转账号" spellcheck="false" autocomplete="off">
      `;
      grid.appendChild(fgNote);

      card.appendChild(grid);
      providersList.appendChild(card);
    });
  }

  function escapeHtml(str: string): string {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderAll() {
    renderProviders();
    renderRoutes();
  }

  // Add provider
  addProviderBtn.addEventListener('click', () => {
    syncFormToConfig();
    const newP: ProviderProfile = {
      id: uid('prov'),
      name: `服务商 ${currentConfig.providers.length + 1}`,
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      protocol: 'openai',
      note: '',
      models: [],
      lastSyncedAt: null,
      status: 'unknown',
      lastError: ''
    };
    currentConfig.providers.push(newP);
    renderAll();
  });

  // Save config with explicit permissions request
  saveConfigBtn.addEventListener('click', async () => {
    syncFormToConfig();

    // Collect unique HTTPS origins from all provider Base URLs
    const originsMap = new Set<string>();
    for (const p of currentConfig.providers) {
      const urlStr = p.baseUrl.trim();
      if (!urlStr) continue;
      try {
        const parsed = new URL(urlStr);
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
          originsMap.add(`${parsed.origin}/*`);
        }
      } catch (e) {
        // ignore invalid url during origin extraction, handled by backend or validation
      }
    }

    const origins = Array.from(originsMap);
    if (origins.length === 0) {
      showNotice('请至少配置一个有效的服务商 Base URL (http/https)', true);
      return;
    }

    try {
      // Direct permission request from user click
      const granted = await chrome.permissions.request({ origins });
      if (!granted) {
        showNotice(`已取消或拒绝授权网络访问权限 (${origins.join(', ')})。配置未保存。`, true);
        return;
      }
    } catch (permErr) {
      // If permissions API is not available (e.g. non-extension preview or standalone mode), proceed or show notice
      console.warn('chrome.permissions.request warning:', permErr);
    }

    // Send SAVE_CONFIG to background
    try {
      const res = await chrome.runtime.sendMessage({
        target: 'background',
        type: 'SAVE_CONFIG',
        config: currentConfig
      });
      if (res && res.ok) {
        showNotice('配置已成功保存并同步至扩展后台。');
      } else {
        showNotice('保存失败: ' + (res?.error || '未知错误'), true);
      }
    } catch (err: any) {
      showNotice('通信错误: ' + err.message, true);
    }
  });

  // Initial load
  loadConfig();
})();
