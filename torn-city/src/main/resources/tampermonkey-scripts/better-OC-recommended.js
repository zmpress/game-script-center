// ==UserScript==
// @name         OC优化和推荐
// @version      1.0
// @description  优化 Torn 派系犯罪卡片的显示效果，并增加多级排序、筛选和简化开关，增加大锅饭总工分显示，增加
// @author       zmpress [3633431]
// @match        https://www.torn.com/factions.php?step=your*
// @grant        GM_xmlhttpRequest
// @updateURL    https://raw.githubusercontent.com/zmpress/game_script/refs/heads/main/porn_city/userscript/OCSortAndDisplay.js
// @downloadURL    https://raw.githubusercontent.com/zmpress/game_script/refs/heads/main/porn_city/userscript/OCSortAndDisplay.js
// ==/UserScript==

(function () {
    'use strict';

    // --- 新增：本地存储和开关状态 ---
    const LS_KEY_SIMPLIFY = 'oc_simplify_display';
    const LS_KEY_SCORE_TYPE = 'oc_score_type'; // 工分类型开关 ('total' 或 'daily')
    const LS_KEY_API_KEY = 'z_tornMinimalKey'; // Torn API Key
    const LS_KEY_USER_FACTION = 'z_api2_userFaction'; // 用户帮派信息缓存
    const LS_KEY_FACTION_ID = 'oc_faction_id'; // 帮派ID（手动设置，备用）
    
    // 默认值为 'true'。只有当 localStorage 明确存为 'false' 时才为 false。
    const simplifyEnabled = localStorage.getItem(LS_KEY_SIMPLIFY) !== 'false';
    
    // 获取当前工分类型，默认为总工分
    let scoreType = localStorage.getItem(LS_KEY_SCORE_TYPE) || 'total';
    
    // 获取 API Key
    const apiKey = localStorage.getItem(LS_KEY_API_KEY);
    
    // 获取当前用户的帮派ID，优先从 API 缓存获取，其次从手动设置获取
    let currentFactionId = '20465'; // 默认值

    // 原有的功能开关（保留，以防你需要手动关闭）
    const isShowInfluence = true;
    const isShowOverlay = true;
    // --- 结束 ---

    // === daguofan 系数表集成 ===
    // 缓存配置（z_daguofan_weight），10分钟过期
    const CACHE_KEY = 'z_daguofan_weight';
    const CACHE_EXPIRATION = 10 * 60 * 1000; // 10分钟
    
    // CDN基础URL模板
    const CDN_BASE_URL = 'https://cdn.jsdelivr.net/gh/zmpress/game-script-center@main/torn-city/src/main/resources/config/dahuofan-weight/';

    let XISHU_TABLE = {};
    
    /**
     * 从缓存获取数据
     */
    function getCachedData(key) {
        try {
            const cached = localStorage.getItem(key);
            if (!cached) {
                console.log('[OCSort] 缓存不存在:', key);
                return null;
            }
            
            const data = JSON.parse(cached);
            const now = Date.now();
            const age = now - data.timestamp;
            const ageMinutes = Math.floor(age / 60000);
            
            if (age < CACHE_EXPIRATION) {
                console.log(`[OCSort] 缓存命中: ${key} (已缓存 ${ageMinutes} 分钟)`);
                return data.content;
            } else {
                console.log(`[OCSort] 缓存已过期: ${key} (已缓存 ${ageMinutes} 分钟，超过10分钟限制)`);
                localStorage.removeItem(key);
                return null;
            }
        } catch (e) {
            console.error('[OCSort] 读取缓存失败:', e);
            return null;
        }
    }
    
    /**
     * 保存数据到缓存
     */
    function setCachedData(key, content, expiration = CACHE_EXPIRATION) {
        try {
            const data = {
                timestamp: Date.now(),
                content: content,
                expiration: expiration
            };
            localStorage.setItem(key, JSON.stringify(data));
            console.log(`[OCSort] 缓存已保存: ${key} (有效期${expiration / 60000}分钟)`);
        } catch (e) {
            console.error('[OCSort] 保存缓存失败:', e);
        }
    }
    
    /**
     * 从网络获取帮派系数配置（使用 GM_xmlhttpRequest 绕过 CSP）
     */
    async function fetchFactionCoefficient(factionId) {
        const url = CDN_BASE_URL + factionId + '.json';
        
        return new Promise((resolve) => {
            try {
                console.log('[OCSort] 正在从网络获取配置:', url);
                
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    timeout: 5000,
                    onload: function(response) {
                        try {
                            if (response.status === 200) {
                                const data = JSON.parse(response.responseText);
                                console.log('[OCSort] 成功获取帮派', factionId, '的系数配置');
                                resolve(data);
                            } else {
                                throw new Error('HTTP ' + response.status);
                            }
                        } catch (e) {
                            console.error('[OCSort] 解析响应失败:', e);
                            resolve(null);
                        }
                    },
                    onerror: function(error) {
                        console.error('[OCSort] 从网络获取配置失败:', factionId, error);
                        resolve(null);
                    },
                    ontimeout: function() {
                        console.error('[OCSort] 请求超时:', factionId);
                        resolve(null);
                    }
                });
            } catch (e) {
                console.error('[OCSort] 发起请求失败:', factionId, e);
                resolve(null);
            }
        });
    }
    
    /**
     * 从 Torn API 获取用户帮派信息
     */
    async function fetchUserFactionFromAPI() {
        if (!apiKey) {
            console.log('[OCSort] 未设置 API Key，跳过 API 调用');
            return null;
        }
        
        const url = `https://api.torn.com/v2/user/faction?key=${apiKey}`;
        
        return new Promise((resolve) => {
            try {
                console.log('[OCSort] 正在从 Torn API 获取帮派信息...');
                
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    timeout: 5000,
                    onload: function(response) {
                        try {
                            if (response.status === 200) {
                                const data = JSON.parse(response.responseText);
                                if (data.faction && data.faction.id) {
                                    console.log('[OCSort] 成功获取帮派信息:', data.faction.name, '(ID:', data.faction.id + ')');
                                    resolve(data.faction);
                                } else {
                                    console.error('[OCSort] API 响应格式错误:', data);
                                    resolve(null);
                                }
                            } else {
                                throw new Error('HTTP ' + response.status);
                            }
                        } catch (e) {
                            console.error('[OCSort] 解析 API 响应失败:', e);
                            resolve(null);
                        }
                    },
                    onerror: function(error) {
                        console.error('[OCSort] 调用 Torn API 失败:', error);
                        resolve(null);
                    },
                    ontimeout: function() {
                        console.error('[OCSort] API 请求超时');
                        resolve(null);
                    }
                });
            } catch (e) {
                console.error('[OCSort] 发起 API 请求失败:', e);
                resolve(null);
            }
        });
    }
    
    /**
     * 初始化帮派 ID（优先从 API 获取，其次从缓存获取）
     */
    async function initFactionId() {
        // 先尝试从缓存获取帮派信息
        const cachedFaction = getCachedData(LS_KEY_USER_FACTION);
        if (cachedFaction && cachedFaction.id) {
            currentFactionId = String(cachedFaction.id);
            console.log('[OCSort] 使用缓存的帮派 ID:', currentFactionId);
            return;
        }
        
        // 如果缓存没有，尝试从 API 获取
        if (apiKey) {
            const factionInfo = await fetchUserFactionFromAPI();
            if (factionInfo && factionInfo.id) {
                currentFactionId = String(factionInfo.id);
                // 缓存帮派信息，有效期 10 分钟
                setCachedData(LS_KEY_USER_FACTION, factionInfo, CACHE_EXPIRATION);
                console.log('[OCSort] 从 API 获取并缓存帮派 ID:', currentFactionId);
                return;
            }
        }
        
        // 如果都没有，尝试使用手动设置的帮派 ID
        const manualFactionId = localStorage.getItem(LS_KEY_FACTION_ID);
        if (manualFactionId) {
            currentFactionId = manualFactionId;
            console.log('[OCSort] 使用手动设置的帮派 ID:', currentFactionId);
        } else {
            console.log('[OCSort] 使用默认帮派 ID:', currentFactionId);
        }
    }
    
    /**
     * 加载系数表（优先从网络获取，失败则刷新缓存时间）
     */
    async function loadXishuTable() {
        // 先初始化帮派 ID
        await initFactionId();
        
        try {
            // 先从缓存获取
            const cached = getCachedData(CACHE_KEY + '_' + currentFactionId);
            
            // 尝试从网络获取当前帮派的配置
            let coefficientData = await fetchFactionCoefficient(currentFactionId);
            
            // 如果获取失败且不是默认帮派，则尝试获取默认配置
            if (!coefficientData && currentFactionId !== '20465') {
                console.log('[OCSort] 当前帮派配置获取失败，尝试使用默认配置(20465)');
                coefficientData = await fetchFactionCoefficient('20465');
            }
            
            // 如果网络获取成功，保存到缓存并使用
            if (coefficientData && isValidXishuTable(coefficientData)) {
                XISHU_TABLE = coefficientData;
                setCachedData(CACHE_KEY + '_' + currentFactionId, coefficientData);
                console.log('[OCSort] 从网络获取配置成功，已更新缓存');
                return;
            }
            
            // 如果网络获取失败，但有缓存，刷新缓存时间并继续使用
            if (cached && isValidXishuTable(cached)) {
                XISHU_TABLE = cached;
                // 刷新缓存时间戳，延长有效期
                setCachedData(CACHE_KEY + '_' + currentFactionId, cached);
                console.log('[OCSort] 网络获取失败，已刷新缓存时间，继续使用缓存的系数表');
                return;
            }
            
            // 如果都没有，初始化为空对象
            console.warn('[OCSort] 无法获取系数表，请检查网络连接或帮派ID');
            XISHU_TABLE = {};
        } catch (e) {
            console.error('[OCSort] 加载系数表失败:', e);
            // 尝试使用缓存作为兜底
            const cached = getCachedData(CACHE_KEY + '_' + currentFactionId);
            if (cached && isValidXishuTable(cached)) {
                XISHU_TABLE = cached;
                // 刷新缓存时间戳
                setCachedData(CACHE_KEY + '_' + currentFactionId, cached);
                console.log('[OCSort] 异常情况下已刷新缓存时间，使用缓存');
            } else {
                XISHU_TABLE = {};
            }
        }
    }

    function isValidXishuTable(obj) {
        return obj && typeof obj === "object" && !Array.isArray(obj);
    }

    function normalizeOcName(name) {
        return String(name ?? "")
            .replace(/\u00A0/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function normalizeRole(role) {
        return String(role ?? "").replace(/\s+/g, "").trim();
    }

    function parseIntSafe(v) {
        const m = String(v ?? "").match(/-?\d+/);
        return m ? Number.parseInt(m[0], 10) : NaN;
    }

    function parseFloatSafe(v) {
        const m = String(v ?? "").match(/-?\d+(?:\.\d+)?/);
        return m ? Number.parseFloat(m[0]) : NaN;
    }

    function getXishuCoeff(ocName, level, role, chance) {
        const nameKey = normalizeOcName(ocName);
        const roleKey = normalizeRole(role);
        const levelKey = String(level);

        const byOc = XISHU_TABLE[nameKey];
        if (!byOc) return null;
        const byLevel = byOc[levelKey];
        if (!byLevel) return null;
        const ranges = byLevel[roleKey];
        if (!Array.isArray(ranges) || ranges.length === 0) return null;

        for (const r of ranges) {
            if (!Array.isArray(r) || r.length < 3) continue;
            const min = parseFloatSafe(r[0]);
            const max = parseFloatSafe(r[1]);
            const a = parseFloatSafe(r[2]);
            if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(a)) continue;
            // 左开右闭区间 (min, max]: chance > min && chance <= max
            if (chance > min && chance <= max) return a;
        }
        return null;
    }

    function hasClassPrefix(el, prefix) {
        if (!el || !el.classList) return false;
        const p = `${prefix}___`;
        for (const c of el.classList) {
            if (c.startsWith(p)) return true;
        }
        return false;
    }

    function getXishuMatchResult(ocName, level, role, chance) {
        const nameKey = normalizeOcName(ocName);
        const roleKey = normalizeRole(role);
        const levelKey = String(level);

        const byOc = XISHU_TABLE[nameKey];
        if (!byOc) return { a: null, reason: "missing_oc" };
        const byLevel = byOc[levelKey];
        if (!byLevel) return { a: null, reason: "missing_level" };
        const ranges = byLevel[roleKey];
        if (!Array.isArray(ranges) || ranges.length === 0) return { a: null, reason: "missing_role" };

        let minAll = Infinity;
        let maxAll = -Infinity;
        for (const r of ranges) {
            if (!Array.isArray(r) || r.length < 3) continue;
            const min = parseFloatSafe(r[0]);
            const max = parseFloatSafe(r[1]);
            if (Number.isFinite(min)) minAll = Math.min(minAll, min);
            if (Number.isFinite(max)) maxAll = Math.max(maxAll, max);
        }

        const a = getXishuCoeff(nameKey, levelKey, roleKey, chance);
        if (Number.isFinite(a)) return { a, reason: "ok" };

        // 如果成功率小于等于最小值，视为成功率太低
        if (Number.isFinite(minAll) && chance <= minAll) return { a: null, reason: "chance_too_low", minAll, maxAll };
        if (Number.isFinite(maxAll) && chance > maxAll) return { a: null, reason: "chance_too_high", minAll, maxAll };
        return { a: null, reason: "no_match", minAll, maxAll };
    }

    function formatProfitValue(value) {
        const s = Number(value).toFixed(3);
        return s.replace(/\.?0+$/, "");
    }
    
    /**
     * 获取用户在当前卡片中已占的岗位信息
     */
    function getUserOccupiedSlots(card) {
        const occupiedSlots = [];
        const notOpening = card.querySelector('[class*="notOpening___"]');
        
        if (!notOpening) return occupiedSlots;
        
        // 遍历所有岗位，找到用户已占的（非空缺）岗位
        Array.from(notOpening.children).forEach((child, index) => {
            const isVacant = child.querySelector('[class*="joinButton___"]') ||
                child.querySelector('[class*="joinContainer___"]') ||
                hasClassPrefix(child, "waitingJoin");
            
            // 如果不是空缺，说明已被占用
            if (!isVacant) {
                const jobNameEl = child.querySelector('[class*="title___"]');
                const jobName = jobNameEl ? jobNameEl.textContent.trim() : 'Unknown';
                const chanceEl = child.querySelector('[class*="successChance___"]');
                const chance = chanceEl ? parseIntSafe(chanceEl.textContent) : NaN;
                
                occupiedSlots.push({
                    index: index,
                    jobName: jobName,
                    chance: chance,
                    element: child
                });
            }
        });
        
        return occupiedSlots;
    }
    
    /**
     * 计算工分时考虑用户已占岗位（支持总工分和每日工分）
     */
    function calculateScoreWithUserSlot(matchResult, vacantCount, userOccupiedSlots, currentJobName) {
        if (matchResult.reason !== "ok" || !Number.isFinite(matchResult.a)) {
            return { score: -1, displayValue: '', userCoefficient: null };
        }
            
        const coefficient = matchResult.a;
        let totalProfit;
            
        // 根据工分类型计算
        if (scoreType === 'daily') {
            // 每日工分：只计算单日收益，不乘以空缺天数
            totalProfit = coefficient;
        } else {
            // 总工分：系数 × 空缺岗位数
            if (userOccupiedSlots.length > 0 && vacantCount > 0) {
                // 检查是否有与当前岗位相同名称的已占岗位
                const hasSameJobOccupied = userOccupiedSlots.some(slot => slot.jobName === currentJobName);
                    
                if (hasSameJobOccupied) {
                    // 如果有相同的已占岗位，计算时需要考虑那一天
                    // 总工分 = 系数 × (空缺数 + 已占的同类型岗位数)
                    const sameJobCount = userOccupiedSlots.filter(slot => slot.jobName === currentJobName).length;
                    totalProfit = coefficient * (vacantCount + sameJobCount);
                } else {
                    // 没有相同类型的已占岗位，正常计算
                    totalProfit = coefficient * vacantCount;
                }
            } else {
                // 正常情况，显示总工分（系数 × 空缺岗位数）
                totalProfit = coefficient * vacantCount;
            }
        }
            
        return {
            score: totalProfit,
            displayValue: formatProfitValue(totalProfit),
            userCoefficient: coefficient
        };
    }

    // 初始化加载系数表（异步，优先从网络获取）
    loadXishuTable().then(() => {
        console.log('[OCSort] 系数表初始化完成');
    });

    // --- 注入CSS样式 ---
    function injectStyles() {
        const styleId = 'oc-filter-styles';
        if (document.getElementById(styleId)) return;

        const css = `
      #oc-filter-bar {
        padding: 10px;
        background: rgba(255, 255, 255, 0.15);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 6px;
        margin-bottom: 10px;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        color: #f0f0f0;
        font-size: 14px;
      }
      .oc-filter-group {
        display: flex;
        gap: 5px;
        align-items: center;
        padding-right: 10px;
        border-right: 1px solid #666;
      }
      .oc-filter-group span {
        font-weight: bold;
        font-size: 15px;
        color: #fff;
      }
      .oc-filter-group:last-of-type {
        border-right: none;
      }
      .oc-btn {
        padding: 5px 10px;
        border: 1px solid #999;
        background: #666;
        color: #fff;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        user-select: none;
        white-space: nowrap;
        transition: border-color 0.2s, box-shadow 0.2s;
      }
      .oc-btn:hover {
        background: #777;
        border-color: #bbb;
      }
      .oc-btn.active, .oc-btn[data-sort-state="asc"], .oc-btn[data-sort-state="desc"] {
        background: #57a5e8;
        border-color: #68b6ff;
        font-weight: bold;
      }
      .oc-btn[data-sort-state="active"] {
        background: #57a5e8;
        border-color: #68b6ff;
        font-weight: bold;
      }
      .oc-btn.primary-sort {
        border-color: #ffd700;
        box-shadow: 0 0 8px rgba(255, 215, 0, 0.7);
      }
      /* 新增：专门用来安全隐藏卡片的样式，不破坏 SVG */
      .oc-hidden-card {
        position: absolute !important;
        width: 0 !important;
        height: 0 !important;
        overflow: hidden !important;
        visibility: hidden !important;
        pointer-events: none !important;
        margin: 0 !important;
        padding: 0 !important;
        border: none !important;
      }
      #oc-filter-count {
        margin-left: auto;
        font-size: 15px;
        font-weight: bold;
        color: #fff;
        font-variant-numeric: tabular-nums;
      }
    `;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = css;
        document.head.appendChild(style);
    }

    // --- 创建排序和筛选栏 (已修改) ---
    function createFilterBar(listContainer) {
        if (document.getElementById('oc-filter-bar')) return;

        const filterBar = document.createElement('div');
        filterBar.id = 'oc-filter-bar';
        filterBar.innerHTML = `
      <div class="oc-filter-group">
        <span>排序:</span>
        <button id="oc-sort-default" class="oc-btn primary-sort" data-sort-state="active">默认</button>
        <button id="oc-sort-level" class="oc-btn" data-sort-state="none">等级</button>
        <button id="oc-sort-time" class="oc-btn" data-sort-state="none">完成时间</button>
        <button id="oc-sort-score" class="oc-btn" data-sort-state="none">工分</button>
      </div>
      <div class="oc-filter-group">
        <span>筛选:</span>
        <button class="oc-btn active" data-level-filter="all">全部</button>
        <button class="oc-btn" data-level-filter="<=6">&lt;=6</button>
        <button class="oc-btn" data-level-filter=">=7">&gt;=7</button>
        <button class="oc-btn" data-level-filter="7">7</button>
        <button class="oc-btn" data-level-filter="8">8</button>
        <button class="oc-btn" data-level-filter="9">9</button>
        <button class="oc-btn" data-level-filter="10">10</button>
      </div>
      <div class="oc-filter-group">
        <span>显示:</span>
        <button id="oc-toggle-simplify" class="oc-btn"></button>
      </div>${!apiKey ? `
      <div class="oc-filter-group">
        <span>API Key:</span>
        <input type="password" id="oc-api-key-input" placeholder="请输入 minimal API key" style="width: 120px; padding: 4px 8px; border: 1px solid #999; border-radius: 4px; background: #666; color: #fff; font-size: 12px;">
        <button id="oc-set-api-key-btn" class="oc-btn">设置</button>
      </div>` : ''}
      ${apiKey ? `<div class="oc-filter-group"><span>当前帮派: ${currentFactionId}</span></div>` : ''}
      <div id="oc-filter-count"></div>
    `;

        listContainer.parentNode.insertBefore(filterBar, listContainer);

        const sortDefaultBtn = filterBar.querySelector('#oc-sort-default');
        const sortLevelBtn = filterBar.querySelector('#oc-sort-level');
        const sortTimeBtn = filterBar.querySelector('#oc-sort-time');
        const sortScoreBtn = filterBar.querySelector('#oc-sort-score'); // 工分排序按钮
        const filterBtns = filterBar.querySelectorAll('[data-level-filter]');

        // --- 简化开关逻辑 (已修改) ---
        const simplifyBtn = filterBar.querySelector('#oc-toggle-simplify');
        if (simplifyEnabled) {
            simplifyBtn.textContent = '切换到原始显示';
            simplifyBtn.classList.add('active'); // 保持 "激活" 状态的蓝色
        } else {
            simplifyBtn.textContent = '切换到简化显示';
            // 默认没有 'active' 类，显示为灰色
        }
        simplifyBtn.addEventListener('click', () => {
            // 存储 *新* 的状态
            localStorage.setItem(LS_KEY_SIMPLIFY, !simplifyEnabled);
            // 清除浏览器历史记录并重新加载，避免表单提示
            window.location.assign(window.location.pathname + window.location.search);
        });

        // --- 工分类型切换逻辑 ---
        const scoreTypeToggleBtn = document.createElement('button');
        scoreTypeToggleBtn.id = 'oc-toggle-score-type';
        scoreTypeToggleBtn.className = 'oc-btn';
        if (scoreType === 'daily') {
            scoreTypeToggleBtn.textContent = '切换到总工分';
            scoreTypeToggleBtn.classList.add('active');
        } else {
            scoreTypeToggleBtn.textContent = '切换到每日工分';
        }
        scoreTypeToggleBtn.addEventListener('click', () => {
            const newScoreType = scoreType === 'total' ? 'daily' : 'total';
            localStorage.setItem(LS_KEY_SCORE_TYPE, newScoreType);
            // 清除浏览器历史记录并重新加载，避免表单提示
            window.location.assign(window.location.pathname + window.location.search);
        });

        // 将工分类型切换按钮插入到简化按钮之后
        simplifyBtn.parentNode.insertBefore(scoreTypeToggleBtn, simplifyBtn.nextSibling);

        // --- API Key 设置逻辑 ---
        const apiKeyInput = filterBar.querySelector('#oc-api-key-input');
        const setApiKeyBtn = filterBar.querySelector('#oc-set-api-key-btn');

        if (setApiKeyBtn) {
            setApiKeyBtn.addEventListener('click', async () => {
                const newApiKey = apiKeyInput.value.trim();
                if (!newApiKey) {
                    alert('请输入有效的 API Key');
                    return;
                }

                // 测试 API Key 是否有效
                alert('正在验证 API Key...');
                const tempApiKey = newApiKey;

                // 临时设置 API Key 进行测试
                const testUrl = `https://api.torn.com/v2/user/faction?key=${tempApiKey}`;

                GM_xmlhttpRequest({
                    method: 'GET',
                    url: testUrl,
                    timeout: 5000,
                    onload: function(response) {
                        try {
                            if (response.status === 200) {
                                const data = JSON.parse(response.responseText);
                                if (data.faction && data.faction.id) {
                                    // API Key 有效，保存
                                    localStorage.setItem(LS_KEY_API_KEY, tempApiKey);
                                    // 缓存帮派信息
                                    setCachedData(LS_KEY_USER_FACTION, data.faction, CACHE_EXPIRATION);
                                    alert(`API Key 设置成功！\n帮派: ${data.faction.name}\nID: ${data.faction.id}\n页面将刷新以应用新配置。`);
                                    // 清除浏览器历史记录并重新加载，避免表单提示
                                    window.location.assign(window.location.pathname + window.location.search);
                                } else {
                                    alert('API Key 无效或响应格式错误');
                                }
                            } else {
                                alert('API Key 无效，请检查后重试');
                            }
                        } catch (e) {
                            alert('验证失败: ' + e.message);
                        }
                    },
                    onerror: function() {
                        alert('网络连接失败，请检查后重试');
                    },
                    ontimeout: function() {
                        alert('请求超时，请检查后重试');
                    }
                });
            });
            
            // 回车键也可以提交
            apiKeyInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    setApiKeyBtn.click();
                }
            });
        }
        // --- 结束 ---


        // --- 排序逻辑 ---
        function updateSortStates() {
            const levelState = sortLevelBtn.dataset.sortState;
            const timeState = sortTimeBtn.dataset.sortState;
            const scoreState = sortScoreBtn.dataset.sortState; // 工分排序状态

            if (levelState === 'none' && timeState === 'none' && scoreState === 'none') {
                sortDefaultBtn.dataset.sortState = 'active';
                sortDefaultBtn.classList.add('primary-sort');
                sortLevelBtn.classList.remove('primary-sort');
                sortTimeBtn.classList.remove('primary-sort');
                sortScoreBtn.classList.remove('primary-sort');
            } else {
                sortDefaultBtn.dataset.sortState = 'none';
                sortDefaultBtn.classList.remove('primary-sort');

                const levelIsPrimary = sortLevelBtn.classList.contains('primary-sort');
                const timeIsPrimary = sortTimeBtn.classList.contains('primary-sort');
                const scoreIsPrimary = sortScoreBtn.classList.contains('primary-sort');

                if (!levelIsPrimary && !timeIsPrimary && !scoreIsPrimary) {
                    if (levelState !== 'none') {
                        sortLevelBtn.classList.add('primary-sort');
                    } else if (timeState !== 'none') {
                        sortTimeBtn.classList.add('primary-sort');
                    } else if (scoreState !== 'none') {
                        sortScoreBtn.classList.add('primary-sort');
                    }
                } else if (levelIsPrimary && levelState === 'none') {
                    sortLevelBtn.classList.remove('primary-sort');
                    if (timeState !== 'none') {
                        sortTimeBtn.classList.add('primary-sort');
                    } else if (scoreState !== 'none') {
                        sortScoreBtn.classList.add('primary-sort');
                    }
                } else if (timeIsPrimary && timeState === 'none') {
                    sortTimeBtn.classList.remove('primary-sort');
                    if (levelState !== 'none') {
                        sortLevelBtn.classList.add('primary-sort');
                    } else if (scoreState !== 'none') {
                        sortScoreBtn.classList.add('primary-sort');
                    }
                } else if (scoreIsPrimary && scoreState === 'none') {
                    sortScoreBtn.classList.remove('primary-sort');
                    if (levelState !== 'none') {
                        sortLevelBtn.classList.add('primary-sort');
                    } else if (timeState !== 'none') {
                        sortTimeBtn.classList.add('primary-sort');
                    }
                }
            }
        }

        function handleSortClick(btn) {
            let currentState = btn.dataset.sortState;
            let nextState;

            if (currentState === 'none') {
                nextState = 'desc';
            } else if (currentState === 'desc') {
                nextState = 'asc';
            } else {
                nextState = 'desc';
            }

            btn.dataset.sortState = nextState;
            const btnText = btn.id === 'oc-sort-level' ? '等级' :
                btn.id === 'oc-sort-time' ? '完成时间' : '工分';
            btn.textContent = `${btnText} ${nextState === 'asc' ? '⬆' : nextState === 'desc' ? '⬇' : ''}`.trim();

            updateSortStates();
            applyFiltersAndSorting();
        }

        sortLevelBtn.addEventListener('click', () => handleSortClick(sortLevelBtn));
        sortTimeBtn.addEventListener('click', () => handleSortClick(sortTimeBtn));
        sortScoreBtn.addEventListener('click', () => handleSortClick(sortScoreBtn)); // 工分排序

        sortDefaultBtn.addEventListener('click', () => {
            if (sortDefaultBtn.dataset.sortState === 'active') return;

            sortDefaultBtn.dataset.sortState = 'active';
            sortDefaultBtn.classList.add('primary-sort');

            sortLevelBtn.dataset.sortState = 'none';
            sortLevelBtn.classList.remove('primary-sort');
            sortLevelBtn.textContent = '等级';

            sortTimeBtn.dataset.sortState = 'none';
            sortTimeBtn.classList.remove('primary-sort');
            sortTimeBtn.textContent = '完成时间';

            sortScoreBtn.dataset.sortState = 'none'; // 重置工分排序
            sortScoreBtn.classList.remove('primary-sort');
            sortScoreBtn.textContent = '工分';

            applyFiltersAndSorting();
        });


        // --- 筛选按钮逻辑 ---
        filterBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const filter = btn.dataset.levelFilter;
                const wasActive = btn.classList.contains('active');
                const specificFilters = ['7', '8', '9', '10'];

                if (filter === 'all') {
                    if (wasActive) return;
                    filterBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                } else {
                    btn.classList.toggle('active');
                    filterBar.querySelector('[data-level-filter="all"]').classList.remove('active');

                    if (btn.classList.contains('active')) {
                        if (filter === '<=6') {
                            filterBar.querySelector('[data-level-filter=">=7"]').classList.remove('active');
                            specificFilters.forEach(f => filterBar.querySelector(`[data-level-filter="${f}"]`).classList.remove('active'));
                        } else if (filter === '>=7') {
                            filterBar.querySelector('[data-level-filter="<=6"]').classList.remove('active');
                            specificFilters.forEach(f => filterBar.querySelector(`[data-level-filter="${f}"]`).classList.remove('active'));
                        } else if (specificFilters.includes(filter)) {
                            filterBar.querySelector('[data-level-filter="<=6"]').classList.remove('active');
                            filterBar.querySelector('[data-level-filter=">=7"]').classList.remove('active');
                        }
                    }

                    const anyActive = Array.from(filterBtns).some(b => b.classList.contains('active') && b.dataset.levelFilter !== 'all');
                    if (!anyActive) {
                        filterBar.querySelector('[data-level-filter="all"]').classList.add('active');
                    }
                }
                applyFiltersAndSorting();
            });
        });
    }

    // --- 应用排序和筛选的函数 ---
    function applyFiltersAndSorting() {
        const allCards = Array.from(document.querySelectorAll('[data-oc-id]'));
        if (allCards.length === 0) return;

        const parent = allCards[0].parentNode;
        const filterBar = document.getElementById('oc-filter-bar');
        if (!filterBar) return;

        const activeFilters = Array.from(filterBar.querySelectorAll('[data-level-filter].active'))
            .map(btn => btn.dataset.levelFilter);
        const isFilterAll = activeFilters.includes('all');

        const sortDefaultState = filterBar.querySelector('#oc-sort-default').dataset.sortState;
        const sortLevelState = filterBar.querySelector('#oc-sort-level').dataset.sortState;
        const sortTimeState = filterBar.querySelector('#oc-sort-time').dataset.sortState;
        const sortScoreState = filterBar.querySelector('#oc-sort-score').dataset.sortState; // 工分排序状态

        let visibleCards = [];

        allCards.forEach(card => {
            const level = parseInt(card.dataset.ocLevel || '0');
            let isVisible = false;

            if (isFilterAll || activeFilters.length === 0) {
                isVisible = true;
            } else {
                isVisible = activeFilters.some(filter => {
                    if (filter === '<=6') return level <= 6;
                    if (filter === '>=7') return level >= 7;
                    return level == filter;
                });
            }

// 【修改点】：用添加 CSS 类的方式隐藏，而不是 display: none
            if (isVisible) {
                card.classList.remove('oc-hidden-card');
                visibleCards.push(card);
            } else {
                card.classList.add('oc-hidden-card');
            }
        });

        if (sortDefaultState === 'active') {
            visibleCards.sort((a, b) => {
                const indexA = parseInt(a.dataset.ocOriginalIndex || '0');
                const indexB = parseInt(b.dataset.ocOriginalIndex || '0');
                return indexA - indexB;
            });
        } else {
            const primarySortBtn = filterBar.querySelector('#oc-sort-level.primary-sort, #oc-sort-time.primary-sort, #oc-sort-score.primary-sort');
            const primarySort = primarySortBtn ? (
                primarySortBtn.id === 'oc-sort-level' ? 'level' :
                    primarySortBtn.id === 'oc-sort-time' ? 'time' : 'score'
            ) : 'none';

            visibleCards.sort((a, b) => {
                const levelA = parseInt(a.dataset.ocLevel || '0');
                const levelB = parseInt(b.dataset.ocLevel || '0');
                const timeA = parseInt(a.dataset.ocTime || Number.MAX_SAFE_INTEGER);
                const timeB = parseInt(b.dataset.ocTime || Number.MAX_SAFE_INTEGER);
                const scoreA = parseFloat(a.dataset.ocMaxScore || '-1');
                const scoreB = parseFloat(b.dataset.ocMaxScore || '-1');

                let primaryCompare = 0;
                let secondaryCompare = 0;

                if (primarySort === 'level') {
                    if (sortLevelState !== 'none') {
                        primaryCompare = (sortLevelState === 'asc' ? levelA - levelB : levelB - levelA);
                    }
                    if (sortTimeState !== 'none') {
                        secondaryCompare = (sortTimeState === 'asc' ? timeA - timeB : timeB - timeA);
                    } else if (sortScoreState !== 'none') {
                        secondaryCompare = (sortScoreState === 'asc' ? scoreA - scoreB : scoreB - scoreA);
                    }
                } else if (primarySort === 'time') {
                    if (sortTimeState !== 'none') {
                        primaryCompare = (sortTimeState === 'asc' ? timeA - timeB : timeB - timeA);
                    }
                    if (sortLevelState !== 'none') {
                        secondaryCompare = (sortLevelState === 'asc' ? levelA - levelB : levelB - levelA);
                    } else if (sortScoreState !== 'none') {
                        secondaryCompare = (sortScoreState === 'asc' ? scoreA - scoreB : scoreB - scoreA);
                    }
                } else if (primarySort === 'score') {
                    if (sortScoreState !== 'none') {
                        primaryCompare = (sortScoreState === 'asc' ? scoreA - scoreB : scoreB - scoreA);
                    }
                    if (sortLevelState !== 'none') {
                        secondaryCompare = (sortLevelState === 'asc' ? levelA - levelB : levelB - levelA);
                    } else if (sortTimeState !== 'none') {
                        secondaryCompare = (sortTimeState === 'asc' ? timeA - timeB : timeB - timeA);
                    }
                }
                return primaryCompare !== 0 ? primaryCompare : secondaryCompare;
            });
        }

        visibleCards.forEach(card => parent.appendChild(card));

        const countEl = filterBar.querySelector('#oc-filter-count');
        countEl.textContent = `(${visibleCards.length}/${allCards.length})`;
    }

    // --- 全局计算最高分（用于颜色分级）---
    function calculateGlobalMaxScore() {
        const allCards = document.querySelectorAll('[data-oc-id]');
        let globalMaxScore = 0;

        // 优化：先收集所有卡片的数据，减少重复计算
        const cardData = [];
        allCards.forEach(card => {
            const notOpening = card.querySelector('[class*="notOpening___"]');
            if (!notOpening) return;

            const titleEl = card.querySelector('[class*="panelTitle___"]');
            const crimeName = titleEl ? titleEl.textContent.trim() : 'Unknown';
            const levelVal = card.querySelector('span[class^="levelValue"]');
            const crimeLevel = levelVal ? parseIntSafe(levelVal.textContent) : NaN;

            if (!Number.isFinite(crimeLevel)) return;

            // 统计空缺岗位数量
            const allSlots = Array.from(notOpening.children);
            let vacantCount = 0;
            allSlots.forEach(child => {
                const isVacant = child.querySelector('[class*="joinButton___"]') ||
                    child.querySelector('[class*="joinContainer___"]') ||
                    hasClassPrefix(child, "waitingJoin");
                if (isVacant) vacantCount++;
            });

            if (vacantCount <= 0) return;

            cardData.push({ crimeName, crimeLevel, vacantCount, notOpening });
        });

        // 批量计算分数
        cardData.forEach(({ crimeName, crimeLevel, vacantCount, notOpening }) => {
            Array.from(notOpening.children).forEach((child) => {
                const isVacant = child.querySelector('[class*="joinButton___"]') ||
                    child.querySelector('[class*="joinContainer___"]') ||
                    hasClassPrefix(child, "waitingJoin");

                if (!isVacant) return;

                const jobNameEl = child.querySelector('[class*="title___"]');
                const jobName = jobNameEl ? jobNameEl.textContent.trim() : 'Unknown';
                const chanceEl = child.querySelector('[class*="successChance___"]');
                const chance = chanceEl ? parseIntSafe(chanceEl.textContent) : NaN;

                if (Number.isFinite(chance)) {
                    const matchResult = getXishuMatchResult(crimeName, crimeLevel, jobName, chance);
                    if (matchResult.reason === "ok" && Number.isFinite(matchResult.a)) {
                        // 根据工分类型计算分数
                        if (scoreType === 'daily') {
                            // 每日工分：只计算单日收益，不乘以空缺天数
                            const dailyProfit = matchResult.a;
                            globalMaxScore = Math.max(globalMaxScore, dailyProfit);
                        } else {
                            // 总工分：系数 × 空缺岗位数
                            const totalProfit = matchResult.a * vacantCount;
                            globalMaxScore = Math.max(globalMaxScore, totalProfit);
                        }
                    }
                }
            });
        });

        return globalMaxScore;
    }

    function parseTornTimeToSeconds(text) {
        const parts = text.split(':').map(Number);
        if (parts.length !== 4) return Number.MAX_SAFE_INTEGER;
        const [dd, hh, mm, ss] = parts;
        return dd * 86400 + hh * 3600 + mm * 60 + ss;
    }

    function applyCornerNumbers(card) {
        const notOpening = card.querySelector('[class*="notOpening___"]');
        if (!notOpening) return;

        const titleEl = card.querySelector('[class*="panelTitle___"]');
        const crimeName = titleEl ? titleEl.textContent.trim() : 'Unknown';

        // 获取 OC 等级
        const levelVal = card.querySelector('span[class^="levelValue"]');
        const crimeLevel = levelVal ? parseIntSafe(levelVal.textContent) : NaN;

        // 统计空缺岗位数量
        const allSlots = Array.from(notOpening.children);
        let vacantCount = 0;
        allSlots.forEach(child => {
            const isVacant = child.querySelector('[class*="joinButton___"]') ||
                child.querySelector('[class*="joinContainer___"]') ||
                hasClassPrefix(child, "waitingJoin");
            if (isVacant) vacantCount++;
        });
        
        // 获取用户已占的岗位信息
        const userOccupiedSlots = getUserOccupiedSlots(card);

        notOpening.style.overflow = 'visible';

        // 获取全局最高分
        const globalMaxScore = calculateGlobalMaxScore();

        // 计算当前卡片的最大工分（用于排序）
        let cardMaxScore = -1;
        let hasCoefficientConfig = false; // 标记是否配置了系数

        // 应用显示和颜色
        Array.from(notOpening.children).forEach((child) => {
            const isVacant = child.querySelector('[class*="joinButton___"]') ||
                child.querySelector('[class*="joinContainer___"]') ||
                hasClassPrefix(child, "waitingJoin");

            // 如果不是空缺岗位，则不显示任何东西
            if (!isVacant) {
                child.querySelectorAll('.oc-corner-index').forEach(n => n.remove());
                return;
            }

            const cs = getComputedStyle(child);
            if (cs.position === 'static') child.style.position = 'relative';
            child.style.overflow = 'visible';

            const jobNameEl = child.querySelector('[class*="title___"]');
            const jobName = jobNameEl ? jobNameEl.textContent.trim() : 'Unknown';
            const chanceEl = child.querySelector('[class*="successChance___"]');
            const chance = chanceEl ? parseIntSafe(chanceEl.textContent) : NaN;

            // 使用 daguofan 的系数表计算工分
            let displayValue = '';
            let bgColor = 'transparent'; // 默认透明背景
            let totalProfit = -1;
            let userCoefficient = null;

            if (Number.isFinite(crimeLevel) && Number.isFinite(chance)) {
                const matchResult = getXishuMatchResult(crimeName, crimeLevel, jobName, chance);

                if (matchResult.reason === "chance_too_low") {
                    // 成功率太低，显示红色 0
                    displayValue = '0';
                    bgColor = '#ff6b6b'; // 红色背景
                    // 标记已配置系数，但成功率为 0
                    hasCoefficientConfig = true;
                    // cardMaxScore 保持为 -1，但因为有配置，最终会设为 0
                } else if (matchResult.reason === "ok" && Number.isFinite(matchResult.a)) {
                    // 使用新的计算逻辑，考虑用户已占岗位
                    const scoreData = calculateScoreWithUserSlot(matchResult, vacantCount, userOccupiedSlots, jobName);
                    totalProfit = scoreData.score;
                    displayValue = scoreData.displayValue;
                    userCoefficient = scoreData.userCoefficient;
                
                    // 更新卡片最大分数（只有真正匹配到系数才更新）
                    if (totalProfit > 0) {
                        cardMaxScore = Math.max(cardMaxScore, totalProfit);
                    }
                
                    // 根据全局最高分设置颜色
                    if (globalMaxScore > 0 && totalProfit === globalMaxScore) {
                        // 最高分：绿色
                        bgColor = '#51cf66';
                    } else if (globalMaxScore > 0 && totalProfit >= globalMaxScore * 0.8) {
                        // 较高分（>=80%最高分）：黄色
                        bgColor = '#ffe066';
                    } else if (globalMaxScore > 0 && totalProfit >= globalMaxScore * 0.6) {
                        // 中等分数（>=60%最高分）：橙色
                        bgColor = '#ffd43b';
                    } else {
                        // 普通分数：浅灰色
                        bgColor = '#c0c0c0';
                    }
                } else {
                    // 其他情况（未命中系数表等），不显示任何内容
                    displayValue = '';
                    bgColor = 'transparent'; // 透明背景
                    // 没有配置系数，hasCoefficientConfig 保持为 false
                }
            }

            child.querySelectorAll('.oc-corner-index').forEach(n => n.remove());

            // 根据开关决定是否显示工分
            const showScoreEnabled = true; // 工分始终显示
            if (showScoreEnabled) {
                const badge = document.createElement('div');
                badge.className = 'oc-corner-index';
                badge.textContent = displayValue;
                
                // 如果有用户系数信息，添加提示
                if (userCoefficient !== null && userOccupiedSlots.length > 0) {
                    badge.title = `当前岗位系数: ${userCoefficient}\n您已占用 ${userOccupiedSlots.length} 个岗位`;
                }

                Object.assign(badge.style, {
                    position: 'absolute',
                    right: '-6px',
                    bottom: '-6px',
                    zIndex: '5',
                    padding: '2px 6px',
                    lineHeight: '1',
                    fontSize: '12px',
                    fontWeight: '700',
                    color: '#000', // 黑色字体
                    background: bgColor,
                    borderRadius: '999px',
                    boxShadow: `0 0 0 2px ${bgColor}`, // 边框颜色与背景色一致
                    pointerEvents: 'none',
                    userSelect: 'none',
                });
                child.appendChild(badge);
            }
        });

        // 保存卡片最大工分到 dataset（用于排序）
        // 如果配置了系数但有岗位显示红色 0，则设为 0；如果没有配置系数，则设为 -1
        if (hasCoefficientConfig && cardMaxScore === -1) {
            // 有配置但所有岗位都是成功率太低，设为 0
            card.dataset.ocMaxScore = '0';
        } else {
            card.dataset.ocMaxScore = String(cardMaxScore);
        }
    }

    // --- ensureOverlay (仅在 simplifyEnabled=true 时运行) ---
    function ensureOverlay(card) {
        const scenario = card.querySelector('[class*="scenario___"]');
        if (!scenario) return;
        if (scenario.querySelector('[data-oc-overlay]')) return;
        if (scenario.querySelector('[class*="success___"]')) return;
        if (scenario.querySelector('[class*="failed___"]')) return;

        Array.from(scenario.children).forEach((child) => {
            child.style.visibility = 'hidden';
            child.style.pointerEvents = 'none';
            child.style.minHeight = '34px';
            child.style.height = '34px';
        });

        scenario.style.position = 'relative';
        const overlay = document.createElement('div');
        overlay.dataset.ocOverlay = '1';
        Object.assign(overlay.style, {
            position: 'absolute',
            inset: '0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            flexWrap: 'wrap',
            gap: '6px',
            padding: '4px 8px',
            background: 'rgba(255, 255, 255, 0.45)',
            fontSize: '12px',
            color: '#fff',
            pointerEvents: 'none',
        });

        function makeBlock(el, minWidth = 'auto', flex = '0 0 auto') {
            Object.assign(el.style, {
                display: 'inline-block',
                padding: '4px 6px',
                borderRadius: '4px',
                minWidth,
                flex,
                textAlign: 'center',
                whiteSpace: 'nowrap',
            });
            return el;
        }

        const statusEl = makeBlock(document.createElement('span'), '50px', '0 0 auto');
        statusEl.classList.add('oc-overlay-status');

        const timerEl = makeBlock(document.createElement('span'), '80px', '0 0 auto');
        timerEl.style.fontVariantNumeric = 'tabular-nums';
        timerEl.classList.add('oc-overlay-timer');

        const localEl = makeBlock(document.createElement('span'), '200px', '0 0 auto');
        localEl.classList.add('oc-overlay-local');

        const nameEl = makeBlock(document.createElement('span'), '160px', '1 1 auto');
        nameEl.style.overflow = 'hidden';
        nameEl.style.textOverflow = 'ellipsis';
        nameEl.classList.add('oc-overlay-name');

        const levelEl = makeBlock(document.createElement('span'), '40px', '0 0 auto');
        levelEl.style.fontWeight = '700';
        levelEl.classList.add('oc-overlay-level');

        overlay.append(statusEl, timerEl, localEl, nameEl, levelEl);
        scenario.appendChild(overlay);
        scenario._ocOverlay = { statusEl, timerEl, localEl, nameEl, levelEl };
    }

    // --- 重构：更新卡片信息 (数据绑定+可选的UI更新) ---
    function updateCardInfo(card) {
        // --- 1. 查找元素 ---
        const titleEl = card.querySelector('[class*="panelTitle___"]');
        const levelVal = card.querySelector('span[class^="levelValue"]');
        const timerSrc = card.querySelector('[class*="phase___"] [class*="title___"]') || card.querySelector('[class*="title___"]');
        const crimeName = titleEl ? titleEl.textContent.trim() : 'Unknown';
        const crimeLevel = levelVal ? levelVal.textContent.trim() : '?';
        const status = getStatus(card);
        const remaining = timerSrc ? timerSrc.textContent.trim() : '';
        const localTime = (status === 'active') ? calcLocalTime(remaining) : '未知';

        // --- 2. 始终绑定数据 (用于排序) ---
        card.dataset.ocLevel = levelVal ? parseInt(crimeLevel) : 0;
        if (status === 'active') {
            card.dataset.ocTime = parseTornTimeToSeconds(remaining);
        } else {
            card.dataset.ocTime = Number.MAX_SAFE_INTEGER;
        }

        // --- 3. 仅在 "简化" 模式下更新 overlay UI ---
        if (simplifyEnabled && isShowOverlay) {
            const o = card.querySelector('[class*="scenario___"]')._ocOverlay;
            if (!o) return;

            const levelColor = levelVal ? window.getComputedStyle(levelVal).color : 'inherit';

            o.statusEl.textContent = statusIcon(status);
            o.statusEl.style.backgroundColor = statusColor(status);
            o.timerEl.textContent = (status === 'recruiting') ? '' : remaining;
            o.timerEl.style.backgroundColor = statusColor(status);
            o.localEl.textContent = '倒计时结束于 ' + localTime;
            o.localEl.style.backgroundColor = statusColor(status);
            o.nameEl.textContent = crimeName;
            o.nameEl.style.backgroundColor = levelColor;
            o.levelEl.textContent = `Lv.${crimeLevel}`;
            o.levelEl.style.backgroundColor = levelColor;
        }

        // --- 4. 始终设置观察者 (用于更新数据和可选的UI) ---
        if (timerSrc && !card._ocObserver) { // 使用一个观察者
            let lastUpdate = 0;
            const updateInterval = 1000; // 最多每秒更新一次
            
            card._ocObserver = new MutationObserver(() => {
                const now = Date.now();
                if (now - lastUpdate < updateInterval) return; // 防抖：限制更新频率
                lastUpdate = now;
                
                const newTimeText = timerSrc.textContent.trim();
                const currentStatus = getStatus(card);

                // 始终更新数据（仅在值变化时更新）
                const newTimeValue = currentStatus === 'active' ? parseTornTimeToSeconds(newTimeText) : Number.MAX_SAFE_INTEGER;
                const currentTimeValue = parseInt(card.dataset.ocTime || String(Number.MAX_SAFE_INTEGER));
                if (newTimeValue !== currentTimeValue) {
                    card.dataset.ocTime = String(newTimeValue);
                }

                // 仅在 "简化" 模式下更新 overlay 计时器（仅在文本变化时更新）
                if (simplifyEnabled && isShowOverlay) {
                    const o = card.querySelector('[class*="scenario___"]')._ocOverlay;
                    if (o && o.timerEl && o.timerEl.textContent !== newTimeText) {
                        o.timerEl.textContent = newTimeText;
                    }
                }
            });
            card._ocObserver.observe(timerSrc, { childList: true, characterData: true, subtree: true });

            // 初始设置 overlay 计时器
            if (simplifyEnabled && isShowOverlay) {
                const o = card.querySelector('[class*="scenario___"]')._ocOverlay;
                if (o && o.timerEl) o.timerEl.textContent = timerSrc.textContent.trim();
            }
        }
    }

    function getStatus(card) {
        const phase = card.querySelector('[class*="phase___"]');
        if (!phase) return '';
        const icon = phase.querySelector('[class*="iconContainer___"]');
        if (icon) return icon.getAttribute('aria-label');
    }

    function statusIcon(status) {
        if (status === 'paused') return '⏸ 暂停中';
        if (status === 'active') return '▶ 进行中';
        if (status === 'recruiting') return '⏹ 招募中';
        return '❓ 未知';
    }

    function statusColor(status) {
        if (status === 'paused') return '#757947';
        if (status === 'active') return '#62a362';
        if (status === 'recruiting') return '#4682b4';
        return '#033649';
    }

    function calcLocalTime(text) {
        const parts = text.split(':').map(Number);
        if (parts.length !== 4) return '';
        const [dd, hh, mm, ss] = parts;
        const totalSeconds = dd * 86400 + hh * 3600 + mm * 60 + ss;
        const end = new Date(Date.now() + totalSeconds * 1000);
        const options = {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        };
        return end.toLocaleString('zh-CN', options).replace(/\//g, '/');
    }

    // --- 遍历应用 (已修改) ---
    function applyOverlays() {
        const cards = document.querySelectorAll('[data-oc-id]');
        cards.forEach((c, index) => {

            if (c.dataset.ocOriginalIndex === undefined) {
                c.dataset.ocOriginalIndex = index;
            }

            if (simplifyEnabled) {
                // 简化显示模式：先创建 overlay，再更新数据，再加工分
                if (isShowInfluence === true) {
                    applyCornerNumbers(c);
                }
                if (isShowOverlay === true) {
                    ensureOverlay(c);
                }
                updateCardInfo(c);
            } else {
                // 原始显示模式：更新数据 + 显示工分
                updateCardInfo(c);
                if (isShowInfluence === true) {
                    applyCornerNumbers(c);
                }
            }
        });
    }


    // --- 启动逻辑 ---
    let appearObserver = null;
    let removalObserver = null;
    let currentListElement = null;

    function startWatchingForCrimesList(callback) {
        if (appearObserver) appearObserver.disconnect();
        let lastRun = 0;
        const interval = 200; // ms
        appearObserver = new MutationObserver(() => {
            const now = Date.now();
            if (now - lastRun < interval) return;
            lastRun = now;
            const list = document.querySelectorAll('[data-oc-id]');
            if (list.length > 0) {
                const first = list[0];
                if (first !== currentListElement) {
                    console.log('[data-oc-id] 出现了,一共 ' + list.length + ' 个');
                    currentListElement = first;
                    onCrimesListAppeared(first, callback);
                    watchCrimesListRemoval(first, callback);
                }
            }
        });

        appearObserver.observe(document.body, { childList: true, subtree: true });
        console.log('🔍 开始监听 [data-oc-id] 的出现');
    }

    function watchCrimesListRemoval(listElement, callback) {
        const parent = listElement.parentNode;
        if (!parent) {
            currentListElement = null;
            return startWatchingForCrimesList(callback);
        }
        let lastRun = 0;
        const interval = 200; // ms
        removalObserver = new MutationObserver(() => {
            const now = Date.now();
            if (now - lastRun < interval) return;
            lastRun = now;
            if (!document.body.contains(listElement)) {
                console.log('[data-oc-id] 被移除了');
                removalObserver.disconnect();
                currentListElement = null;
                startWatchingForCrimesList(callback);
            }
        });

        removalObserver.observe(parent, { childList: true, subtree: true });
        console.log('👀 开始监听 [data-oc-id] 的消失与变化');
    }

    function onCrimesListAppeared(root, callback) {
        const listContainer = root.parentNode;
        if (listContainer) {
            injectStyles(); // 始终注入 CSS (用于筛选栏)
            createFilterBar(listContainer); // 始终创建筛选栏 (包含开关)
        }

        callback(); // 执行原始的回调 (即 applyOverlays)
        applyFiltersAndSorting(); // 始终应用排序和筛选
    }

    // 启动监听
    startWatchingForCrimesList(() => {
        applyOverlays();
    });

})();