// 隐蔽复制粘贴助手 - Service Worker
// 处理快捷键命令和状态管理
// 预设内容由content.js通过presets-data.js处理

// 插件状态
let pluginEnabled = true;

// 初始化
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({ enabled: true });
    console.log('隐蔽复制粘贴助手已安装');
});

// 监听快捷键命令
chrome.commands.onCommand.addListener(async (command) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    switch (command) {
        case 'toggle-plugin':
            pluginEnabled = !pluginEnabled;
            chrome.storage.local.set({ enabled: pluginEnabled });
            chrome.tabs.sendMessage(tab.id, { 
                action: 'toggle', 
                enabled: pluginEnabled 
            });
            break;
        case 'stealth-copy':
            chrome.tabs.sendMessage(tab.id, { action: 'copy' });
            break;
        case 'stealth-paste':
            chrome.tabs.sendMessage(tab.id, { action: 'paste' });
            break;
        case 'toggle-select':
            chrome.tabs.sendMessage(tab.id, { action: 'enableSelect' });
            break;
        case 'deep-unlock':
            chrome.tabs.sendMessage(tab.id, { action: 'deepUnlock' });
            break;
        case 'preset-1':
        case 'preset-2':
        case 'preset-3':
        case 'preset-4':
        case 'preset-5':
        case 'preset-6':
        case 'preset-7':
        case 'preset-8':
        case 'preset-9':
            const presetNum = command.split('-')[1];
            chrome.tabs.sendMessage(tab.id, { 
                action: 'copyPreset', 
                preset: parseInt(presetNum)
            });
            break;
    }
});

// 监听来自content script的消息
// ========== 自动答题显示版：截屏识别（Alt+E，进阶层） ==========
 // aiCapture 流程：白名单校验 -> captureVisibleTab -> AI 视觉接口 -> autoAnswer 推送回 content
 importScripts('ai-config.js');

 function siteWhitelisted(url) {
     const list = (AI_CONFIG.site_whitelist || []).filter(Boolean);
     if (!list.length) return true; // 空数组不限站点
     try { const host = new URL(url).hostname; return list.some(w => host === w || host.endsWith('.' + w) || url.includes(w)); }
     catch (e) { return false; }
 }

 const AI_PROMPT =
     '你是答题助手。识别截图中所有题目并作答。' +
     '只返回一个 JSON 数组，不要任何其他文字，格式严格为：' +
     '[{"type":"choice|multi|fill|judge|calc|essay","question":"题干原文","answer":"答案本身",' +
     '"explanation":"解析","confidence":0.0到1.0}]。' +
     '单选 answer 为单字母；多选为有序字母串；判断为 对/错；填空多空用 | 分隔；计算给结果+关键结论。';

 function parseAiItems(text) {
     let t = String(text || '').trim();
     const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
     if (fence) t = fence[1].trim();
     const s = t.indexOf('['), e = t.lastIndexOf(']');
     if (s >= 0 && e > s) t = t.slice(s, e + 1);
     const arr = JSON.parse(t);
     if (!Array.isArray(arr)) throw new Error('not array');
     return arr.filter(it => it && it.question).map(it => ({
         type: it.type || 'fill',
         question: String(it.question || ''),
         answer: String(it.answer || ''),
         confidence: (typeof it.confidence === 'number') ? it.confidence : null
     }));
 }

 chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
     if (request.action === 'getStatus') {
         chrome.storage.local.get(['enabled'], (result) => {
             sendResponse({ enabled: result.enabled !== false });
         });
         return true;
     }
     if (request.action !== 'aiCapture') return;

     const tab = sender.tab;
     chrome.storage.local.get(['enabled'], (result) => {
         if (result.enabled === false) { sendResponse({ error: 'disabled' }); return; }
         if (!tab || !tab.url || !siteWhitelisted(tab.url)) { sendResponse({ error: 'site' }); return; }
         // jpeg+quality 代替 png：全屏 PNG 经 base64 后常超 5MB，超出视觉模型图片上限导致接口报错、答案无法返回
        chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 }, (dataUrl) => {
             if (chrome.runtime.lastError || !dataUrl) { sendResponse({ error: 'capture' }); return; }
             sendResponse({ ok: true }); // 截屏成功，AI 结果稍后通过 autoAnswer 推送

             const controller = new AbortController();
             const timer = setTimeout(() => controller.abort(), AI_CONFIG.timeout_ms || 300000);
             fetch(String(AI_CONFIG.base_url).replace(/\/+$/, '').replace(/\/$/, '') + '/chat/completions', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + AI_CONFIG.api_key },
                 body: JSON.stringify({
                     model: AI_CONFIG.model,
                     messages: [{
                         role: 'user',
                         content: [
                             { type: 'text', text: AI_PROMPT },
                             { type: 'image_url', image_url: { url: dataUrl } }
                         ]
                     }],
                     temperature: 0.1
                 }),
                 signal: controller.signal
            }).then(r => {
                clearTimeout(timer);
                if (!r.ok) return r.text().then(t => { throw new Error('http ' + r.status + ' ' + t.slice(0, 300)); });
                return r.json();
            }).then(j => {
                const items = parseAiItems(j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content);
                console.log('[AI] 识别成功，题数:', items.length);
                chrome.tabs.sendMessage(tab.id, { action: 'autoAnswer', payload: items }, () => void chrome.runtime.lastError);
            }).catch((err) => {
                clearTimeout(timer);
                console.error('[AI] 识别失败:', err); // 状态码/接口返回体在此输出，SW 控制台可查
                chrome.tabs.sendMessage(tab.id, { action: 'autoAnswer', payload: { error: 'ai' } }, () => void chrome.runtime.lastError);
            });
         });
     });
     return true; // 异步 sendResponse
 });
 
 // ========== 自动答题：本地 helper WebSocket 客户端 ==========
 // 仅连接 127.0.0.1 回环，断线自动重连；helper 离线时插件原有功能完全不受影响
 (function () {
     const WS_URL = 'ws://127.0.0.1:8765';
     let ws = null;
     let retryDelay = 2000;
     let forwardingTabId = null;
 
     function forwardToTabs(message) {
         chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
             (tabs.length ? tabs : [{ id: forwardingTabId }]).forEach(tab => {
                 if (!tab?.id) return;
                 forwardingTabId = tab.id;
                 chrome.tabs.sendMessage(tab.id, message, () => void chrome.runtime.lastError);
             });
         });
     }
 
     function connect() {
         try { ws = new WebSocket(WS_URL); } catch (e) { scheduleReconnect(); return; }
         ws.onopen = () => {
             retryDelay = 2000;
             console.log('[助手] 已连接本地答题助手');
         };
        ws.onmessage = (event) => {
            let data;
            try { data = JSON.parse(event.data); } catch (e) { return; }
            if (data?.type === 'answer' && data.answer) {
                // helper 推送的是单题对象，规范为 ai-panel 期望的数组结构
                const items = [{
                    type: data.question_type || 'fill',
                    question: String(data.question || ''),
                    answer: String(data.answer || ''),
                    confidence: (typeof data.confidence === 'number') ? data.confidence : null
                }];
                forwardToTabs({ action: 'autoAnswer', payload: items });
            }
        };
         ws.onclose = () => { ws = null; scheduleReconnect(); };
         ws.onerror = () => { try { ws && ws.close(); } catch (e) {} };
     }
 
     function scheduleReconnect() {
         setTimeout(connect, retryDelay);
         retryDelay = Math.min(retryDelay * 2, 30000);
     }
 
     connect();
 })();
