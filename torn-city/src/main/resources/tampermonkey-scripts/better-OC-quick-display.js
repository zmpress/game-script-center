// ==UserScript==
// @name         OC进度及其他信息快捷显示
// @version      0.9
// @description  显示 oc 进度，显示drug，medical，booster 的剩余时间，显示 refill 信息，均可设置是否显示
// @author       zmpress [3633431]
// @match        https://www.torn.com/*
// @run-at       document-start
// @connect      *
// @license      MIT
// @updateURL    https://raw.githubusercontent.com/zmpress/game-script-center/refs/heads/main/torn-city/src/main/resources/tampermonkey-scripts/better-OC-quick-display.js
// @downloadURL    https://raw.githubusercontent.com/zmpress/game-script-center/refs/heads/main/torn-city/src/main/resources/tampermonkey-scripts/better-OC-quick-display.js

// ==/UserScript==

(function() {
    'use strict';

    // 防止PDA多次加载脚本
    if (window.__ocFacilitationAppStarted) return;
    window.__ocFacilitationAppStarted = true;
    console.log("🚀 OCFacilitation 启动");

    // =============== 配置管理 ===============
    const DEFAULT_CONFIG = {
        CACHE: {
            OC_DATA_DURATION: 30,
            COOLDOWN_DURATION: 30,
            REFILLS_DURATION: 30
        },
        OC_SETTINGS: {
            SHOW_OC_TIME: true,
            VISUALIZE_PROGRESS: true
        },
        COOLDOWN_SETTINGS: {
            SHOW_ICONS: true,
            SHOW_DRUG: true,
            SHOW_MEDICAL: true,
            SHOW_BOOSTER: true,
            WARNING_TIME: {
                DRUG: 300,
                MEDICAL: 300,
                BOOSTER: 300
            }
        },
        REFILLS_SETTINGS: {
            SHOW_ENERGY: true,
            SHOW_NERVE: true,
            SHOW_TOKEN: true
        },
        UI_SETTINGS: {
            SETTINGS_BUTTON_IN_SYSTEM_ICONS: false // 设置按钮是否显示在系统图标位置
        }
    };

    const CONFIG = {
        USER_ID: '',
        USER_NAME: '', // 当前用户名称
        CACHE: {
            OC_DATA_DURATION: 30, // Organized Crime API 缓存时间，单位：秒 (默认 30 秒)
            COOLDOWN_DURATION: 30, // Cooldowns API 缓存时间，单位：秒 (默认 30 秒)
            REFILLS_DURATION: 30 // Refills API 缓存时间，单位：秒 (默认 30 秒)
        },
        OC_SETTINGS: { // OC 相关设置
            SHOW_OC_TIME: true, // 显示 OC 剩余时间和进度
            VISUALIZE_PROGRESS: true // 可视化 OC 进度（false 时用文字显示）
        },
        COOLDOWN_SETTINGS: { // true 打开 / false 关闭
            SHOW_ICONS: true, // 显示图标（false 时显示文字标签）
            SHOW_DRUG: true, // 显示药物冷却
            SHOW_MEDICAL: true, // 显示医疗冷却
            SHOW_BOOSTER: true, // 显示啤酒冷却
            WARNING_TIME: { // 预警时间（秒），低于此时间显示红色
                DRUG: 300, // 药物预警时间，单位：秒（默认 5 分钟）
                MEDICAL: 300, // 医疗预警时间，单位：秒（默认 5 分钟）
                BOOSTER: 300 // 啤酒预警时间，单位：秒（默认 5 分钟）
            }
        },
        REFILLS_SETTINGS: { // true 打开 / false 关闭
            SHOW_ENERGY: true, // 显示 energy 补充状态
            SHOW_NERVE: true, // 显示 nerve 补充状态
            SHOW_TOKEN: true // 显示 token 补充状态
        },
        UI_SETTINGS: { // UI 相关设置
            SETTINGS_BUTTON_IN_SYSTEM_ICONS: false // 设置按钮是否显示在系统图标位置（默认否）
        },
        API: {
            TORN_V2_URL: 'https://api.torn.com/v2',
            ENDPOINTS: {
                USER_OC: '/user/organizedcrime',
                USER_COOLDOWNS: '/user/cooldowns',
                USER_REFILLS: '/user/refills'
            }
        },
        UI: {
            LOAD_DELAY: 300,
            UPDATE_DEBOUNCE: 500,
            TIME_TOLERANCE: 2,
            SELECTORS: {
                WRAPPER: '[class^="wrapper___"]',
                SLOTS: '[class^="wrapper___"]',
                WAITING: '[class^="waitingJoin___"]',
                TITLE: '[class^="title___"]',
                PANEL_TITLE: '[class^="panelTitle___"]',
                MOBILE_INFO: '[class^="user-information-mobile___"]',
                STATUS_ICONS: '[class^="status-icons___"]',
                LEVEL_VALUE: '[class^="levelValue___"]'
            },
            STYLES: {
                URGENT: { BORDER: '3px solid red', COLOR: 'red' },
                STABLE: { BORDER: '3px solid green', COLOR: 'green' },
                EXCESS: { BORDER: '3px solid yellow', COLOR: 'blue' }
            }
        },
        TIME: {
            SECONDS_PER_DAY: 86400,
            HOURS_PER_DAY: 24,
            URGENT_THRESHOLD: 12,
            STABLE_THRESHOLD: 36
        }
    };

    // =============== 工具类 ===============
    class Utils {
        static getCurrentTab() {
            const match = window.location.hash.match(/#\/tab=([^&]*)/);
            return match ? match[1] : null;
        }

        static isOCPage() {
            return this.getCurrentTab() === 'crimes';
        }

        static isMobileDevice() {
            return !!document.querySelector(CONFIG.UI.SELECTORS.MOBILE_INFO);
        }

        static getNow() {
            return Math.floor(Date.now() / 1000);
        }

        static debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                clearTimeout(timeout);
                timeout = setTimeout(() => func.apply(this, args), wait);
            };
        }

        static isFactionPage() {
            return window.location.pathname === '/factions.php';
        }

        static async waitForWrapper() {
            const maxAttempts = 10;
            const interval = 1000;

            for (let attempts = 0; attempts < maxAttempts; attempts++) {
                const wrappers = document.querySelectorAll(CONFIG.UI.SELECTORS.WRAPPER);
                if (wrappers.length > 0 && wrappers[0].parentNode) {
                    return wrappers[0].parentNode;
                }
                await this.delay(interval);
            }
            throw new Error('无法找到wrapper元素');
        }

        static calculateTimeFromParts(days, hours, minutes, seconds) {
            return (days * CONFIG.TIME.SECONDS_PER_DAY) +
                (hours * 3600) +
                (minutes * 60) +
                seconds;
        }

        static delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        static drawASectorShape(r, startAngle, angle, clockwise = true, color = '#5cb85c') {
            const endAngle = clockwise ? startAngle + angle : startAngle - angle;
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('version', '1.1');
            svg.style.width = `${r * 2}px`;
            svg.style.height = `${r * 2}px`;
            svg.style.display = 'block';
            svg.setAttribute('viewBox', `0 0 ${r * 2} ${r * 2}`);
            svg.style.boxSizing = 'border-box';

            const startRad = ((startAngle - 90) * Math.PI) / 180;
            const endRad = ((endAngle - 90) * Math.PI) / 180;
            const cx = r, cy = r;
            const x1 = cx + r * Math.cos(startRad);
            const y1 = cy + r * Math.sin(startRad);
            const x2 = cx + r * Math.cos(endRad);
            const y2 = cy + r * Math.sin(endRad);

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.style.boxSizing = 'border-box';
            const largeArcFlag = angle <= 180 ? '0' : '1';
            const sweepFlag = clockwise ? '1' : '0';
            path.setAttribute('d', `M ${cx},${cy} L ${x1},${y1} A ${r},${r} 0 ${largeArcFlag},${sweepFlag} ${x2},${y2} Z`);
            path.setAttribute('fill', color);

            svg.appendChild(path);
            return svg;
        }
    }



    // =============== API管理类 ===============
    class APIManager {
        // 使用 Torn 官方 V2 API 获取个人 OC 数据 (带有时间缓存机制)
        static async getUserOCData() {
            const apiKey = localStorage.getItem("z_tornMinimalKey");
            if (!apiKey) return { error: true, message: "请输入 API Key" };

            try {
                const cacheKey = 'z_api2_userOrganizedcrime';
                const cachedDataStr = localStorage.getItem(cacheKey);
                const currentTime = Date.now();
                const cacheExpirationTime = CONFIG.CACHE.OC_DATA_DURATION * 1000;

                // 判断缓存是否在有效期内
                if (cachedDataStr) {
                    const parsed = JSON.parse(cachedDataStr);
                    if (currentTime - parsed.last_fetched_time < cacheExpirationTime) {
                        return { data: parsed.data };
                    }
                }

                // 缓存已过期，请求新数据
                const response = await fetch(`${CONFIG.API.TORN_V2_URL}${CONFIG.API.ENDPOINTS.USER_OC}?key=${apiKey}`);
                const data = await response.json();

                if (data.error) {
                    console.error(`Torn API错误: ${data.error.error}`);
                    // 如果因为 Key 错误导致报错，通知重新输入
                    if (data.error.code === 1 || data.error.code === 2 || data.error.code === 18) {
                        return { error: true, message: "API Key 无效，请检查" };
                    }
                    return null; // 其他服务器错误
                }

                // 将成功返回的数据存入缓存
                localStorage.setItem(cacheKey, JSON.stringify({
                    data: data.organizedCrime,
                    last_fetched_time: currentTime
                }));

                return { data: data.organizedCrime };
            } catch (error) {
                console.error('获取玩家OC数据失败:', error);
                return null;
            }
        }

        // 获取用户冷却时间数据
        static async getUserCooldowns() {
            const apiKey = localStorage.getItem("z_tornMinimalKey");
            if (!apiKey) return null;

            try {
                const cacheKey = 'z_api2_userCooldowns';
                const cachedDataStr = localStorage.getItem(cacheKey);
                const currentTime = Date.now();
                const cacheExpirationTime = CONFIG.CACHE.COOLDOWN_DURATION * 1000;

                // 判断缓存是否在有效期内
                if (cachedDataStr) {
                    const parsed = JSON.parse(cachedDataStr);
                    if (currentTime - parsed.last_fetched_time < cacheExpirationTime) {
                        return parsed.data;
                    }
                }

                // 缓存已过期，请求新数据
                const response = await fetch(`${CONFIG.API.TORN_V2_URL}${CONFIG.API.ENDPOINTS.USER_COOLDOWNS}?key=${apiKey}`);
                const data = await response.json();

                if (data.error) {
                    console.error(`获取冷却时间失败: ${data.error.error}`);
                    return null;
                }

                // 将成功返回的数据存入缓存
                localStorage.setItem(cacheKey, JSON.stringify({
                    data: data.cooldowns,
                    last_fetched_time: currentTime
                }));

                return data.cooldowns;
            } catch (error) {
                console.error('获取冷却时间数据失败:', error);
                return null;
            }
        }

        static async getPlayerInfo() {
            // 尝试从缓存获取用户信息
            const cachedUserInfo = localStorage.getItem('z_playerInfo');
            if (cachedUserInfo) {
                try {
                    const userInfo = JSON.parse(cachedUserInfo);
                    if (userInfo && userInfo.id) {
                        console.log('[OCQuickDisplay] 使用缓存的用户信息:', userInfo.name, '(ID:', userInfo.id + ')');
                        return userInfo;
                    }
                } catch (e) {
                    console.error('[OCQuickDisplay] 解析缓存用户信息失败:', e);
                }
            }

            const apiKey = localStorage.getItem("z_tornMinimalKey");
            if (!apiKey) return null;

            try {
                const response = await fetch(`https://api.torn.com/user/?selections=basic&key=${apiKey}`);
                const data = await response.json();
                if (data.error) throw new Error(`API错误: ${data.error.error}`);

                // 缓存包含 id 和 name 的用户信息
                const userInfo = {
                    id: data.player_id,
                    name: data.name || 'Unknown'
                };
                localStorage.setItem('z_playerInfo', JSON.stringify(userInfo));
                console.log('[OCQuickDisplay] 从 API 获取并缓存用户信息:', userInfo.name, '(ID:', userInfo.id + ')');
                return userInfo;
            } catch (error) {
                console.error('获取玩家信息失败:', error);
                return null;
            }
        }

        // 获取用户补充状态数据
        static async getUserRefills() {
            const apiKey = localStorage.getItem("z_tornMinimalKey");
            if (!apiKey) return null;

            try {
                const cacheKey = 'z_api2_userRefills';
                const cachedDataStr = localStorage.getItem(cacheKey);
                const currentTime = Date.now();
                const cacheExpirationTime = CONFIG.CACHE.REFILLS_DURATION * 1000;

                // 判断缓存是否在有效期内
                if (cachedDataStr) {
                    const parsed = JSON.parse(cachedDataStr);
                    if (currentTime - parsed.last_fetched_time < cacheExpirationTime) {
                        return parsed.data;
                    }
                }

                // 缓存已过期，请求新数据
                const response = await fetch(`${CONFIG.API.TORN_V2_URL}${CONFIG.API.ENDPOINTS.USER_REFILLS}?key=${apiKey}`);
                const data = await response.json();

                if (data.error) {
                    console.error(`获取补充状态失败: ${data.error.error}`);
                    return null;
                }

                // 将成功返回的数据存入缓存
                localStorage.setItem(cacheKey, JSON.stringify({
                    data: data.refills,
                    last_fetched_time: currentTime
                }));

                return data.refills;
            } catch (error) {
                console.error('获取补充状态数据失败:', error);
                return null;
            }
        }
    }

    // =============== 状态图标管理类 ===============
    class StatusIconManager {
        // 静态方法：从本地存储加载配置
        static loadConfigFromLocalStorageStatic() {
            try {
                // 先重置为默认配置
                Object.assign(CONFIG.CACHE, DEFAULT_CONFIG.CACHE);
                Object.assign(CONFIG.OC_SETTINGS, DEFAULT_CONFIG.OC_SETTINGS);
                Object.assign(CONFIG.COOLDOWN_SETTINGS, DEFAULT_CONFIG.COOLDOWN_SETTINGS);
                CONFIG.COOLDOWN_SETTINGS.WARNING_TIME = JSON.parse(JSON.stringify(DEFAULT_CONFIG.COOLDOWN_SETTINGS.WARNING_TIME));
                Object.assign(CONFIG.REFILLS_SETTINGS, DEFAULT_CONFIG.REFILLS_SETTINGS);
                Object.assign(CONFIG.UI_SETTINGS, DEFAULT_CONFIG.UI_SETTINGS);

                // 再加载本地配置（如果有）
                const savedConfig = localStorage.getItem('z_config');
                if (savedConfig) {
                    const config = JSON.parse(savedConfig);
                    if (config.CACHE) {
                        Object.assign(CONFIG.CACHE, config.CACHE);
                    }
                    if (config.OC_SETTINGS) {
                        Object.assign(CONFIG.OC_SETTINGS, config.OC_SETTINGS);
                    }
                    if (config.COOLDOWN_SETTINGS) {
                        Object.assign(CONFIG.COOLDOWN_SETTINGS, config.COOLDOWN_SETTINGS);
                        if (config.COOLDOWN_SETTINGS.WARNING_TIME) {
                            Object.assign(CONFIG.COOLDOWN_SETTINGS.WARNING_TIME, config.COOLDOWN_SETTINGS.WARNING_TIME);
                        }
                    }
                    if (config.REFILLS_SETTINGS) {
                        Object.assign(CONFIG.REFILLS_SETTINGS, config.REFILLS_SETTINGS);
                    }
                    if (config.UI_SETTINGS) {
                        Object.assign(CONFIG.UI_SETTINGS, config.UI_SETTINGS);
                    }
                }
            } catch (e) {
                console.error('加载配置失败:', e);
            }
        }

        async updateStatusIcons() {
            const ocStatusContainer = document.getElementById('oc-status-container');
            if (!ocStatusContainer) return;

            // 每次渲染前清空之前的状态或输入框
            ocStatusContainer.innerHTML = '';

            const apiKey = localStorage.getItem("z_tornMinimalKey");
            if (!apiKey) {
                this.renderApiKeyInput(ocStatusContainer);
                return;
            }

            // 确保我们有用户信息（用来标记自己的星星标记）
            if (!CONFIG.USER_ID) {
                const userInfo = await APIManager.getPlayerInfo();
                if (userInfo) {
                    CONFIG.USER_ID = userInfo.id;
                    CONFIG.USER_NAME = userInfo.name;
                }
            }

            // 如果开启了 OC 时间显示，才获取和显示 OC 数据
            let userOC = null;
            if (CONFIG.OC_SETTINGS.SHOW_OC_TIME) {
                const response = await APIManager.getUserOCData();

                // 如果发生 Api key 无效等错误，则渲染输入框重新输入
                if (response && response.error) {
                    this.renderApiKeyInput(ocStatusContainer, response.message);
                    return;
                }

                userOC = response ? response.data : null;
            }

            // 创建一个 slotIcons 容器用于存放 OC 内容
            const slotIcons = this.createSlotIconsContainer();

            if (userOC) {
                const mappedCrime = {
                    id: userOC.id,
                    ready_at: userOC.ready_at,
                    slots: userOC.slots.map(s => ({
                        user_id: s.user ? s.user.id : null,
                        user: s.user ? {
                            id: s.user.id,
                            joined_at: s.user.joined_at,
                            progress: s.user.progress
                        } : null,
                        item_requirement: s.item_requirement,
                        isEmptySolt: function() { return this.user_id === null; },
                        hasTool: function() { return this.item_requirement && this.item_requirement.is_available; }
                    }))
                };
                this.renderParticipatingStatus(slotIcons, mappedCrime, CONFIG.USER_ID);
            } else if (CONFIG.OC_SETTINGS.SHOW_OC_TIME) {
                // 只有在开启 OC 显示时才显示"未加入oc"
                this.renderNonParticipatingStatus(slotIcons);
            }
            // 如果关闭了 OC 显示，slotIcons 会是空的，但会继续显示冷却时间
            
            // 将 slotIcons 添加到主容器
            ocStatusContainer.appendChild(slotIcons);
            
            // 无论是否显示 OC，都显示其他冷却时间
            await this.addCooldownDisplay(ocStatusContainer, slotIcons);
        }

        renderApiKeyInput(container, errorMsg = "") {
            const isMobile = Utils.isMobileDevice();
            const inputContainer = document.createElement('div');
            
            // 电脑端使用垂直布局，手机端保持水平布局
            if (isMobile) {
                inputContainer.style.display = 'flex';
                inputContainer.style.alignItems = 'center';
                inputContainer.style.gap = '5px';
            } else {
                inputContainer.style.display = 'flex';
                inputContainer.style.flexDirection = 'column';
                inputContainer.style.gap = '8px';
                inputContainer.style.alignItems = 'flex-start';
            }
            inputContainer.style.padding = '0px';

            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = errorMsg || '输入 Minimal API Key';
            input.style.padding = '4px 8px';
            input.style.border = '1px solid #ccc';
            input.style.borderRadius = '3px';
            input.style.fontSize = '12px';
            input.style.color = '#333';
            input.style.width = '180px';
            input.style.outline = 'none';

            const btn = document.createElement('button');
            btn.textContent = '确认';
            btn.style.padding = '4px 10px';
            btn.style.backgroundColor = '#4CAF50';
            btn.style.color = 'white';
            btn.style.border = 'none';
            btn.style.borderRadius = '3px';
            btn.style.cursor = 'pointer';
            btn.style.fontSize = '12px';

            btn.addEventListener('click', () => {
                const val = input.value.trim();
                if (val) {
                    // 1. 将 Key 永久保存到本地
                    localStorage.setItem('z_tornMinimalKey', val);
                    // 2. 清除之前的错误请求缓存以强制刷新
                    localStorage.removeItem('z_api2_userOrganizedcrime');
                    // 3. 清除用户信息缓存，下次重新获取
                    localStorage.removeItem('z_playerInfo');
                    // 4. 重新渲染状态图标
                    this.updateStatusIcons();
                }
            });

            inputContainer.appendChild(input);
            inputContainer.appendChild(btn);
            container.appendChild(inputContainer);
        }

        renderParticipatingStatus(container, userCrime, userId) {
            // 如果开启可视化，使用原有的进度条图形显示
            if (CONFIG.OC_SETTINGS.VISUALIZE_PROGRESS) {
                const sortedSlots = userCrime.slots.sort((a, b) => {
                    if (a.user_id && b.user_id) return a.user.joined_at - b.user.joined_at;
                    return a.user_id ? -1 : 1;
                });

                const fragment = document.createDocumentFragment();
                sortedSlots.forEach((slot) => {
                    const SegmentedIconInfo = this.getSegmentedIconInfo(slot);
                    const icon = this.createSlotIcon(slot, SegmentedIconInfo, userId);
                    // 为每个图标单独添加点击跳转事件
                    icon.addEventListener('click', () => {
                        window.location.href = `https://www.torn.com/factions.php?step=your#/tab=crimes`;
                    });
                    fragment.appendChild(icon);
                });
                container.appendChild(fragment);
            } else {
                // 如果关闭可视化，用文字显示 OC 冷却时间
                const ocTimeText = this.calculateOCTimeText(userCrime);
                const timeDiv = document.createElement('div');
                timeDiv.style.display = 'flex';
                timeDiv.style.alignItems = 'center';
                timeDiv.style.gap = '3px';
                timeDiv.style.fontSize = '11px';
                timeDiv.style.color = '#666';
                timeDiv.style.padding = '0'; // 确保没有padding
                timeDiv.style.margin = '0'; // 确保没有margin
                
                const labelSpan = document.createElement('span');
                labelSpan.textContent = 'OC:';
                labelSpan.style.fontWeight = '500';
                labelSpan.style.color = '#000';
                
                const timeSpan = document.createElement('span');
                timeSpan.textContent = ocTimeText;
                timeSpan.className = 'oc-cooldown-time';
                timeSpan.style.fontWeight = '500';
                
                // 计算剩余秒数用于颜色判断
                const remainingSeconds = this.parseOCTimeToSeconds(ocTimeText);
                if (remainingSeconds === 0) {
                    timeSpan.style.color = '#4CAF50'; // 就绪显示绿色
                } else if (remainingSeconds <= 300) {
                    timeSpan.style.color = '#FF0000'; // 低于 5 分钟显示红色
                } else {
                    timeSpan.style.color = '#000'; // 默认黑色
                }
                
                timeDiv.appendChild(labelSpan);
                timeDiv.appendChild(timeSpan);
                container.appendChild(timeDiv);
            }
        }

        async addCooldownDisplay(container, slotIcons) {
            const cooldowns = await APIManager.getUserCooldowns();
            if (!cooldowns) return;

            const refills = await APIManager.getUserRefills();

            const isMobile = Utils.isMobileDevice();
            const cooldownContainer = document.createElement('div');
            cooldownContainer.id = 'oc-cooldown-display';

            // 根据设备类型设置不同的样式和位置
            if (isMobile) {
                // 手机端：在右侧显示
                cooldownContainer.style.display = 'flex';
                cooldownContainer.style.flexDirection = 'row';
                cooldownContainer.style.alignItems = 'center';
                cooldownContainer.style.gap = '8px';
                cooldownContainer.style.marginLeft = '10px';
                cooldownContainer.style.fontSize = '11px';
                cooldownContainer.style.color = '#666';

                // 将冷却时间容器放在 slotIcons 的右侧
                slotIcons.style.display = 'flex';
                slotIcons.style.alignItems = 'center';
                slotIcons.style.padding = '0'; // 手机端移除padding，避免额外空隙
                
                const wrapper = document.createElement('div');
                wrapper.style.display = 'flex';
                wrapper.style.alignItems = 'center';
                wrapper.style.padding = '0'; // 确保wrapper没有额外padding
                wrapper.style.margin = '0'; // 确保wrapper没有额外margin
                
                // 只有当 slotIcons 有内容时才添加
                if (slotIcons.children.length > 0) {
                    wrapper.appendChild(slotIcons);
                }
                
                wrapper.appendChild(cooldownContainer);
                container.innerHTML = '';
                container.appendChild(wrapper);
            } else {
                // 电脑端：在下方显示，支持自动换行
                cooldownContainer.style.display = 'flex';
                cooldownContainer.style.flexDirection = 'row';
                cooldownContainer.style.flexWrap = 'wrap';
                cooldownContainer.style.gap = '12px';
                cooldownContainer.style.alignContent = 'flex-start';
                cooldownContainer.style.marginTop = '4px';
                cooldownContainer.style.fontSize = '11px';
                cooldownContainer.style.color = '#666';
                cooldownContainer.style.padding = '2px 0';
                cooldownContainer.style.lineHeight = '1';
                cooldownContainer.style.marginBottom = '0';
            }

            // 格式化并显示三个冷却项目
            this.renderCooldownItems(cooldownContainer, cooldowns);

            // 添加补充状态显示
            if (refills) {
                this.renderRefillsStatus(cooldownContainer, refills);
            }

            if (!isMobile) {
                container.appendChild(cooldownContainer);
            }

            // 启动定时器更新时间
            this.startCooldownTimer(cooldownContainer, cooldowns);
        }

        renderCooldownItems(container, cooldowns) {
            // 格式化并显示三个冷却项目
            const items = [
                { key: 'drug', label: 'Drug', icon: '💊' },
                { key: 'medical', label: 'Med', icon: '🏥' },
                { key: 'booster', label: 'Booster', icon: '🍺' }
            ];

            const showIcons = CONFIG.COOLDOWN_SETTINGS.SHOW_ICONS;

            items.forEach(item => {
                const seconds = cooldowns[item.key];
                const itemDiv = document.createElement('div');
                itemDiv.style.display = CONFIG.COOLDOWN_SETTINGS[`SHOW_${item.key.toUpperCase()}`] ? 'flex' : 'none';
                itemDiv.style.alignItems = 'center';
                itemDiv.style.gap = '3px';
                itemDiv.dataset.cooldownKey = item.key; // 用于后续更新
                itemDiv.style.cursor = 'pointer';

                const timeText = seconds > 0 ? this.formatCooldownTime(seconds) : '就绪';
                const warningTime = CONFIG.COOLDOWN_SETTINGS.WARNING_TIME[item.key.toUpperCase()];
                let colorStyle = 'color: #000;'; // 默认黑色

                if (seconds === 0) {
                    colorStyle = 'color: #4CAF50;'; // 就绪显示绿色
                } else if (warningTime && seconds <= warningTime) {
                    colorStyle = 'color: #FF0000;'; // 低于预警时间显示红色
                }

                // 根据开关决定显示图标还是文字标签
                const displayContent = showIcons ? item.icon : `${item.label}:`;

                itemDiv.innerHTML = `
                    <span>${displayContent}</span>
                    <span class="cooldown-time" style="${colorStyle} font-weight: 500;">${timeText}</span>
                `;

                // 添加点击跳转事件
                let targetUrl = '';
                if (item.key === 'medical') {
                    targetUrl = 'https://www.torn.com/factions.php?step=your#/tab=armoury';
                } else if (item.key === 'drug') {
                    targetUrl = 'https://www.torn.com/item.php';
                } else if (item.key === 'booster') {
                    targetUrl = 'https://www.torn.com/item.php';
                }

                if (targetUrl) {
                    itemDiv.addEventListener('click', () => {
                        window.location.href = targetUrl;
                    });
                }

                container.appendChild(itemDiv);
            });
        }

        renderRefillsStatus(container, refills) {
            const isMobile = Utils.isMobileDevice();

            // 检查哪些补充还没用（false 表示没用过）
            const unused = [];
            if (!refills.energy && CONFIG.REFILLS_SETTINGS.SHOW_ENERGY) {
                unused.push(isMobile ? 'e' : 'energy');
            }
            if (!refills.nerve && CONFIG.REFILLS_SETTINGS.SHOW_NERVE) {
                unused.push(isMobile ? 'n' : 'nerve');
            }
            if (!refills.token && CONFIG.REFILLS_SETTINGS.SHOW_TOKEN) {
                unused.push(isMobile ? 't' : 'token');
            }

            // 如果还有未使用的补充，创建显示元素
            if (unused.length > 0) {
                const refillsDiv = document.createElement('div');
                refillsDiv.style.display = 'flex';
                refillsDiv.style.alignItems = 'center';
                refillsDiv.style.gap = '3px';
                refillsDiv.style.margin = '0';
                refillsDiv.style.padding = '0';
                refillsDiv.style.fontSize = '11px';
                refillsDiv.style.color = '#666';
                refillsDiv.style.cursor = 'pointer';

                const labelText = unused.join(',');
                refillsDiv.innerHTML = `<span style="font-weight: 500; color: #000;">${labelText}</span>`;

                // 添加点击跳转事件
                refillsDiv.addEventListener('click', () => {
                    window.location.href = 'https://www.torn.com/page.php?sid=points';
                });

                container.appendChild(refillsDiv);
            }

            // 只有在未开启系统图标位置显示时，才在这里添加设置按钮
            if (!CONFIG.UI_SETTINGS.SETTINGS_BUTTON_IN_SYSTEM_ICONS) {
                this.addSettingsButton(container);
            }
        }

        addSettingsButton(container) {
            const settingsBtn = document.createElement('button');
            settingsBtn.textContent = '⚙️';
            settingsBtn.title = 'OC进度显示和Cooldowns设置';
            settingsBtn.style.cssText = `
                background: none;
                border: none;
                cursor: pointer;
                font-size: 11px;
                padding: 0;
                margin-left: 5px;
                opacity: 0.7;
                transition: opacity 0.2s;
                line-height: 1;
            `;
            settingsBtn.addEventListener('mouseover', () => settingsBtn.style.opacity = '1');
            settingsBtn.addEventListener('mouseout', () => settingsBtn.style.opacity = '0.7');
            settingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showSettingsPanel();
            });
            container.appendChild(settingsBtn);
        }

        addSettingsButtonToSystemIcons() {
            console.log('尝试添加设置按钮到系统图标位置...');
            // 查找系统图标容器
            const statusIconsContainer = document.querySelector('ul[class^="status-icons___"]');
            if (!statusIconsContainer) {
                console.log('未找到系统图标容器，500ms后重试...');
                // 如果还没找到，延迟重试
                setTimeout(() => this.addSettingsButtonToSystemIcons(), 500);
                return;
            }
                    
            console.log('找到系统图标容器:', statusIconsContainer);
                    
            // 检查是否已经添加过
            if (document.getElementById('oc-settings-system-icon')) {
                console.log('设置按钮已存在，跳过添加');
                return;
            }

            const li = document.createElement('li');
            li.id = 'oc-settings-system-icon';
            // 复制其他图标的样式类
            const firstChild = statusIconsContainer.children[0];
            if (firstChild) {
                li.className = firstChild.className;
            }
            li.style.cursor = 'pointer';

            const btn = document.createElement('button');
            btn.textContent = '⚙️';
            btn.title = 'OC进度显示和Cooldowns设置';
            btn.setAttribute('data-tooltip-instant', 'true'); // 标记为立即显示
            btn.style.cssText = `
                background: none;
                border: none;
                cursor: pointer;
                font-size: 16px;
                padding: 0;
                width: 100%;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
            `;
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.showSettingsPanel();
            });

            li.appendChild(btn);
            statusIconsContainer.appendChild(li);
        }

        showSettingsPanel() {
            const existingPanel = document.querySelector('.oc-settings-panel');
            if (existingPanel) {
                existingPanel.remove();
                return;
            }

            // 每次打开设置时，从本地重新加载最新配置
            StatusIconManager.loadConfigFromLocalStorageStatic();

            const panel = document.createElement('div');
            panel.className = 'oc-settings-panel';
            const isMobile = Utils.isMobileDevice();

            panel.style.cssText = `
                position: fixed;
                top: ${isMobile ? '50%' : '100px'};
                left: ${isMobile ? '50%' : '50%'};
                transform: translate(-50%, ${isMobile ? '-50%' : '0'});
                background: white;
                border: 2px solid #ddd;
                border-radius: 8px;
                box-shadow: 0 4px 16px rgba(0,0,0,0.2);
                padding: 0;
                z-index: 10000;
                min-width: ${isMobile ? '320px' : '450px'};
                max-width: 90vw;
                max-height: 80vh;
                display: flex;
                flex-direction: column;
            `;

            const title = document.createElement('h3');
            title.textContent = '⚙️OC进度显示和Cooldowns设置';
            title.style.cssText = `margin: 0; padding: 20px 20px 15px 20px; border-bottom: 2px solid #eee; font-size: ${isMobile ? '16px' : '18px'}; color: #333;`;
            panel.appendChild(title);

            // 内容区域 - 可滚动
            const contentDiv = document.createElement('div');
            contentDiv.style.cssText = `
                flex: 1;
                overflow-y: auto;
                padding: 20px;
            `;

            // 缓存时间设置
            contentDiv.appendChild(this.createCacheSection());

            // OC 显示设置
            contentDiv.appendChild(this.createOCSettingsSection());

            // 冷却显示设置
            contentDiv.appendChild(this.createCooldownSection());

            // Refills 显示设置
            contentDiv.appendChild(this.createRefillsSection());

            // UI 设置
            contentDiv.appendChild(this.createUISettingsSection());

            panel.appendChild(contentDiv);

            // 按钮区域 - 固定在面板底部
            const buttonDiv = document.createElement('div');
            buttonDiv.style.cssText = `
                display: flex;
                flex-direction: row;
                gap: 10px;
                justify-content: center;
                padding: 15px 20px;
                border-top: 2px solid #eee;
                background: white;
                flex-shrink: 0;
            `;

            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = '取消';
            cancelBtn.style.cssText = 'padding: 10px 20px; border: 1px solid #ddd; border-radius: 4px; background: #f5f5f5; cursor: pointer; font-size: 14px; min-width: 80px;';
            cancelBtn.addEventListener('click', () => { panel.remove(); overlay.remove(); });

            const confirmBtn = document.createElement('button');
            confirmBtn.textContent = '确定';
            confirmBtn.style.cssText = 'padding: 10px 20px; border: none; border-radius: 4px; background: #4CAF50; color: white; cursor: pointer; font-size: 14px; font-weight: bold; min-width: 80px;';
            confirmBtn.addEventListener('mouseover', () => confirmBtn.style.background = '#45a049');
            confirmBtn.addEventListener('mouseout', () => confirmBtn.style.background = '#4CAF50');
            confirmBtn.addEventListener('click', () => {
                this.saveSettingsToLocalStorage();
                panel.remove();
                overlay.remove();
                window.location.reload();
            });

            buttonDiv.appendChild(cancelBtn);

            const resetBtn = document.createElement('button');
            resetBtn.textContent = '恢复默认设置';
            resetBtn.style.cssText = 'padding: 10px 20px; border: 1px solid #ff9800; border-radius: 4px; background: #fff3e0; color: #ff9800; cursor: pointer; font-size: 14px; min-width: 100px;';
            resetBtn.addEventListener('mouseover', () => {
                resetBtn.style.background = '#ffe0b2';
                resetBtn.style.color = '#f57c00';
            });
            resetBtn.addEventListener('mouseout', () => {
                resetBtn.style.background = '#fff3e0';
                resetBtn.style.color = '#ff9800';
            });
            resetBtn.addEventListener('click', () => {
                if (confirm('确定要恢复默认设置吗？\n\n将删除以下内容：\n- 所有自定义配置\n- API Key\n- 所有接口缓存数据\n- 用户信息缓存\n\n此操作不可恢复！')) {
                    // 删除配置
                    localStorage.removeItem('z_config');
                    // 删除 API Key
                    localStorage.removeItem('z_tornMinimalKey');
                    // 删除所有接口缓存
                    localStorage.removeItem('z_api2_userOrganizedcrime');
                    localStorage.removeItem('z_api2_userCooldowns');
                    localStorage.removeItem('z_api2_userRefills');
                    // 删除用户信息缓存
                    localStorage.removeItem('z_playerInfo');
                    
                    console.log('✅ 已清除所有脚本数据和缓存');
                    window.location.reload();
                }
            });
            buttonDiv.appendChild(resetBtn);

            buttonDiv.appendChild(confirmBtn);
            panel.appendChild(buttonDiv);

            const overlay = document.createElement('div');
            overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 9999;';
            overlay.addEventListener('click', () => { panel.remove(); overlay.remove(); });

            document.body.appendChild(overlay);
            document.body.appendChild(panel);
        }

        createCacheSection() {
            const section = document.createElement('div');
            section.style.marginBottom = '20px';

            const title = document.createElement('h4');
            title.textContent = '📦 缓存设置（秒）';
            title.style.cssText = 'margin: 0 0 10px 0; font-size: 14px; color: #555;';
            section.appendChild(title);

            section.appendChild(this.createNumberInput('OC 数据缓存', CONFIG.CACHE.OC_DATA_DURATION, (val) => { CONFIG.CACHE.OC_DATA_DURATION = parseInt(val) || 30; }));
            section.appendChild(this.createNumberInput('冷却时间缓存', CONFIG.CACHE.COOLDOWN_DURATION, (val) => { CONFIG.CACHE.COOLDOWN_DURATION = parseInt(val) || 30; }));
            section.appendChild(this.createNumberInput('Refills 缓存', CONFIG.CACHE.REFILLS_DURATION, (val) => { CONFIG.CACHE.REFILLS_DURATION = parseInt(val) || 30; }));

            return section;
        }

        createOCSettingsSection() {
            const section = document.createElement('div');
            section.style.marginBottom = '20px';

            const title = document.createElement('h4');
            title.textContent = '🎭 OC 进度显示';
            title.style.cssText = 'margin: 0 0 10px 0; font-size: 14px; color: #555;';
            section.appendChild(title);

            section.appendChild(this.createToggle('显示 OC 剩余时间', CONFIG.OC_SETTINGS.SHOW_OC_TIME, (v) => { CONFIG.OC_SETTINGS.SHOW_OC_TIME = v; }));
            section.appendChild(this.createToggle('可视化 OC 进度（关闭则用文字显示）', CONFIG.OC_SETTINGS.VISUALIZE_PROGRESS, (v) => { CONFIG.OC_SETTINGS.VISUALIZE_PROGRESS = v; }));

            return section;
        }

        createCooldownSection() {
            const section = document.createElement('div');
            section.style.marginBottom = '20px';

            const title = document.createElement('h4');
            title.textContent = '🎯 冷却时间显示';
            title.style.cssText = 'margin: 0 0 10px 0; font-size: 14px; color: #555;';
            section.appendChild(title);

            section.appendChild(this.createToggle('显示图标', CONFIG.COOLDOWN_SETTINGS.SHOW_ICONS, (v) => { CONFIG.COOLDOWN_SETTINGS.SHOW_ICONS = v; }));
            section.appendChild(this.createToggle('显示药物', CONFIG.COOLDOWN_SETTINGS.SHOW_DRUG, (v) => { CONFIG.COOLDOWN_SETTINGS.SHOW_DRUG = v; }));
            section.appendChild(this.createToggle('显示医疗', CONFIG.COOLDOWN_SETTINGS.SHOW_MEDICAL, (v) => { CONFIG.COOLDOWN_SETTINGS.SHOW_MEDICAL = v; }));
            section.appendChild(this.createToggle('显示啤酒', CONFIG.COOLDOWN_SETTINGS.SHOW_BOOSTER, (v) => { CONFIG.COOLDOWN_SETTINGS.SHOW_BOOSTER = v; }));

            section.appendChild(this.createNumberInput('药物预警时间(秒)', CONFIG.COOLDOWN_SETTINGS.WARNING_TIME.DRUG, (val) => { CONFIG.COOLDOWN_SETTINGS.WARNING_TIME.DRUG = parseInt(val) || 300; }));
            section.appendChild(this.createNumberInput('医疗预警时间(秒)', CONFIG.COOLDOWN_SETTINGS.WARNING_TIME.MEDICAL, (val) => { CONFIG.COOLDOWN_SETTINGS.WARNING_TIME.MEDICAL = parseInt(val) || 300; }));
            section.appendChild(this.createNumberInput('啤酒预警时间(秒)', CONFIG.COOLDOWN_SETTINGS.WARNING_TIME.BOOSTER, (val) => { CONFIG.COOLDOWN_SETTINGS.WARNING_TIME.BOOSTER = parseInt(val) || 300; }));

            return section;
        }

        createRefillsSection() {
            const section = document.createElement('div');
            section.style.marginBottom = '20px';

            const title = document.createElement('h4');
            title.textContent = '⚡ Refills 显示';
            title.style.cssText = 'margin: 0 0 10px 0; font-size: 14px; color: #555;';
            section.appendChild(title);

            section.appendChild(this.createToggle('显示 Energy', CONFIG.REFILLS_SETTINGS.SHOW_ENERGY, (v) => { CONFIG.REFILLS_SETTINGS.SHOW_ENERGY = v; }));
            section.appendChild(this.createToggle('显示 Nerve', CONFIG.REFILLS_SETTINGS.SHOW_NERVE, (v) => { CONFIG.REFILLS_SETTINGS.SHOW_NERVE = v; }));
            section.appendChild(this.createToggle('显示 Token', CONFIG.REFILLS_SETTINGS.SHOW_TOKEN, (v) => { CONFIG.REFILLS_SETTINGS.SHOW_TOKEN = v; }));

            return section;
        }

        createUISettingsSection() {
            const section = document.createElement('div');
            section.style.marginBottom = '20px';

            const title = document.createElement('h4');
            title.textContent = '🎨 UI 设置';
            title.style.cssText = 'margin: 0 0 10px 0; font-size: 14px; color: #555;';
            section.appendChild(title);

            section.appendChild(this.createToggle('设置按钮显示在系统图标位置', CONFIG.UI_SETTINGS.SETTINGS_BUTTON_IN_SYSTEM_ICONS, (v) => { CONFIG.UI_SETTINGS.SETTINGS_BUTTON_IN_SYSTEM_ICONS = v; }));

            return section;
        }

        createNumberInput(label, value, onChange) {
            const div = document.createElement('div');
            div.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f0f0f0;';

            const labelSpan = document.createElement('span');
            labelSpan.textContent = label;
            labelSpan.style.fontSize = '13px';
            labelSpan.style.color = '#333';

            const input = document.createElement('input');
            input.type = 'number';
            input.value = value;
            input.min = '1';
            input.max = '300';
            input.style.cssText = 'width: 80px; padding: 5px 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; text-align: center;';
            input.addEventListener('change', (e) => onChange(e.target.value));

            div.appendChild(labelSpan);
            div.appendChild(input);
            return div;
        }

        createToggle(label, checked, onChange) {
            const div = document.createElement('div');
            div.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f0f0f0; cursor: pointer;';

            const labelSpan = document.createElement('span');
            labelSpan.textContent = label;
            labelSpan.style.fontSize = '13px';
            labelSpan.style.color = '#333';

            // 创建一个引用对象，用于在闭包中动态获取最新值
            const stateRef = { value: checked };

            const toggleContainer = document.createElement('div');
            toggleContainer.style.cssText = `position: relative; width: 50px; height: 26px; background: ${stateRef.value ? '#4CAF50' : '#ccc'}; border-radius: 13px; transition: background 0.3s;`;

            const toggleCircle = document.createElement('div');
            toggleCircle.style.cssText = `position: absolute; top: 3px; left: ${stateRef.value ? '27px' : '3px'}; width: 20px; height: 20px; background: white; border-radius: 50%; transition: left 0.3s; box-shadow: 0 2px 4px rgba(0,0,0,0.2);`;

            toggleContainer.appendChild(toggleCircle);

            div.addEventListener('click', () => {
                stateRef.value = !stateRef.value;
                onChange(stateRef.value);
                toggleContainer.style.background = stateRef.value ? '#4CAF50' : '#ccc';
                toggleCircle.style.left = stateRef.value ? '27px' : '3px';
            });

            div.appendChild(labelSpan);
            div.appendChild(toggleContainer);
            return div;
        }

        saveSettingsToLocalStorage() {
            try {
                const configToSave = {
                    CACHE: CONFIG.CACHE,
                    OC_SETTINGS: CONFIG.OC_SETTINGS,
                    COOLDOWN_SETTINGS: CONFIG.COOLDOWN_SETTINGS,
                    REFILLS_SETTINGS: CONFIG.REFILLS_SETTINGS,
                    UI_SETTINGS: CONFIG.UI_SETTINGS
                };
                localStorage.setItem('z_config', JSON.stringify(configToSave));
            } catch (e) {
                console.error('保存配置失败:', e);
            }
        }

        startCooldownTimer(container, initialCooldowns) {
            // 清除可能存在的旧定时器
            if (this.cooldownTimerId) {
                clearInterval(this.cooldownTimerId);
            }

            // 存储剩余秒数
            const remainingSeconds = {};
            Object.keys(initialCooldowns).forEach(key => {
                remainingSeconds[key] = initialCooldowns[key];
            });

            // 每秒更新一次
            this.cooldownTimerId = setInterval(() => {
                let allReady = true;

                // 更新每个冷却项
                container.querySelectorAll('[data-cooldown-key]').forEach(itemDiv => {
                    const key = itemDiv.dataset.cooldownKey;
                    const timeSpan = itemDiv.querySelector('.cooldown-time');

                    if (remainingSeconds[key] > 0) {
                        remainingSeconds[key]--;
                        allReady = false;

                        const timeText = this.formatCooldownTime(remainingSeconds[key]);
                        timeSpan.textContent = timeText;

                        // 根据预警时间设置颜色
                        const warningTime = CONFIG.COOLDOWN_SETTINGS.WARNING_TIME[key.toUpperCase()];
                        if (warningTime && remainingSeconds[key] <= warningTime) {
                            timeSpan.style.color = '#FF0000'; // 低于预警时间显示红色
                        } else {
                            timeSpan.style.color = '#000'; // 默认黑色
                        }
                    } else {
                        timeSpan.textContent = '就绪';
                        timeSpan.style.color = '#4CAF50'; // 就绪显示绿色
                    }
                });

                // 如果所有冷却都就绪，停止定时器
                if (allReady) {
                    clearInterval(this.cooldownTimerId);
                    this.cooldownTimerId = null;
                }
            }, 1000);
        }

        formatCooldownTime(seconds) {
            if (seconds <= 0) return '就绪';

            const days = Math.floor(seconds / 86400);
            const hours = Math.floor((seconds % 86400) / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = seconds % 60;

            if (days > 0) {
                return `${days}d ${hours}h ${minutes}m`;
            } else if (hours > 0) {
                return `${hours}h ${minutes}m`;
            } else if (minutes >= 5) {
                return `${minutes}m`;
            } else if (minutes >= 1) {
                return `${minutes}m ${secs}s`;
            } else {
                return `${secs}s`;
            }
        }

        // 计算 OC 冷却时间文本（基于 ready_at 和空槽位数）
        calculateOCTimeText(userCrime) {
            if (!userCrime || !userCrime.slots || userCrime.slots.length === 0) {
                return '未知';
            }

            const currentTime = Math.floor(Date.now() / 1000); // 当前时间戳（秒）
            
            // 计算空槽位数
            let emptySlots = 0;
            userCrime.slots.forEach(slot => {
                if (!slot.user_id) {
                    emptySlots++;
                }
            });

            // 如果没有 ready_at，返回未知
            if (!userCrime.ready_at) {
                return '未知';
            }

            // 计算基础剩余时间：ready_at - 当前时间
            let remainingSeconds = userCrime.ready_at - currentTime;

            // 加上空槽位的时间：每个空槽位加 24 小时
            remainingSeconds += emptySlots * 24 * 3600;

            // 如果时间小于等于 0，表示就绪
            if (remainingSeconds <= 0) {
                return '就绪';
            }

            return this.formatCooldownTime(remainingSeconds);
        }

        // 解析 OC 时间文本为秒数
        parseOCTimeToSeconds(timeText) {
            if (timeText === '就绪') return 0;
            if (timeText === '未开始' || timeText === '未知') return Number.MAX_SAFE_INTEGER;

            const daysMatch = timeText.match(/(\d+)d/);
            const hoursMatch = timeText.match(/(\d+)h/);
            const minutesMatch = timeText.match(/(\d+)m/);
            const secsMatch = timeText.match(/(\d+)s/);

            const days = daysMatch ? parseInt(daysMatch[1]) : 0;
            const hours = hoursMatch ? parseInt(hoursMatch[1]) : 0;
            const minutes = minutesMatch ? parseInt(minutesMatch[1]) : 0;
            const secs = secsMatch ? parseInt(secsMatch[1]) : 0;

            return days * 86400 + hours * 3600 + minutes * 60 + secs;
        }

        getSegmentedIconInfo(slot) {
            let SegmentedIconInfo = [];
            if (slot.user_id) {
                const progress = slot.user.progress;
                if (progress === 0) {
                    SegmentedIconInfo.push({color:'#FFC107', percentage:100});
                } else if (progress === 100) {
                    SegmentedIconInfo.push({color:'#5cb85c', percentage:100});
                } else {
                    SegmentedIconInfo.push({color:'#5cb85c', percentage: progress});
                    SegmentedIconInfo.push({color:'#FFC107', percentage: 100 - progress});
                }
            } else {
                SegmentedIconInfo.push({color:'#a4a4a4', percentage:100});
            }
            return SegmentedIconInfo;
        }

        renderNonParticipatingStatus(container) {
            const notInOCContainer = this.createNotInOCContainer();
            const textSpan = this.createTextSpan();
            const joinLink = this.createJoinLink();

            notInOCContainer.appendChild(textSpan);
            notInOCContainer.appendChild(joinLink);
            container.appendChild(notInOCContainer);
        }

        createSlotIconsContainer() {
            const container = document.createElement('div');
            const isMobile = Utils.isMobileDevice();

            container.style.display = 'flex';
            container.style.alignItems = 'center';
            container.style.height = 'auto';
            container.style.cursor = 'pointer';
            container.style.boxSizing = 'border-box';

            // --- 修改点：移除外层矩形边框 ---
            container.style.border = 'none';
            // ----------------------------

            // 手机端可以适当减少背景的视觉占比或调整内边距
            container.style.background = 'transparent'; // 如果不需要背景底色，设为 transparent
            container.style.padding = isMobile ? '0' : '1px 5px 1px 0px'; // 手机端完全移除padding
            container.style.margin = '0'; // 确保没有margin
            container.style.boxShadow = 'none'; // 如果有阴影也一并去掉

            container.addEventListener('mouseover', () => {
                // 如果去掉了背景色，这里可以根据需要调整悬浮效果
                container.style.background = 'rgba(0,0,0,0.03)';
                container.style.transition = 'all 0.2s ease';
            });

            container.addEventListener('mouseout', () => {
                container.style.background = 'transparent';
            });

            return container;
        }

        createSlotIcon(slot, SegmentedIconInfo, userId) {
            const icon = document.createElement('div');
            icon.style.width = '17px';
            icon.style.height = '17px';
            icon.style.borderRadius = '50%';
            icon.style.position = 'relative';
            icon.style.margin = '1px 7.5px 1px 0px'; // 紧凑：缩小圆圈本身的上下外边距
            icon.style.boxSizing = 'border-box';
            icon.style.display = 'flex';
            icon.style.alignItems = 'center';
            icon.style.justifyContent = 'center';
            icon.style.border = '1px solid #45a049';
            icon.style.boxShadow = 'inset 0 1px 1px rgba(255,255,255,0.2), 0 1px 2px rgba(0,0,0,0.1)';

            if (SegmentedIconInfo.length === 1) {
                icon.style.background = SegmentedIconInfo[0].color;
            } else {
                icon.style.background = SegmentedIconInfo[1].color;
                icon.style.zIndex = '0';
                const angle = SegmentedIconInfo[0].percentage * 3.6;
                const r = parseInt(icon.style.width) / 2 - 1;
                const fanShape = this.createFanShape(r, angle, SegmentedIconInfo[0].color);
                icon.appendChild(fanShape);
            }
            if (slot.user_id === userId) this.addPlayerMarker(icon);
            if (slot.item_requirement) this.addToolMark(slot, icon);

            this.handleMouseHover(slot, icon, SegmentedIconInfo);
            return icon;
        }

        createFanShape(r, angle, color) {
            const fanShape = Utils.drawASectorShape(r, 0, angle, true, color);
            fanShape.style.position = 'absolute';
            fanShape.style.width = '100%';
            fanShape.style.height = '100%';
            fanShape.style.zIndex = '1';
            return fanShape;
        }

        handleMouseHover(slot, icon, SegmentedIconInfo) {
            icon.addEventListener('mouseover', () => {
                const fanShape = icon.querySelector('path');
                icon.style.transform = 'scale(1.1)';
                icon.style.transition = 'all 0.2s ease';
                icon.style.boxShadow = slot.user
                    ? 'inset 0 1px 2px rgba(255,255,255,0.3), 0 2px 4px rgba(0,0,0,0.2)'
                    : 'inset 0 1px 2px rgba(255,255,255,0.2), 0 2px 4px rgba(0,0,0,0.2)';
                if (fanShape) {
                    fanShape.style.transform = 'scale(1.1)';
                    fanShape.style.boxShadow = 'inset 0 1px 2px rgba(255,255,255,0.3), 0 2px 4px rgba(0,0,0,0.2)';
                }
            });

            icon.addEventListener('mouseout', () => {
                const fanShape = icon.querySelector('path');
                icon.style.transform = 'scale(1)';
                icon.style.boxShadow = slot.user
                    ? 'inset 0 1px 1px rgba(255,255,255,0.2), 0 1px 2px rgba(0,0,0,0.1)'
                    : 'inset 0 1px 1px rgba(255,255,255,0.1), 0 1px 2px rgba(0,0,0,0.1)';
                if (fanShape) {
                    fanShape.style.transform = 'scale(1)';
                    fanShape.style.boxShadow = 'inset 0 1px 1px rgba(255,255,255,0.1), 0 1px 2px rgba(0,0,0,0.1)';
                }
            });

            const tooltip = document.createElement('div');
            tooltip.style.position = 'fixed';
            tooltip.style.visibility = 'hidden';
            tooltip.style.backgroundColor = 'rgba(40, 40, 40, 0.95)';
            tooltip.style.color = '#fff';
            tooltip.style.padding = '8px 12px';
            tooltip.style.borderRadius = '4px';
            tooltip.style.fontSize = '12px';
            tooltip.style.lineHeight = '1.4';
            tooltip.style.whiteSpace = 'nowrap';
            tooltip.style.zIndex = '1000';
            tooltip.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
            tooltip.style.transform = 'translateY(-5px)';
            tooltip.style.transition = 'all 0.2s ease';
            tooltip.style.pointerEvents = 'none'; // 防止tooltip遮挡鼠标事件

            let tooltipContent = slot.user
                ? `<div style="font-weight:500">${slot.user_id} 在这</div>`
                : '<div style="color:#aaa">空位</div>';

            if (SegmentedIconInfo.length === 2) {
                let totalSeconds = (24 - (SegmentedIconInfo[0].percentage/100 * 24)) * 3600;
                const timeDiv = document.createElement('div');
                timeDiv.style.marginTop = '4px';
                timeDiv.style.paddingTop = '4px';
                timeDiv.style.borderTop = '1px solid rgba(255,255,255,0.1)';
                timeDiv.id = 'time-div';

                const updateTime = (timeElement) => {
                    const hours = Math.floor(totalSeconds/3600);
                    const minutes = Math.floor((totalSeconds % 3600) / 60);
                    const seconds = Math.floor(totalSeconds % 60);
                    timeElement.textContent = `${hours}:${minutes.toString().padStart(2,'0')}:${seconds.toString().padStart(2,'0')} 后完成`;
                    tooltipContent += timeElement.outerHTML;
                };
                updateTime(timeDiv);

                let intervalId;
                icon.addEventListener('mouseenter', () => {
                    intervalId = setInterval(() => {
                        totalSeconds -= 1;
                        if (totalSeconds <= 0) {
                            clearInterval(intervalId);
                            return;
                        }
                        const timeElement = tooltip.querySelector('#time-div');
                        if (timeElement) updateTime(timeElement);
                    }, 1000);
                });

                icon.addEventListener('mouseleave', () => {
                    if (intervalId) {
                        clearInterval(intervalId);
                        intervalId = null;
                    }
                });
            }
            else if (SegmentedIconInfo[0].color === '#5cb85c') {
                tooltipContent += `<div style="margin-top:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.1)">已完成</div>`;
            } else if (SegmentedIconInfo[0].color === '#FFC107') {
                tooltipContent += `<div style="margin-top:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.1)">未开始</div>`;
            } else if (SegmentedIconInfo[0].color === '#a4a4a4') {
                tooltipContent += `<div style="margin-top:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.1)">待加入</div>`;
            }

            if (slot.item_requirement) {
                if (slot.isEmptySolt()) {
                    tooltipContent += `<div style="margin-top:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.1)"><span style="color:#FFA000">⚠</span> 需要工具</div>`;
                } else {
                    if (slot.hasTool()) {
                        tooltipContent += `<div style="margin-top:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.1)"><span style="color:green">✅</span> 有工具</div>`;
                    } else {
                        tooltipContent += `<div style="margin-top:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.1)"><span style="color:red">❌</span> 没有工具</div>`;
                    }
                }
            }
            tooltip.innerHTML = tooltipContent;

            icon.addEventListener('mouseenter', (e) => {
                tooltip.style.visibility = 'visible';
                tooltip.style.opacity = '1';
                tooltip.style.transform = 'translateY(0)';
                const rect = icon.getBoundingClientRect();
                const tooltipHeight = tooltip.offsetHeight;
                const topPosition = Math.max(10, rect.top - tooltipHeight - 10);
                tooltip.style.left = rect.left + 'px';
                tooltip.style.top = topPosition + 'px';
            });

            icon.addEventListener('mouseleave', () => {
                tooltip.style.visibility = 'hidden';
                tooltip.style.opacity = '0';
                tooltip.style.transform = 'translateY(-5px)';
            });

            document.body.appendChild(tooltip);
        }

        addPlayerMarker(icon) {
            const marker = document.createElement('span');
            marker.innerHTML = '★';
            marker.style.color = 'white';
            marker.style.fontSize = '10px';
            marker.style.textShadow = '0 0 1px #000';
            marker.style.zIndex = '2';
            icon.appendChild(marker);
        }

        addToolMark(slot, icon) {
            const toolMark = document.createElement('div');
            toolMark.style.position = 'absolute';
            toolMark.style.bottom = '0';
            toolMark.style.right = '0';
            toolMark.style.width = '6px';
            toolMark.style.height = '6px';
            toolMark.style.borderRadius = '50%';
            toolMark.style.transform = 'translate(25%, 25%)';
            if (slot.isEmptySolt()) {
                toolMark.style.backgroundColor = '#FFC107';
            } else {
                toolMark.style.backgroundColor = slot.hasTool() ? 'green' : 'red';
            }
            icon.appendChild(toolMark);
        }

        createNotInOCContainer() {
            const container = document.createElement('div');
            container.style.display = 'flex';
            container.style.alignItems = 'center';
            container.style.gap = '5px';
            container.style.backgroundColor = '#F44336';
            container.style.padding = '1px 8px'; // 紧凑：缩小上下内边距
            container.style.borderRadius = '3px';
            container.style.marginBottom = '2px'; // 紧凑：缩小与下面元素的距离
            return container;
        }

        createTextSpan() {
            const textSpan = document.createElement('span');
            textSpan.textContent = '未加入oc，';
            textSpan.style.fontSize = '12px';
            textSpan.style.color = 'white';
            return textSpan;
        }

        createJoinLink() {
            const joinLink = document.createElement('a');
            joinLink.textContent = '去看看';
            joinLink.href = `https://www.torn.com/factions.php?step=your#/tab=crimes`;
            joinLink.style.color = 'white';
            joinLink.style.textDecoration = 'underline';
            joinLink.style.fontSize = '13px';
            joinLink.style.fontWeight = 'bold';
            joinLink.style.textShadow = '0 0 1px rgba(255, 255, 255, 0.5)';
            joinLink.style.letterSpacing = '0.5px';

            joinLink.addEventListener('mouseover', () => {
                joinLink.style.textShadow = '0 0 2px rgba(255, 255, 255, 0.8)';
                joinLink.style.transition = 'all 0.2s ease';
            });
            joinLink.addEventListener('mouseout', () => {
                joinLink.style.textShadow = '0 0 1px rgba(255, 255, 255, 0.5)';
            });
            return joinLink;
        }
    }

    // =============== 主程序类 ===============
    class OCFacilitation {
        constructor() {
            this.currentTab = null;
            this.isUpdating = false;
            this.observer = null;
            this.statusIconManager = null;
        }

        async handlePageChange() {
            // 不再对 OC 页面进行任何干预
            return;
        }

        cleanup() {
            // 清理逻辑已简化
        }

        getStatusContainerParent() {
            if (Utils.isMobileDevice()) {
                return document.querySelector(CONFIG.UI.SELECTORS.MOBILE_INFO);
            } else {
                const topIcons = document.querySelector(CONFIG.UI.SELECTORS.STATUS_ICONS);
                return topIcons ? topIcons.parentNode : null;
            }
        }

        createStatusContainer() {
            const containerParent = this.getStatusContainerParent();
            if (!containerParent) {
                return null;
            }
            this.removeOldContainer();
            const container = document.createElement('div');
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.height = 'auto'; // 紧凑：移除原先固定的 32px
            container.style.minHeight = 'auto'; // 手机端改为auto，避免多余空隙
            container.style.marginTop = '2px'; // 紧凑：从 10px 降到 2px
            container.id = 'oc-status-container';

            if (Utils.isMobileDevice()) {
                container.style.margin = '2px 15px'; // 紧凑：移动端的 margin 也同步调小
                container.style.width = 'calc(100% - 30px)';
                container.style.padding = '0'; // 确保手机端没有padding
            }

            containerParent.appendChild(container);
            return container;
        }

        removeOldContainer() {
            const oldContainer = document.getElementById('oc-status-container');
            if (oldContainer) oldContainer.remove();
        }

        async initialize() {
            try {
                // 加载保存的配置
                this.loadConfigFromLocalStorage();

                this.statusIconManager = new StatusIconManager();
                // 不再在此处强制等待 getPlayerId，交给 updateStatusIcons 处理
                await this.setupStatusIcons();
                this.setupPageChangeListeners();

                // 如果开启了在系统图标位置显示设置按钮，则添加
                if (CONFIG.UI_SETTINGS.SETTINGS_BUTTON_IN_SYSTEM_ICONS) {
                    console.log('⚙️ 设置按钮将添加到系统图标位置');
                    setTimeout(() => {
                        this.statusIconManager.addSettingsButtonToSystemIcons();
                    }, 1000);
                } else {
                    console.log('⚙️ 设置按钮将显示在冷却区域');
                }
            } catch (error) {
                console.error('初始化失败:', error);
            }
        }

        loadConfigFromLocalStorage() {
            try {
                const savedConfig = localStorage.getItem('z_config');
                if (savedConfig) {
                    const config = JSON.parse(savedConfig);
                    if (config.CACHE) {
                        Object.assign(CONFIG.CACHE, config.CACHE);
                    }
                    if (config.OC_SETTINGS) {
                        Object.assign(CONFIG.OC_SETTINGS, config.OC_SETTINGS);
                    }
                    if (config.COOLDOWN_SETTINGS) {
                        Object.assign(CONFIG.COOLDOWN_SETTINGS, config.COOLDOWN_SETTINGS);
                    }
                    if (config.REFILLS_SETTINGS) {
                        Object.assign(CONFIG.REFILLS_SETTINGS, config.REFILLS_SETTINGS);
                    }
                    if (config.UI_SETTINGS) {
                        Object.assign(CONFIG.UI_SETTINGS, config.UI_SETTINGS);
                    }
                }
            } catch (e) {
                console.error('加载配置失败:', e);
            }
        }

        async setupStatusIcons() {
            this.statusIconManager.updateStatusIcons();
        }

        setupPageChangeListeners() {
            window.addEventListener('hashchange', () => this.handlePageChange());
            if (document.readyState === 'complete') {
                this.handlePageChange();
            } else {
                window.addEventListener('load', () => this.handlePageChange());
            }
        }
    }

    // 启动程序
    (() => {
        const app = new OCFacilitation();
        const createStatusContainerInterval = setInterval(() => {
            if (app.createStatusContainer() !== null) {
                console.log("状态容器创建成功");
                app.initialize();
                clearInterval(createStatusContainerInterval);
            }
        },300);

        window.addEventListener('unload', () => { app.cleanup(); });
    })();
})();