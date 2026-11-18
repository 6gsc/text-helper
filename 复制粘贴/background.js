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
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getStatus') {
        chrome.storage.local.get(['enabled'], (result) => {
            sendResponse({ enabled: result.enabled !== false });
        });
        return true;
    }
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
             if (data?.type === 'answer') {
                 forwardToTabs({ action: 'autoAnswer', payload: data });
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
