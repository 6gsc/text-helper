// AI 自动答题 - 进阶层 Content Script（显示版）
// 职责：Alt+E 截屏触发 / Alt+A/X 面板 / Alt+Z AI 答案独立粘贴 / 指示灯 / 清洗 / 缓存
// 原则：任何失败静默降级，不影响兜底层（content.js 的预设与隐蔽复制粘贴）
// 依赖：ai-config.js（AI_CONFIG）、question-bank.js（QUESTION_BANK）在本文件之前注入

(function () {
    'use strict';

    if (window.__aiPanelV1) return;
    window.__aiPanelV1 = true;

    var CFG = (typeof AI_CONFIG !== 'undefined') ? AI_CONFIG : {};
    var KEYS = CFG.keys || { capture: 'e', show: 'a', hide: 'x', paste: 'z' };

    var isTopFrame = window === window.top;

    // ========== 状态 ==========
    var answerCache = {};        // 指纹 -> {type, answer, confidence, source, low}
    var latestBatch = [];        // 最新一批识别结果
    var latestBatchText = '';    // Alt+Z 粘贴用的整批文本
    var recognizing = false;     // 进行中标志位，防并发
    var lastErrorToastAt = 0;    // ✗ 接口异常 节流

    // ========== MD5（纯 JS，无外部依赖） ==========
    function md5(str) {
        function add(x, y) {
            return (((x >> 16) + (y >> 16) + (((x & 0xffff) + (y & 0xffff)) >> 16)) << 16) | (((x & 0xffff) + (y & 0xffff)) & 0xffff);
        }
        function rol(n, c) { return (n << c) | (n >>> (32 - c)); }
        function cmn(q, a, b, x, s, t) { return add(rol(add(add(a, q), add(x, t)), s), b); }
        function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
        function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
        function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
        function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }

        function toUtf8(s) {
            var out = [], i;
            for (i = 0; i < s.length; i++) {
                var c = s.charCodeAt(i);
                if (c < 128) out.push(c);
                else if (c < 2048) {
                    out.push((c >> 6) | 192, (c & 63) | 128);
                } else if (((c & 0xFC00) === 0xD800) && (i + 1) < s.length &&
                           ((s.charCodeAt(i + 1) & 0xFC00) === 0xDC00)) {
                    c = 0x10000 + (((c & 0x03FF) << 10) | (s.charCodeAt(++i) & 0x03FF));
                    out.push((c >> 18) | 240, ((c >> 12) & 63) | 128, ((c >> 6) & 63) | 128, (c & 63) | 128);
                } else {
                    out.push((c >> 12) | 224, ((c >> 6) & 63) | 128, (c & 63) | 128);
                }
            }
            return out;
        }

        var bytes = toUtf8(String(str));
        var len = bytes.length;
        var total = ((len + 8) >> 6) + 1;
        var X = new Array(total * 16);
        for (var q = 0; q < X.length; q++) X[q] = 0;
        for (var n = 0; n < len; n++) X[n >> 2] |= bytes[n] << ((n % 4) * 8);
        X[len >> 2] |= 0x80 << ((len % 4) * 8);
        X[total * 16 - 2] = len << 3;

        var a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
        for (var i = 0; i < X.length; i += 16) {
            var oa = a, ob = b, oc = c, od = d;
            for (var r = 0; r < 64; r++) {
                var kk = r < 16 ? r
                       : r < 32 ? (5 * (r - 16) + 1) % 16
                       : r < 48 ? (3 * (r - 32) + 5) % 16
                       : (7 * (r - 48)) % 16;
                var s = r < 16 ? [7, 12, 17, 22][r % 4]
                      : r < 32 ? [5, 9, 14, 20][r % 4]
                      : r < 48 ? [4, 11, 16, 23][r % 4]
                      : [6, 10, 15, 21][r % 4];
                var t = (Math.floor(Math.abs(Math.sin(r + 1)) * 4294967296)) | 0;
                var m = X[i + kk];
                if (r < 16)      a = ff(a, b, c, d, m, s, t);
                else if (r < 32) a = gg(a, b, c, d, m, s, t);
                else if (r < 48) a = hh(a, b, c, d, m, s, t);
                else             a = ii(a, b, c, d, m, s, t);
                var T = [a, b, c, d];
                a = T[3]; b = T[0]; c = T[1]; d = T[2];
            }
            a = add(a, oa); b = add(b, ob); c = add(c, oc); d = add(d, od);
        }

        function hex(n) {
            var s = '', j;
            for (j = 0; j < 4; j++) s += ((n >>> (j * 8 + 4)) & 15).toString(16) + ((n >>> (j * 8)) & 15).toString(16);
            return s;
        }
        return hex(a) + hex(b) + hex(c) + hex(d);
    }

    // ========== 归一化与指纹 ==========
    function toHalfWidth(s) {
        return String(s).replace(/[\uFF01-\uFF5E]/g, function (ch) {
            return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
        }).replace(/\u3000/g, ' ');
    }

    function normalizeQuestion(q) {
        var s = toHalfWidth(String(q || '')).toLowerCase();
        s = s.replace(/^\s*(第?\s*\d+\s*[.、)．]\s*)+/, ''); // 去题号前缀
        s = s.replace(/[\s\p{P}\p{S}]/gu, '');               // 去空白与标点
        return s;
    }

    function fingerprint(q) { return md5(normalizeQuestion(q)); }

    // ========== 题库索引（题库优先于 AI，永远不被 AI 覆盖） ==========
    var bankIndex = {};
    (function buildBank() {
        var bank = (typeof QUESTION_BANK !== 'undefined' && QUESTION_BANK) ? QUESTION_BANK : [];
        for (var i = 0; i < bank.length; i++) {
            bankIndex[fingerprint(bank[i].question)] = {
                type: bank[i].type || 'fill',
                answer: String(bank[i].answer || ''),
                confidence: 1.0,
                source: '题库'
            };
        }
    })();

    // ========== 清洗（FR-3，纯字符串处理） ==========
    var EXPL_MARKS = ['解析', '因为', '所以', '因此', '由于', '理由'];

    function extractAfterAnswerMark(s) {
        var m = s.match(/(?:答案|参考答案)\s*[:：为是]\s*([\s\S]+)/) || s.match(/(?:答案|参考答案)[:：]\s*([\s\S]+)/);
        return m ? m[1].trim() : null;
    }

    function cutExplanation(s) {
        var best = s.length;
        for (var i = 0; i < EXPL_MARKS.length; i++) {
            var idx = s.indexOf(EXPL_MARKS[i]);
            if (idx > 0 && idx < best) best = idx;
        }
        return s.slice(0, best).trim();
    }

    function cleanSingleChoice(ans) {
        var m = toHalfWidth(ans).match(/[ABCD]/i);
        return m ? m[0].toUpperCase() : '';
    }

    function cleanMultiChoice(ans) {
        var letters = toHalfWidth(String(ans)).toUpperCase().match(/[A-Z]/g) || [];
        var uniq = [];
        for (var i = 0; i < letters.length; i++) {
            if ('ABCDEF'.indexOf(letters[i]) >= 0 && uniq.indexOf(letters[i]) < 0) uniq.push(letters[i]);
        }
        uniq.sort();
        return uniq.join('');
    }

    function cleanJudge(ans) {
        var s = toHalfWidth(String(ans)).toLowerCase();
        var word = CFG.judge_word || '对';
        var wrong = (word === '对') ? '错' : (word === '正确' ? '错误' : '×');
        if (/(正确|对|√|true|是|yes|right)/i.test(s)) return word;
        if (/(错误|错|×|✗|false|否|no|wrong)/i.test(s)) return wrong;
        return '';
    }

    function cleanFill(ans) {
        var s = toHalfWidth(String(ans)).trim();
        s = cutExplanation(s);
        return s.replace(/\s*\|\s*/g, '|');
    }

    // 主清洗入口：返回 {answer, lowConfidence}
    function cleanAnswer(type, rawAnswer, confidence) {
        var raw = String(rawAnswer || '').trim();
        var low = false;

        // 1) 有「答案：/答案为」标志 → 提取
        var extracted = extractAfterAnswerMark(raw);
        if (extracted) raw = extracted;

        var out;
        switch (type) {
            case 'choice': out = cleanSingleChoice(raw); break;
            case 'multi':  out = cleanMultiChoice(raw); break;
            case 'judge':  out = cleanJudge(raw); break;
            case 'fill':   out = cleanFill(raw); break;
            default:       out = cutExplanation(raw); break; // essay / calc
        }

        if (!out) { out = cutExplanation(raw); low = true; }
        if (type === 'calc' || type === 'essay') low = low || (confidence == null ? 0.75 : confidence) < 0.85;
        else if (confidence != null && confidence < 0.8) low = true;

        return { answer: out, lowConfidence: low };
    }

    // ========== 入库（FR-4，题库优先，命中不重复调 AI） ==========
    function storeBatch(items) {
        // items: [{type, question, answer, confidence}]
        latestBatch = [];
        var lines = [];
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var fp = fingerprint(it.question);
            var entry = bankIndex[fp] || answerCache[fp];
            if (!entry) {
                var cleaned = cleanAnswer(it.type, it.answer, it.confidence);
                entry = {
                    type: it.type,
                    answer: cleaned.answer || '—',
                    confidence: it.confidence,
                    source: 'AI 置信度 ' + (it.confidence != null ? it.confidence : '?'),
                    low: cleaned.lowConfidence || !cleaned.answer
                };
                answerCache[fp] = entry;
            }
            latestBatch.push({
                index: i + 1,
                type: it.type,
                question: it.question,
                answer: entry.answer,
                confidence: entry.confidence,
                source: entry.source,
                low: !!entry.low
            });
            if (entry.answer && entry.answer !== '—') lines.push(entry.answer);
        }
        latestBatchText = lines.join('\n');
        renderPanelIfShown();
    }

    // ========== 指示灯（FR-9） ==========
    var dot = null, dotBreathTimer = null, dotFadeTimer = null;

    function ensureDot() {
        if (dot && dot.parentNode) return dot;
        dot = document.createElement('div');
        dot.id = '__ai_status_dot__';
        dot.style.cssText =
            'position:fixed!important;bottom:8px!important;right:8px!important;' +
            'width:10px!important;height:10px!important;border-radius:50%!important;' +
            'background:rgba(128,128,128,.4)!important;z-index:2147483646!important;' +
            'pointer-events:none!important;transition:background .4s,opacity .8s!important;';
        (document.body || document.documentElement).appendChild(dot);
        return dot;
    }

    function dotIdle() {
        stopBreath();
        ensureDot().style.background = 'rgba(128,128,128,.4)';
        dot.style.opacity = '1';
    }

    function dotWorking() {
        stopBreath();
        var d = ensureDot();
        d.style.opacity = '1';
        d.style.background = '#e6b800';
        var on = false;
        dotBreathTimer = setInterval(function () {
            on = !on;
            d.style.background = on ? '#e6b800' : 'rgba(230,184,0,.35)';
        }, 700);
    }

    function dotFlash(color) {
        stopBreath();
        var d = ensureDot();
        d.style.opacity = '1';
        d.style.background = color;
        dotFadeTimer = setTimeout(dotIdle, 2000);
    }

    function stopBreath() {
        clearInterval(dotBreathTimer); dotBreathTimer = null;
        clearTimeout(dotFadeTimer); dotFadeTimer = null;
    }

    // ========== 答案面板（FR-5） ==========
    var panel = null;

    function buildPanel() {
        panel = document.createElement('div');
        panel.id = '__ai_answer_panel__';
        panel.style.cssText =
            'position:fixed!important;bottom:24px!important;right:16px!important;' +
            'width:360px!important;max-height:45vh!important;overflow-y:auto!important;' +
            'background:rgba(0,0,0,.72)!important;color:#eee!important;' +
            'font:12px/1.6 system-ui,sans-serif!important;padding:10px 12px!important;' +
            'border-radius:6px!important;z-index:2147483647!important;' +
            'box-shadow:0 2px 10px rgba(0,0,0,.35)!important;';
        (document.body || document.documentElement).appendChild(panel);
        renderPanelBody();
    }

    function showPanel() {
        if (!isTopFrame) return;
        if (!panel || !panel.parentNode) buildPanel();
        else { panel.style.display = ''; renderPanelBody(); }
    }

    function hidePanel() {
        // 从 DOM 移除，不留痕迹
        if (panel && panel.parentNode) { panel.parentNode.removeChild(panel); panel = null; }
    }

    function renderPanelIfShown() { if (panel && panel.parentNode) renderPanelBody(); }

    function renderPanelBody() {
        if (!panel) return;
        var bankCount = 0, aiCount = 0, i;
        for (i = 0; i < latestBatch.length; i++) {
            if (latestBatch[i].source === '题库') bankCount++; else aiCount++;
        }
        var html = '<div style="text-align:right;color:#bbb;margin-bottom:6px!important;">' +
            latestBatch.length + ' 题 | ' + bankCount + ' 题库 ' + aiCount + ' AI</div>';
        if (!latestBatch.length) {
            html += '<div style="color:#999;">暂无识别结果，按 Alt+E 截屏识别</div>';
        }
        for (i = 0; i < latestBatch.length; i++) {
            var it = latestBatch[i];
            var prefix = it.low ? '⚠ ' : '';
            var ans = (it.answer && it.answer !== '—') ? it.answer : '—';
            var long = String(ans).length > 24 || /\n/.test(ans);
            html += '<div style="margin:4px 0!important;' + (long ? 'word-break:break-all!important;white-space:pre-wrap!important;' : '') + '">' +
                prefix + '<b>' + it.index + '.</b> ' + escapeHtml(ans) +
                ' <span style="color:#888;font-size:11px;">(' + escapeHtml(it.source) + ')</span></div>';
        }
        panel.innerHTML = html;
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // ========== toast（FR-6，样式与 content.js showStatus 一致，独立实现避免耦合） ==========
    var toastEl = null, toastTimer = null;

    function toast(text, isError) {
        if (!isTopFrame) return;
        if (!toastEl || !toastEl.parentNode) {
            toastEl = document.createElement('div');
            toastEl.style.cssText =
                'position:fixed!important;bottom:44px!important;right:20px!important;' +
                'padding:6px 12px!important;color:#fff!important;font-size:13px!important;' +
                'font-family:system-ui,sans-serif!important;z-index:2147483647!important;' +
                'opacity:0!important;transition:opacity .15s!important;pointer-events:none!important;' +
                'border-radius:4px!important;';
            (document.body || document.documentElement).appendChild(toastEl);
        }
        toastEl.textContent = text;
        toastEl.style.background = isError ? 'rgba(180,50,50,.85)' : 'rgba(0,0,0,.75)';
        toastEl.style.opacity = '1';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { if (toastEl) toastEl.style.opacity = '0'; }, 1500);
    }

    function errorToastThrottled() {
        var now = Date.now();
        if (now - lastErrorToastAt > 8000) {
            lastErrorToastAt = now;
            toast('✗ 接口异常', true);
        }
    }

    // ========== Alt+Z AI 答案独立粘贴（FR-8，不触碰系统剪贴板） ==========
    function pasteAiAnswer() {
        if (!latestBatchText) {
            toast('⚠ 暂无 AI 答案', true);
            return;
        }
        var el = document.activeElement;
        if (!el || (!el.isContentEditable && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) {
            toast('请先点击输入框', true);
            return;
        }
        var ok = false;
        try { ok = document.execCommand('insertText', false, latestBatchText); } catch (e) {}
        if (!ok && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
            var s = el.selectionStart || 0, e2 = el.selectionEnd || 0;
            el.value = el.value.slice(0, s) + latestBatchText + el.value.slice(e2);
            el.selectionStart = el.selectionEnd = s + latestBatchText.length;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            ok = true;
        }
        toast(ok ? '已粘贴 AI 答案' : '粘贴失败', !ok);
    }

    // ========== Alt+E 截屏触发（FR-1） ==========
    function triggerCapture() {
        if (recognizing) return; // 进行中忽略，不并发
        recognizing = true;
        dotWorking();
        chrome.runtime.sendMessage({ action: 'aiCapture' }, function (res) {
            recognizing = false;
            if (chrome.runtime.lastError || !res) {
                dotFlash('#ea4335');
                errorToastThrottled();
                return;
            }
            if (res.error) {
                if (res.error === 'site' || res.error === 'disabled') { dotIdle(); return; } // 静默降级
                dotFlash('#ea4335');
                errorToastThrottled();
                return;
            }
            // res.ok —— 答案由 background 推送的 autoAnswer 消息入库
        });
    }

    // ========== 接收 background 推送的识别结果 ==========
    chrome.runtime.onMessage.addListener(function (msg) {
        if (!msg || msg.action !== 'autoAnswer') return;
        if (msg.payload && msg.payload.error) {
            dotFlash('#ea4335');
            toast('⚠ 本轮识别失败（按 Alt+E 可重试）', true);
            return;
        }
        var items = Array.isArray(msg.payload) ? msg.payload : [];
        if (!items.length) { dotFlash('#ea4335'); toast('⚠ 未识别到题目', true); return; }
        storeBatch(items);
        dotFlash('#34a853');
        toast('✓ 已识别 ' + items.length + ' 题，Alt+Z 粘贴');
        // 识别成功自动弹出面板（ai-config.js auto_show_panel 可关）
        if (CFG.auto_show_panel !== false) showPanel();
    });

    // ========== 键盘监听（捕获阶段，与 Alt+C/V 同通道，零焦点变化） ==========
    document.addEventListener('keydown', function (e) {
        if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (!isTopFrame) return;
        var k = (e.key || '').toLowerCase();
        if (k === KEYS.capture) {
            e.preventDefault(); e.stopPropagation();
            // 插件开关（Alt+Q）关闭时进阶层同时停用
            chrome.runtime.sendMessage({ action: 'getStatus' }, function (st) {
                if (chrome.runtime.lastError) return;
                if (st && st.enabled === false) return;
                triggerCapture();
            });
        } else if (k === KEYS.show) {
            e.preventDefault(); e.stopPropagation();
            showPanel();
        } else if (k === KEYS.hide) {
            e.preventDefault(); e.stopPropagation();
            hidePanel();
        } else if (k === KEYS.paste) {
            e.preventDefault(); e.stopPropagation();
            pasteAiAnswer();
        }
    }, true);

    // ========== 初始化 ==========
    if (isTopFrame) {
        var init = function () { ensureDot(); };
        document.body ? init() : document.addEventListener('DOMContentLoaded', init);
    }
})();
