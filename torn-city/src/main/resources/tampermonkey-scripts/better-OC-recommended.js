// ==UserScript==
// @name         OC优化和推荐
// @version      2.0
// @description  优化 Torn 派系犯罪卡片的显示效果，并增加多级排序、筛选和简化开关，增加大锅饭总工分显示，集成智能推荐系统（基于当前成功率和系数配置）
// @author       zmpress [3633431]
// @match        https://www.torn.com/factions.php?step=your*
// @grant        GM_xmlhttpRequest
// @updateURL    https://raw.githubusercontent.com/zmpress/game-script-center/refs/heads/main/torn-city/src/main/resources/tampermonkey-scripts/better-OC-recommended.js
// @downloadURL    https://raw.githubusercontent.com/zmpress/game-script-center/refs/heads/main/torn-city/src/main/resources/tampermonkey-scripts/better-OC-recommended.js
//
// ==/UserScript==

(function () {
    'use strict';

    // --- 新增：本地存储和开关状态 ---
    const LS_KEY_SIMPLIFY = 'oc_simplify_display';
    const LS_KEY_API_KEY = 'z_tornMinimalKey'; // Torn API Key
    const LS_KEY_USER_FACTION = 'z_api2_userFaction'; // 用户帮派信息缓存
    const LS_KEY_FACTION_ID = 'oc_faction_id'; // 帮派ID（手动设置，备用）
    const LS_KEY_RECOMMEND_MODE = 'oc_recommend_mode'; // 推荐模式开关
    const LS_KEY_SHOW_OTHERS_SCORE = 'oc_show_others_score'; // 显示其他人工分开关

    // 默认值为 'true'。只有当 localStorage 明确存为 'false' 时才为 false。
    const simplifyEnabled = localStorage.getItem(LS_KEY_SIMPLIFY) !== 'false';
    
    // 显示其他人工分开关（默认为 false，隐藏其他人工分）
    const showOthersScore = localStorage.getItem(LS_KEY_SHOW_OTHERS_SCORE) === 'true';

    // 固定使用每日工分
    const scoreType = 'daily';

    // 获取 API Key
    const apiKey = localStorage.getItem(LS_KEY_API_KEY);

    // 获取当前用户的帮派ID，优先从 API 缓存获取，其次从手动设置获取
    let currentFactionId = '20465'; // 默认值

    // 推荐模式状态（默认为 false，需要手动开启）
    // 注意：这里强制设置为 false，不读取 localStorage，确保每次打开页面都是关闭状态
    let recommendMode = false;
    
    // 当前用户信息
    let currentUserId = null;
    let currentUserName = '';
    
    // 推荐显示相关变量
    let lastRecommendationExecution = 0; // 上次推荐执行时间
    const RECOMMEND_DEBOUNCE_TIME = 5000; // 5秒防抖延迟（防止标签切换频繁触发）
    let recommendationExecuting = false; // 防止并发执行
    let currentRecommendations = []; // 缓存当前推荐结果
    let isTabSwitching = false; // 标记是否正在切换标签
    let tabSwitchTimeout = null; // 标签切换定时器
    let lastActiveTab = null; // 记录上次激活的标签
    let xishuTableLoaded = false; // 标记系数表是否已加载完成

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
     * 从页面获取当前用户信息
     */
    function getCurrentUserInfo() {
        // 尝试从页面中获取用户信息
        const menuInfoRow = document.querySelector('.menu-info-row___nRClV');
        if (menuInfoRow) {
            const nameLink = menuInfoRow.querySelector('a.menu-value___vn8gN');
            if (nameLink) {
                const href = nameLink.getAttribute('href');
                const match = href ? href.match(/XID=(\d+)/) : null;
                if (match) {
                    currentUserId = match[1];
                    currentUserName = nameLink.textContent.trim();
                    console.log('[OCSort] 获取到当前用户信息:', currentUserName, '(ID:', currentUserId + ')');
                    return;
                }
            }
        }
        
        // 如果页面中没有找到，尝试从 localStorage 获取
        const playerId = localStorage.getItem('sessionTokenOwner') || localStorage.getItem('PlayerId');
        if (playerId) {
            currentUserId = playerId;
            currentUserName = 'Unknown';
            console.log('[OCSort] 从 localStorage 获取到用户 ID:', currentUserId);
        }
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

        // 遍历所有岗位，找到当前用户已占的岗位
        Array.from(notOpening.children).forEach((child, index) => {
            const isVacant = child.querySelector('[class*="joinButton___"]') ||
                child.querySelector('[class*="joinContainer___"]') ||
                hasClassPrefix(child, "waitingJoin");

            // 如果不是空缺，检查是否是当前用户占用
            if (!isVacant) {
                // 查找用户名元素
                const userNameEl = child.querySelector('.textName___X5wiu');
                if (userNameEl) {
                    const userName = userNameEl.textContent.trim();
                    // 如果用户名匹配当前用户，说明是当前用户占用的岗位
                    if (userName === currentUserName && currentUserName) {
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
                        console.log(`[OCSort] 发现用户已占岗位: ${jobName} (${userName})`);
                    }
                }
            }
        });

        return occupiedSlots;
    }

    /**
     * 计算工分时考虑用户已占岗位（固定使用每日工分）
     */
    function calculateScoreWithUserSlot(matchResult, vacantCount, userOccupiedSlots, currentJobName) {
        if (matchResult.reason !== "ok" || !Number.isFinite(matchResult.a)) {
            return { score: -1, displayValue: '', userCoefficient: null };
        }

        const coefficient = matchResult.a;
        // 固定使用每日工分：只计算单日收益，不乘以空缺天数
        const totalProfit = coefficient;

        return {
            score: totalProfit,
            displayValue: formatProfitValue(totalProfit),
            userCoefficient: coefficient
        };
    }

    // 初始化加载系数表（异步，优先从网络获取）
    loadXishuTable().then(() => {
        console.log('[OCSort] 系数表初始化完成');
        xishuTableLoaded = true; // 标记为已加载
    });

    // 获取当前用户信息
    getCurrentUserInfo();

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
      @keyframes slideIn {
        from {
          transform: translateX(400px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
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
            // 清除表单提交状态，然后重新加载当前页面
            if (window.history.replaceState) {
                window.history.replaceState(null, '', window.location.href);
            }
            window.location.reload();
        });

        // --- 显示其他人工分开关 ---
        const showOthersScoreBtn = document.createElement('button');
        showOthersScoreBtn.id = 'oc-toggle-others-score';
        showOthersScoreBtn.className = 'oc-btn';
        if (showOthersScore) {
            showOthersScoreBtn.textContent = '隐藏其他人工分';
            showOthersScoreBtn.classList.add('active');
        } else {
            showOthersScoreBtn.textContent = '显示其他人工分';
        }
        showOthersScoreBtn.addEventListener('click', () => {
            const newState = !showOthersScore;
            localStorage.setItem(LS_KEY_SHOW_OTHERS_SCORE, newState);
            // 清除表单提交状态，然后重新加载当前页面
            if (window.history.replaceState) {
                window.history.replaceState(null, '', window.location.href);
            }
            window.location.reload();
        });

        // 将显示其他人工分按钮插入到简化按钮之后
        simplifyBtn.parentNode.insertBefore(showOthersScoreBtn, simplifyBtn.nextSibling);

        // --- 大锅饭推荐按钮 ---
        const recommendBtn = document.createElement('button');
        recommendBtn.id = 'oc-toggle-recommend';
        recommendBtn.className = 'oc-btn';
        if (recommendMode) {
            recommendBtn.textContent = '🌟 关闭推荐';
            recommendBtn.classList.add('active');
        } else {
            recommendBtn.textContent = '🌟 大锅饭推荐';
        }
        recommendBtn.addEventListener('click', async () => {
            // 检查是否在 Recruiting 页签
            const activeTab = document.querySelector('.buttonsContainer___yYIas .button___QqDaS.active___ILnLJ');
            if (activeTab) {
                const tabName = activeTab.querySelector('.tabName___Ri9Gx');
                if (tabName && tabName.textContent.trim() !== 'Recruiting') {
                    showNotification('⚠️ 请切换到"未完成 OC"（Recruiting）页签后再开启推荐', 3000);
                    return;
                }
            }
                    
            // 如果系数表还未加载完成，等待加载
            if (!xishuTableLoaded) {
                showNotification('⏳ 正在加载系数表，请稍候...', 2000);
                console.log('[OCSort] 系数表尚未加载完成，等待中...');
                        
                // 等待最多 5 秒
                const maxWaitTime = 5000;
                const startTime = Date.now();
                        
                while (!xishuTableLoaded && (Date.now() - startTime) < maxWaitTime) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                        
                if (!xishuTableLoaded) {
                    showNotification('❌ 系数表加载超时，请检查网络连接或刷新页面', 3000);
                    console.error('[OCSort] 系数表加载超时');
                    return;
                }
                        
                console.log('[OCSort] 系数表加载完成，继续执行');
            }
                    
            recommendMode = !recommendMode;
            localStorage.setItem(LS_KEY_RECOMMEND_MODE, recommendMode);

            if (recommendMode) {
                recommendBtn.textContent = '🌟 关闭推荐';
                recommendBtn.classList.add('active');
                showNotification('已开启推荐模式，正在分析最佳 OC...');
            } else {
                recommendBtn.textContent = '🌟 大锅饭推荐';
                recommendBtn.classList.remove('active');
                showNotification('已关闭推荐模式');
            }

            // 清空缓存，强制重新计算
            currentRecommendations = [];
            lastRecommendationExecution = 0;
            
            // 重新应用显示
            applyOverlays();
            applyRecommendDisplay();
        });

        // 将推荐按钮插入到显示其他人工分按钮之后
        showOthersScoreBtn.parentNode.insertBefore(recommendBtn, showOthersScoreBtn.nextSibling);

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
                                    // 清除表单提交状态，然后重新加载当前页面
                                    if (window.history.replaceState) {
                                        window.history.replaceState(null, '', window.location.href);
                                    }
                                    window.location.reload();
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

            cardData.push({ crimeName, crimeLevel, notOpening });
        });

        // 批量计算分数 - 只计算空缺岗位和当前用户已占岗位
        cardData.forEach(({ crimeName, crimeLevel, notOpening }) => {
            Array.from(notOpening.children).forEach((child) => {
                const isVacant = child.querySelector('[class*="joinButton___"]') ||
                    child.querySelector('[class*="joinContainer___"]') ||
                    hasClassPrefix(child, "waitingJoin");

                // 检查这个岗位是否是当前用户占用的
                const userNameEl = child.querySelector('.textName___X5wiu');
                let isCurrentUserSlot = false;
                if (userNameEl && currentUserName) {
                    const userName = userNameEl.textContent.trim();
                    isCurrentUserSlot = (userName === currentUserName);
                }

                // 只计算空缺岗位和当前用户已占岗位的分数
                if (!isVacant && !isCurrentUserSlot) {
                    return;
                }

                const jobNameEl = child.querySelector('[class*="title___"]');
                const jobName = jobNameEl ? jobNameEl.textContent.trim() : 'Unknown';
                const chanceEl = child.querySelector('[class*="successChance___"]');
                const chance = chanceEl ? parseIntSafe(chanceEl.textContent) : NaN;

                if (Number.isFinite(chance)) {
                    const matchResult = getXishuMatchResult(crimeName, crimeLevel, jobName, chance);
                    if (matchResult.reason === "ok" && Number.isFinite(matchResult.a)) {
                        // 固定使用每日工分：只计算单日收益
                        const dailyProfit = matchResult.a;
                        globalMaxScore = Math.max(globalMaxScore, dailyProfit);
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

            const cs = getComputedStyle(child);
            if (cs.position === 'static') child.style.position = 'relative';
            child.style.overflow = 'visible';

            const jobNameEl = child.querySelector('[class*="title___"]');
            const jobName = jobNameEl ? jobNameEl.textContent.trim() : 'Unknown';
            const chanceEl = child.querySelector('[class*="successChance___"]');
            const chance = chanceEl ? parseIntSafe(chanceEl.textContent) : NaN;

            // 检查这个岗位是否是当前用户占用的
            const userNameEl = child.querySelector('.textName___X5wiu');
            let isCurrentUserSlot = false;
            if (userNameEl && currentUserName) {
                const userName = userNameEl.textContent.trim();
                isCurrentUserSlot = (userName === currentUserName);
            }

            // 只显示空缺岗位和当前用户已占岗位的工分
            // 其他人占用的岗位根据设置决定是否显示
            if (!isVacant && !isCurrentUserSlot) {
                if (showOthersScore) {
                    // 如果开启了显示其他人工分，继续处理
                } else {
                    // 隐藏其他人工分，直接返回
                    child.querySelectorAll('.oc-corner-index').forEach(n => n.remove());
                    return;
                }
            }

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

            // 显示工分：空缺岗位和当前用户已占岗位都显示
            if (displayValue) {
                const badge = document.createElement('div');
                badge.className = 'oc-corner-index';
                badge.textContent = displayValue;

                // 添加提示
                if (userCoefficient !== null) {
                    if (isCurrentUserSlot) {
                        badge.title = `当前岗位系数: ${userCoefficient}\n您已占用此岗位`;
                    } else if (isVacant) {
                        badge.title = `当前岗位系数: ${userCoefficient}\n空缺岗位`;
                    } else if (showOthersScore) {
                        badge.title = `当前岗位系数: ${userCoefficient}\n其他人占用`;
                    }
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
                    background: isVacant || isCurrentUserSlot ? bgColor : '#ffffff', // 空缺和自己用计算的颜色，其他人用白色
                    borderRadius: isVacant || isCurrentUserSlot ? '999px' : '4px', // 空缺和自己用圆形，其他人用方形
                    boxShadow: `0 0 0 2px ${isVacant || isCurrentUserSlot ? bgColor : '#ffffff'}`, // 边框颜色与背景色一致
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

    // ==================== 推荐算法集成 ====================

    /**
     * 显示通知消息（几秒后自动消失）
     */
    function showNotification(message, duration = 3000) {
        // 移除旧的通知
        const oldNotification = document.getElementById('oc-notification');
        if (oldNotification) {
            oldNotification.remove();
        }

        // 创建新通知
        const notification = document.createElement('div');
        notification.id = 'oc-notification';
        notification.textContent = message;
        Object.assign(notification.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: '10000',
            padding: '15px 25px',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            color: '#fff',
            borderRadius: '8px',
            boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3)',
            fontSize: '14px',
            fontWeight: 'bold',
            maxWidth: '400px',
            animation: 'slideIn 0.3s ease-out'
        });

        document.body.appendChild(notification);

        // 自动消失
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.opacity = '0';
                notification.style.transition = 'opacity 0.3s';
                setTimeout(() => notification.remove(), 300);
            }
        }, duration);
    }

    /**
     * 解析 OC 等级
     */
    function parseOcLevel(card) {
        const levelVal = card.querySelector('span[class^="levelValue"]');
        return levelVal ? parseIntSafe(levelVal.textContent) : NaN;
    }

    /**
     * 获取 OC 名称
     */
    function getOcName(card) {
        const titleEl = card.querySelector('[class*="panelTitle___"]');
        return titleEl ? titleEl.textContent.trim() : 'Unknown';
    }

    /**
     * 获取用户当前成功率数据（从页面实时提取）
     */
    function getUserOcData() {
        const cards = Array.from(document.querySelectorAll('[data-oc-id]'));
        const userOcData = [];

        cards.forEach(card => {
            const ocName = getOcName(card);
            const ocLevel = parseOcLevel(card);
            const notOpening = card.querySelector('[class*="notOpening___"]');

            if (!notOpening) return;

            // 遍历所有岗位，提取用户已占岗位的成功率
            Array.from(notOpening.children).forEach(child => {
                const isVacant = child.querySelector('[class*="joinButton___"]') ||
                    child.querySelector('[class*="joinContainer___"]') ||
                    hasClassPrefix(child, "waitingJoin");

                // 如果不是空缺，说明是用户已占岗位
                if (!isVacant) {
                    const jobNameEl = child.querySelector('[class*="title___"]');
                    const jobName = jobNameEl ? jobNameEl.textContent.trim() : 'Unknown';
                    const chanceEl = child.querySelector('[class*="successChance___"]');
                    const chance = chanceEl ? parseIntSafe(chanceEl.textContent) : NaN;

                    if (Number.isFinite(chance)) {
                        userOcData.push({
                            ocName: ocName,
                            rank: ocLevel,
                            position: jobName,
                            passRate: chance
                        });
                    }
                }
            });
        });

        console.log('[OCSort] 提取到用户当前成功率数据:', userOcData.length, '条');
        console.log('[OCSort] 详细数据:', userOcData.map(d => `${d.ocName}(Lv.${d.rank})-${d.position}=${d.passRate}%`).join(', '));
        return userOcData;
    }

    /**
     * 获取招募中的 OC 列表
     */
    function getRecruitOcList() {
        const cards = Array.from(document.querySelectorAll('[data-oc-id]'));
        const recruitList = [];

        cards.forEach(card => {
            const ocId = card.dataset.ocId;
            const ocName = getOcName(card);
            const ocLevel = parseOcLevel(card);

            // 检查是否是招募状态
            const status = getStatus(card);
            if (status === 'recruiting' || status === 'active') {
                recruitList.push({
                    id: ocId,
                    name: ocName,
                    rank: ocLevel,
                    readyTime: null, // TODO: 从页面提取准备时间
                    factionId: parseInt(currentFactionId)
                });
            }
        });

        return recruitList;
    }

    /**
     * 获取空闲岗位列表
     */
    function getEmptySlotList() {
        const cards = Array.from(document.querySelectorAll('[data-oc-id]'));
        const emptySlots = [];

        cards.forEach(card => {
            const ocId = card.dataset.ocId;
            const notOpening = card.querySelector('[class*="notOpening___"]');

            if (!notOpening) return;

            Array.from(notOpening.children).forEach((child, index) => {
                const isVacant = child.querySelector('[class*="joinButton___"]') ||
                    child.querySelector('[class*="joinContainer___"]') ||
                    hasClassPrefix(child, "waitingJoin");

                if (isVacant) {
                    const jobNameEl = child.querySelector('[class*="title___"]');
                    const jobName = jobNameEl ? jobNameEl.textContent.trim() : 'Unknown';
                    const chanceEl = child.querySelector('[class*="successChance___"]');
                    const chance = chanceEl ? parseIntSafe(chanceEl.textContent) : NaN;

                    emptySlots.push({
                        ocId: ocId,
                        position: jobName,
                        slotCode: jobName, // TODO: 需要映射到标准岗位代码
                        passRate: chance
                    });
                }
            });
        });

        return emptySlots;
    }

    /**
     * 查找招募中的 OC 列表
     */
    function findRecruitList(factionId, recruitOcList, joinedOc) {
        // 跑了进度的，只能判断当前队，可以换位置
        if (joinedOc && joinedOc.slot && joinedOc.slot.progress > 0) {
            return [joinedOc.oc];
        }

        if (!joinedOc) {
            return recruitOcList;
        }

        // 针对于空转进度的，按照进度跑完时间减一天去计算
        const joinedOcItem = joinedOc.oc;
        let calcOc = recruitOcList.find(o => o.id === joinedOcItem.id);

        if (calcOc) {
            calcOc = { ...calcOc };
            calcOc.readyTime = subtractDays(calcOc.readyTime, 1);
            const index = recruitOcList.findIndex(o => o.id === calcOc.id);
            recruitOcList = [...recruitOcList.slice(0, index), calcOc, ...recruitOcList.slice(index + 1)];
        } else {
            const modifiedOc = { ...joinedOcItem };
            modifiedOc.readyTime = subtractDays(modifiedOc.readyTime, 1);
            recruitOcList = [...recruitOcList, modifiedOc];
        }

        return recruitOcList;
    }

    /**
     * 查找招募中的 OC 空位
     */
    function findEmptySlotList(recruitOcList, emptySlotList, joinedOc) {
        const recruitOcIds = new Set(recruitOcList.map(oc => oc.id));
        const filtered = emptySlotList.filter(slot => recruitOcIds.has(slot.ocId));

        if (joinedOc && joinedOc.slot) {
            filtered.push(joinedOc.slot);
        }

        return filtered;
    }

    /**
     * 检测是否大锅饭推荐（只要配置了 OC 系数就是大锅饭模式）
     */
    function checkIsReassignRecommended(user, userOcData) {
        // 检查是否有系数配置
        const hasCoefficientConfig = Object.keys(XISHU_TABLE).length > 0;

        if (!hasCoefficientConfig) {
            console.log('[OCSort] 未配置 OC 系数，使用普通模式');
            return false;
        }

        console.log('[OCSort] 检测到 OC 系数配置，使用大锅饭模式');
        return true;
    }

    /**
     * 查询对应的 OC 岗位配置（基于系数表）
     */
    function findSlotSetting(factionId, oc, slot) {
        // 1. 检查帮派是否禁用整个 OC
        if (isOcDisabled(factionId, oc)) {
            return null;
        }

        // 检查系数表中是否有该 OC 的配置
        const nameKey = normalizeOcName(oc.name);
        const roleKey = normalizeRole(slot.position);
        const levelKey = String(oc.rank);

        const byOc = XISHU_TABLE[nameKey];
        if (!byOc) {
            return null; // 没有系数配置
        }

        const byLevel = byOc[levelKey];
        if (!byLevel) {
            return null; // 没有该等级的配置
        }

        const ranges = byLevel[roleKey];
        if (!Array.isArray(ranges) || ranges.length === 0) {
            return null; // 没有该岗位的配置
        }

        // 从系数表中提取 passRate 范围的最小值作为要求
        let minPassRate = Infinity;
        for (const r of ranges) {
            if (!Array.isArray(r) || r.length < 3) continue;
            const min = parseFloatSafe(r[0]);
            if (Number.isFinite(min)) {
                minPassRate = Math.min(minPassRate, min);
            }
        }

        // 如果没有找到有效的最小值，使用默认值 70
        if (!Number.isFinite(minPassRate) || minPassRate === Infinity) {
            minPassRate = 70;
        }

        return {
            ocName: oc.name,
            rank: oc.rank,
            slotCode: slot.position,
            slotShortCode: slot.position,
            passRate: minPassRate,
            priority: 15 // 默认优先级
        };
    }

    /**
     * 查询对应的用户岗位成功率（使用当前页面数据）
     */
    function findUserPassRate(userOcData, oc, slotSetting) {
        if (!slotSetting) {
            console.log(`[OCSort] findUserPassRate: slotSetting 为空`);
            return null;
        }

        // 从用户当前已占岗位中查找匹配的
        const matched = userOcData.find(data => {
            const nameMatch = data.ocName === oc.name;
            const rankMatch = data.rank === oc.rank;
            const posMatch = data.position === slotSetting.slotCode;

            if (nameMatch && rankMatch && posMatch) {
                console.log(`[OCSort] ✓ 找到用户数据: OC="${data.ocName}", 等级=${data.rank}, 岗位="${data.position}", 成功率=${data.passRate}`);
            }

            return nameMatch && rankMatch && posMatch;
        });

        if (!matched) {
            console.log(`[OCSort] ✗ 未找到用户数据: OC="${oc.name}", 等级=${oc.rank}, 岗位="${slotSetting.slotCode}"`);
            console.log(`[OCSort] 用户当前数据:`, userOcData.map(d => `${d.ocName}(Lv.${d.rank})-${d.position}=${d.passRate}`).join(', '));
        }

        return matched || null;
    }

    /**
     * 计算推荐度评分（使用空闲岗位的成功率）
     */
    function calcRecommendScoreWithSlotPassRate(isReassign, oc, slotSetting, slotPassRate) {
        if (isReassign) {
            return calcReassignRecommendScoreWithSlot(oc, slotSetting, slotPassRate);
        } else {
            return calcNormalRecommendScoreWithSlot(oc, slotSetting, slotPassRate);
        }
    }

    /**
     * 计算普通模式推荐度评分（使用空闲岗位成功率）
     */
    function calcNormalRecommendScoreWithSlot(oc, slotSetting, slotPassRate) {
        const passRateScore = calcPassRateScoreFromValue(slotSetting, slotPassRate);
        const priorityScore = calcPriorityScore(slotSetting);
        const rankScore = 10 * oc.rank;
        const positionScore = passRateScore * priorityScore * 0.1 + rankScore;

        const timeScore = calculateTimeScore(new Date());
        return positionScore * 0.8 + timeScore * 0.2;
    }

    /**
     * 计算大锅饭模式推荐度评分（使用空闲岗位成功率）
     */
    function calcReassignRecommendScoreWithSlot(oc, slotSetting, slotPassRate) {
        // 1. 停转时间评分
        const timeScore = calculateTimeScore(oc.readyTime);

        // 2. 岗位评分，根据系数、成功率和岗位权重
        const coefficient = getCoefficient(oc, slotSetting.slotCode, slotPassRate);

        // 如果系数为 0，说明没有配置或匹配失败，不应该推荐
        if (coefficient === 0) {
            console.log(`[OCSort] OC "${oc.name}" 岗位 "${slotSetting.slotCode}" 系数为 0，跳过推荐`);
            return 0;
        }

        const passRateScore = calcPassRateScoreFromValue(slotSetting, slotPassRate);
        const priorityScore = calcPriorityScore(slotSetting);
        const positionScore = coefficient * 4 + passRateScore * priorityScore * 0.1 + oc.rank;

        // 3. 加权计算：时间80% + 成功率20%
        const finalScore = parseFloat((timeScore * 0.8 + positionScore * 0.2).toFixed(2));

        console.log(`[OCSort] OC "${oc.name}" 岗位 "${slotSetting.slotCode}" 推荐分数: ${finalScore} (系数: ${coefficient}, 时间分: ${timeScore}, 岗位分: ${positionScore})`);

        return finalScore;
    }

    /**
     * 从成功率值计算得分（不依赖 userPassRate 对象）
     */
    function calcPassRateScoreFromValue(slotSetting, passRate) {
        const ability = passRate - slotSetting.passRate;
        if (ability >= 10) {
            return 10;
        } else if (ability >= 5) {
            return 8;
        } else {
            return 1;
        }
    }

    /**
     * 计算推荐度评分（保留旧接口，但不再使用）
     */
    function calcRecommendScore(isReassign, oc, slotSetting, userPassRate) {
        if (isReassign) {
            return calcReassignRecommendScore(oc, slotSetting, userPassRate);
        } else {
            return calcNormalRecommendScore(oc, slotSetting, userPassRate);
        }
    }

    /**
     * 计算普通模式推荐度评分
     */
    function calcNormalRecommendScore(oc, slotSetting, userPassRate) {
        const passRateScore = calcPassRateScore(slotSetting, userPassRate);
        const priorityScore = calcPriorityScore(slotSetting);
        const rankScore = 10 * oc.rank;
        const positionScore = passRateScore * priorityScore * 0.1 + rankScore;

        const timeScore = calculateTimeScore(new Date());
        return positionScore * 0.8 + timeScore * 0.2;
    }

    /**
     * 计算大锅饭模式推荐度评分
     */
    function calcReassignRecommendScore(oc, slotSetting, userPassRate) {
        // 1. 停转时间评分
        const timeScore = calculateTimeScore(oc.readyTime);

        // 2. 岗位评分，根据系数、成功率和岗位权重
        const coefficient = getCoefficient(oc, slotSetting.slotCode, userPassRate.passRate);

        // 如果系数为 0，说明没有配置或匹配失败，不应该推荐
        if (coefficient === 0) {
            console.log(`[OCSort] OC "${oc.name}" 岗位 "${slotSetting.slotCode}" 系数为 0，跳过推荐`);
            return 0;
        }

        const passRateScore = calcPassRateScore(slotSetting, userPassRate);
        const priorityScore = calcPriorityScore(slotSetting);
        const positionScore = coefficient * 4 + passRateScore * priorityScore * 0.1 + oc.rank;

        // 3. 加权计算：时间80% + 成功率20%
        const finalScore = parseFloat((timeScore * 0.8 + positionScore * 0.2).toFixed(2));

        console.log(`[OCSort] OC "${oc.name}" 岗位 "${slotSetting.slotCode}" 推荐分数: ${finalScore} (系数: ${coefficient}, 时间分: ${timeScore}, 岗位分: ${positionScore})`);

        return finalScore;
    }

    /**
     * 构建推荐理由
     */
    function buildRecommendReason(dateTime, passRate) {
        const reasons = [];

        // 停转时间
        if (dateTime) {
            const now = new Date();
            const readyTime = new Date(dateTime);
            const hours = now <= readyTime ?
                Math.ceil((readyTime - now) / (1000 * 60 * 60)) : 0;

            if (hours <= 0) {
                reasons.push("已停转，急需加入");
            } else {
                reasons.push(`${hours}小时内停转`);
            }
        } else {
            reasons.push("新队");
        }

        // 成功率
        if (passRate >= 75) {
            reasons.push("超高成功率");
        } else if (passRate >= 70) {
            reasons.push("高成功率");
        } else {
            reasons.push("成功率达标");
        }

        return reasons.join("、");
    }

    /**
     * 计算时间评分
     */
    function calculateTimeScore(readyTime) {
        if (!readyTime) {
            // 新队99分，优先级次于2小时后停转队
            return 95;
        }

        const now = new Date();
        const ready = new Date(readyTime);
        const hoursUntilReady = now <= ready ?
            Math.ceil((ready - now) / (1000 * 60 * 60)) : 0;

        // 已经停转 - 最高优先级
        if (hoursUntilReady <= 0) {
            return 100;
        }
        // 6小时内 - 极高优先级
        if (hoursUntilReady <= 6) {
            return Math.max(100 - hoursUntilReady * 2, 95);
        }
        // 24小时内 - 高优先级，加速递减
        if (hoursUntilReady <= 24) {
            return Math.max(95 - (hoursUntilReady - 6) * 1.67, 65);
        }
        // 48小时内 - 中等优先级
        if (hoursUntilReady <= 48) {
            return Math.max(65 - (hoursUntilReady - 24) * 1.25, 35);
        }
        // 72小时内 - 低优先级
        if (hoursUntilReady <= 72) {
            return Math.max(35 - (hoursUntilReady - 48) * 0.5, 20);
        }
        // 72小时以上 - 极低优先级
        return Math.max(20 - (hoursUntilReady - 72) * 0.2, 10);
    }

    /**
     * 计算成功率得分
     */
    function calcPassRateScore(slotSetting, userPassRate) {
        const ability = userPassRate.passRate - slotSetting.passRate;
        if (ability >= 10) {
            return 10;
        } else if (ability >= 5) {
            return 8;
        } else {
            return 1;
        }
    }

    /**
     * 计算权重得分
     */
    function calcPriorityScore(slotSetting) {
        if (slotSetting.priority >= 25) {
            return 5;
        } else if (slotSetting.priority >= 20) {
            return 4;
        } else if (slotSetting.priority >= 15) {
            return 3;
        } else if (slotSetting.priority >= 10) {
            return 2;
        } else {
            return 1;
        }
    }

    /**
     * 获取日期减去天数的新日期
     */
    function subtractDays(date, days) {
        const result = new Date(date);
        result.setDate(result.getDate() - days);
        return result;
    }

    /**
     * 获取轮换 OC 名称列表（根据帮派ID）
     */
    function getRotationOcNames(factionId) {
        const ROTATION_OC_NAME = {
            20465: ["Ace in the Hole", "Stacking the Deck", "Break the Bank",
                "Clinical Precision", "Blast from the Past", "Window of Opportunity"],
            2095: ["Break the Bank", "Clinical Precision", "Blast from the Past",
                "Window of Opportunity"],
            27902: ["Break the Bank", "Clinical Precision", "Blast from the Past",
                "Window of Opportunity"]
            // ... 其他帮派
        };
        return ROTATION_OC_NAME[factionId] || [];
    }

    /**
     * 获取启用大锅饭模式的帮派列表
     */
    function getReassignFactions() {
        return [20465, 2095, 27902, 36134, 16335, 11796]; // PN, HP, CCRC, SH, NOV, BSU
    }

    /**
     * 检查 OC 是否被帮派禁用
     */
    function isOcDisabled(factionId, oc) {
        // TODO: 根据实际情况实现
        return false;
    }

    /**
     * 获取所有岗位配置
     */
    function getAllSlotSettings() {
        // TODO: 从数据库或配置中获取
        // 这里需要从 CDN 加载配置
        const cached = getCachedData('z_slot_settings_' + currentFactionId);
        return cached || [];
    }

    /**
     * 获取帮派岗位覆盖配置
     */
    function getFactionSlotOverride(factionId, oc, position) {
        // TODO: 根据实际情况实现
        return null;
    }

    /**
     * 获取工时系数
     */
    function getCoefficient(oc, position, passRate) {
        // 使用已有的 XISHU_TABLE
        const nameKey = normalizeOcName(oc.name);
        const roleKey = normalizeRole(position);
        const levelKey = String(oc.rank);

        console.log(`[OCSort] 查找系数: OC="${oc.name}"(${nameKey}), 等级=${levelKey}, 岗位="${position}"(${roleKey}), 成功率=${passRate}`);

        const byOc = XISHU_TABLE[nameKey];
        if (!byOc) {
            console.log(`[OCSort] ✗ 未找到 OC "${nameKey}" 的配置`);
            return 0;
        }

        const byLevel = byOc[levelKey];
        if (!byLevel) {
            console.log(`[OCSort] ✗ 未找到等级 ${levelKey} 的配置`);
            return 0;
        }

        const ranges = byLevel[roleKey];
        if (!Array.isArray(ranges) || ranges.length === 0) {
            console.log(`[OCSort] ✗ 未找到岗位 "${roleKey}" 的配置`);
            return 0;
        }

        console.log(`[OCSort] 找到 ${ranges.length} 个区间配置:`, ranges);

        for (const r of ranges) {
            if (!Array.isArray(r) || r.length < 3) continue;
            const min = parseFloatSafe(r[0]);
            const max = parseFloatSafe(r[1]);
            const a = parseFloatSafe(r[2]);
            if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(a)) continue;

            // 左开右闭区间 (min, max]: passRate > min && passRate <= max
            const inRange = passRate > min && passRate <= max;
            console.log(`[OCSort] 检查区间 (${min}, ${max}] -> 系数=${a}, 成功率${passRate}${inRange ? '✓ 匹配' : '✗ 不匹配'}`);

            if (inRange) {
                console.log(`[OCSort] ✓ 匹配成功，返回系数: ${a}`);
                return a;
            }
        }

        console.log(`[OCSort] ✗ 所有区间都不匹配，返回系数 0`);
        return 0;
    }

    /**
     * 执行推荐算法
     */
    function executeRecommendation(topN = 5) {
        const user = {
            factionId: parseInt(currentFactionId)
        };

        // 从页面实时提取用户当前成功率数据
        const userOcData = getUserOcData();
        const recruitOcList = getRecruitOcList();
        const emptySlotList = getEmptySlotList();
        const joinedOc = null; // TODO: 获取用户当前加入的 OC

        // 1. 查询所有招募中的 OC
        const finalRecruitList = findRecruitList(user.factionId, recruitOcList, joinedOc);
        if (!finalRecruitList || finalRecruitList.length === 0) {
            showNotification('没有找到招募中的 OC');
            return [];
        }

        // 2. 查询所有未满员的 OC
        const finalEmptySlots = findEmptySlotList(finalRecruitList, emptySlotList, joinedOc);
        if (!finalEmptySlots || finalEmptySlots.length === 0) {
            showNotification('没有空闲岗位');
            return [];
        }

        // 3. 检查是否有系数配置（大锅饭模式）
        const isReassign = checkIsReassignRecommended(user, userOcData);
        if (!isReassign) {
            showNotification('⚠️ 未检测到 OC 系数配置，请检查网络连接或刷新页面重试');
            return [];
        }

        console.log('[OCSort] 使用大锅饭推荐模式，用户当前岗位数:', userOcData.length);

        // 4. 为每个 OC 的每个空闲岗位计算推荐度
        const recommendations = [];

        for (const oc of finalRecruitList) {
            // 大锅饭制度的，只判断轮换 OC
            if (isReassign && !getRotationOcNames(user.factionId).includes(oc.name)) {
                continue;
            }

            // 查询当前 OC 下所有空闲岗位
            const vacantSlots = finalEmptySlots.filter(s => s.ocId === oc.id);

            // 尝试匹配每个空闲岗位
            for (const slot of vacantSlots) {
                const slotSetting = findSlotSetting(user.factionId, oc, slot);

                if (!slotSetting) {
                    console.log(`[OCSort] ✗ 未找到岗位配置: OC="${oc.name}", 岗位="${slot.position}"`);
                    continue;
                }

                // 使用空闲岗位的成功率（从页面提取的 vacancy 数据）
                const slotPassRate = slot.passRate;

                if (!Number.isFinite(slotPassRate)) {
                    console.log(`[OCSort] ✗ 岗位成功率无效: OC="${oc.name}", 岗位="${slot.position}", 成功率=${slotPassRate}`);
                    continue;
                }

                // 检查是否达标（使用空闲岗位的成功率）
                if (slotPassRate < slotSetting.passRate) {
                    console.log(`[OCSort] ✗ 成功率不达标: OC="${oc.name}", 岗位="${slot.position}", 当前=${slotPassRate}%, 要求=${slotSetting.passRate}%`);
                    continue;
                }

                console.log(`[OCSort] ✓ 岗位匹配成功: OC="${oc.name}", 岗位="${slot.position}", 成功率=${slotPassRate}%`);

                // 计算推荐度评分（使用空闲岗位的成功率）
                const recommendScore = calcRecommendScoreWithSlotPassRate(isReassign, oc, slotSetting, slotPassRate);

                // 过滤掉 0 分或负分的推荐（系数为 0 的已经被过滤）
                if (recommendScore <= 0) {
                    console.log(`[OCSort] OC "${oc.name}" 岗位 "${slot.position}" 分数 ${recommendScore} <= 0，跳过`);
                    continue;
                }

                const recommendReason = buildRecommendReason(oc.readyTime, slotPassRate);

                recommendations.push({
                    ocId: oc.id,
                    ocName: oc.name,
                    rank: oc.rank,
                    recommendedPosition: slot.position,
                    recommendScore: recommendScore,
                    readyTime: oc.readyTime,
                    reason: recommendReason
                });
            }
        }

        // 5. 按推荐度排序，返回 Top N
        const sorted = recommendations
            .sort((a, b) => b.recommendScore - a.recommendScore)
            .slice(0, topN);

        if (sorted.length === 0) {
            showNotification('没有找到推荐的 OC，可能已经是最佳配置或没有符合条件的 OC');
        } else {
            showNotification(`找到 ${sorted.length} 个推荐 OC，已高亮显示`);
        }

        return sorted;
    }

    /**
     * 应用推荐结果显示
     */
    function applyRecommendDisplay() {
        if (!recommendMode) {
            // 清除所有推荐标记，显示所有卡片
            document.querySelectorAll('[data-oc-id]').forEach(card => {
                card.classList.remove('oc-hidden-card');
                card.style.border = '';
                card.style.boxShadow = '';
                card.style.opacity = '';
                // 移除推荐语
                const recBadge = card.querySelector('.oc-recommend-badge');
                if (recBadge) recBadge.remove();
            });
            currentRecommendations = [];
            return;
        }
            
        // 如果正在切换标签，跳过本次执行
        if (isTabSwitching) {
            console.log('[OCSort] 检测到标签切换中，跳过推荐执行');
            return;
        }
            
        // 防抖检查：防止频繁执行
        const now = Date.now();
        if (now - lastRecommendationExecution < RECOMMEND_DEBOUNCE_TIME) {
            console.log('[OCSort] 推荐算法正在防抖中，跳过本次执行');
            return;
        }
            
        // 防止并发执行
        if (recommendationExecuting) {
            console.log('[OCSort] 推荐算法正在执行中，跳过本次调用');
            return;
        }
        
        // 检查系数表是否已加载
        if (!xishuTableLoaded) {
            console.log('[OCSort] 系数表尚未加载完成，等待加载...');
            showNotification('⏳ 系数表加载中，请稍候...', 2000);
            return;
        }

        // 如果已经有缓存的推荐结果，直接使用，避免重复计算
        if (currentRecommendations.length > 0) {
            applyRecommendationToCards(currentRecommendations);
            return;
        }
            
        recommendationExecuting = true;
        lastRecommendationExecution = now;
            
        try {
            // 执行推荐算法
            const recommendations = executeRecommendation(5);
                
            if (recommendations.length === 0) {
                currentRecommendations = [];
                return;
            }

            // 缓存推荐结果
            currentRecommendations = recommendations;
                
            applyRecommendationToCards(recommendations);
        } catch (e) {
            console.error('[OCSort] 推荐算法执行失败:', e);
            currentRecommendations = [];
        } finally {
            // 释放执行锁
            recommendationExecuting = false;
        }
    }

    /**
     * 将推荐结果应用到卡片上（优化版，避免闪烁）
     */
    function applyRecommendationToCards(recommendations) {
        if (!recommendations || recommendations.length === 0) {
            return;
        }
            
        // 为推荐的 OC 添加标记，隐藏非推荐的 OC
        const cards = Array.from(document.querySelectorAll('[data-oc-id]'));
        cards.forEach(card => {
            const ocId = card.dataset.ocId;
            const rec = recommendations.find(r => r.ocId === ocId);
                
            if (rec) {
                // 显示的 OC：移除隐藏类
                card.classList.remove('oc-hidden-card');
                    
                // 只在样式不同时才更新，避免闪烁
                const newBorder = '3px solid #ffd700';
                const newBoxShadow = '0 0 15px rgba(255, 215, 0, 0.6)';
                const newOpacity = '1';
                
                if (card.style.border !== newBorder) {
                    card.style.border = newBorder;
                }
                if (card.style.boxShadow !== newBoxShadow) {
                    card.style.boxShadow = newBoxShadow;
                }
                if (card.style.opacity !== newOpacity) {
                    card.style.opacity = newOpacity;
                }
                    
                // 添加或更新推荐语徽章
                const scenario = card.querySelector('[class*="scenario___"]');
                if (scenario) {
                    // 检查是否已有相同的徽章
                    const existingBadge = scenario.querySelector('.oc-recommend-badge');
                    const badgeText = `🌟 ${rec.reason}`;
                    
                    if (existingBadge && existingBadge.textContent === badgeText) {
                        // 徽章内容相同，不需要更新
                    } else {
                        // 移除旧的徽章
                        if (existingBadge) {
                            existingBadge.remove();
                        }

                        // 创建新的徽章
                        const badge = document.createElement('div');
                        badge.className = 'oc-recommend-badge';
                        badge.textContent = badgeText;
                        badge.title = `推荐分数: ${rec.recommendScore}\n推荐岗位: ${rec.recommendedPosition}`;
                            
                        Object.assign(badge.style, {
                            position: 'absolute',
                            top: '-10px',
                            left: '10px',
                            zIndex: '10',
                            padding: '5px 12px',
                            background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
                            color: '#fff',
                            borderRadius: '20px',
                            fontSize: '12px',
                            fontWeight: 'bold',
                            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                            whiteSpace: 'nowrap'
                        });
                            
                        scenario.style.position = 'relative';
                        scenario.appendChild(badge);
                    }
                }
            } else {
                // 非推荐的 OC：隐藏
                if (!card.classList.contains('oc-hidden-card')) {
                    card.classList.add('oc-hidden-card');
                }
                // 清除样式
                if (card.style.border) card.style.border = '';
                if (card.style.boxShadow) card.style.boxShadow = '';
                if (card.style.opacity) card.style.opacity = '';
            }
        });
    }

    /**
     * 监听标签切换事件
     */
    function setupTabSwitchListener() {
        const buttonsContainer = document.querySelector('.buttonsContainer___yYIas');
        if (!buttonsContainer) return;
        
        // 使用事件委托监听按钮点击
        buttonsContainer.addEventListener('click', (e) => {
            const button = e.target.closest('.button___QqDaS');
            if (!button) return;
            
            // 延迟检查，等待标签切换完成
            setTimeout(() => {
                const activeTab = document.querySelector('.buttonsContainer___yYIas .button___QqDaS.active___ILnLJ');
                if (activeTab) {
                    const tabName = activeTab.querySelector('.tabName___Ri9Gx');
                    if (tabName) {
                        const currentTab = tabName.textContent.trim();
                        
                        // 如果从 Recruiting 切换到其他标签，且推荐模式开启
                        if (lastActiveTab === 'Recruiting' && currentTab !== 'Recruiting' && recommendMode) {
                            console.log('[OCSort] 检测到从 Recruiting 切换到其他标签，暂停推荐');
                            isTabSwitching = true;
                            
                            // 清除之前的定时器
                            if (tabSwitchTimeout) {
                                clearTimeout(tabSwitchTimeout);
                            }
                            
                            // 设置较长的等待时间
                            tabSwitchTimeout = setTimeout(() => {
                                isTabSwitching = false;
                                tabSwitchTimeout = null;
                            }, 2000);
                        }
                        
                        lastActiveTab = currentTab;
                    }
                }
            }, 100);
        });
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

        // 如果开启了推荐模式，应用推荐显示
        if (recommendMode) {
            applyRecommendDisplay();
        }
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
            setupTabSwitchListener(); // 设置标签切换监听
        }

        // 如果是推荐模式，重置状态以强制重新计算
        if (recommendMode) {
            // 清除之前的定时器
            if (tabSwitchTimeout) {
                clearTimeout(tabSwitchTimeout);
            }
            
            // 设置标签切换标记，防止立即执行
            isTabSwitching = true;
            
            // 延长等待时间到 1.5 秒，确保页面完全渲染
            tabSwitchTimeout = setTimeout(() => {
                isTabSwitching = false;
                tabSwitchTimeout = null;
                console.log('[OCSort] 标签切换完成，允许推荐执行');
            }, 1500);
            
            // 清空缓存，强制重新计算
            currentRecommendations = [];
            // 重置防抖时间，给页面渲染留出足够时间
            lastRecommendationExecution = Date.now() - RECOMMEND_DEBOUNCE_TIME + 2500;
        }

        callback(); // 执行原始的回调 (即 applyOverlays)
        applyFiltersAndSorting(); // 始终应用排序和筛选
    }

    // 启动监听
    startWatchingForCrimesList(() => {
        applyOverlays();
    });

})();