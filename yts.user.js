// ==UserScript==
// @name           [YTS] - Summary Button
// @name:ru        [YTS] - Кнопка Обобщения
// @name:en        [YTS] - Summary Button
// @description    Button to generate a structured summary/article from YouTube subtitles using LLM models (OpenAI compatible). Extracts subtitles, sends them to a language model, streams and displays the summary, allows quick copy, prompt management, and supports multiple languages.
// @description:ru Кнопка для генерации структурированного текста или конспекта из субтитров YouTube-видео с помощью LLM (совместимо с OpenAI). Извлекает субтитры, отправляет их в языковую модель, отображает краткое содержание, позволяет быстро скопировать, управлять шаблонами и поддерживает несколько языков.
// @description:en Button to generate a structured summary/article from YouTube subtitles using LLM (OpenAI compatible). Extracts subtitles, sends to LLM, streams result, allows quick copy, prompt management, multi-language support.
// @icon           https://www.youtube.com/favicon.ico
// @author         Reydan46
// @namespace      yts
// @version        0.6.0
// @homepageURL    https://github.com/Reydan46/youtube-summary-button
// @supportURL     https://github.com/Reydan46/youtube-summary-button/issues
// @updateURL      https://raw.githubusercontent.com/Reydan46/youtube-summary-button/main/yts.user.js
// @downloadURL    https://raw.githubusercontent.com/Reydan46/youtube-summary-button/main/yts.user.js
// @grant          GM_addStyle
// @match          https://*.youtube.com/*
// @connect        api.openai.com
// @connect        raw.githubusercontent.com
// @connect        youtube.com
// @connect        ytimg.com
// @run-at         document-idle
// ==/UserScript==

(function () {
    'use strict';

    // === Константы и идентификаторы ===
    const STORAGE_KEY = 'yts-settings';
    const BTN_ID = "YTS_GenBtn";
    const BTN_TARGET = "#owner";
    const RESULT_CONTAINER_ID = "YTS_ResultContainer";
    const MODAL_ID = 'YTS_SettingsModal';
    const CONTEXT_MENU_ID = 'YTS_ContextMenu';

    // === Стейт/настройки по-умолчанию ===
    const DEFAULT_PROMPTS = [
        {
            id: genPromptId(),
            title: "Создать заметку",
            prompt: `Ты - ассистент по анализу видеоконтента. Проанализируй предоставленные субтитры к техническому видео и создай полноценную статью в формате markdown на основе информации в субтитрах.
Предоставляй текст как будто это научно-техническая статья, минимизируй разбивку на списки, применяй их только при необходимости перечислений важных компонентов.
Избегай использование в статье фраз "автор говорит" и т.д..

Ниже я приложу необходимую структуру.
# Краткое содержание
[Здесь нужно 3-5 предложений, описывающих основную идею видео]

# Основная информация
[Подробное описание сказанного в видео.
Мне нужен подробный конспект, максимум информации по каждой подтеме. Старайся не добавлять информацию от себя, только обработка информации из субтитров.
Выделяй каждую подтему H заголовками в зависимости от важности, вплоть до H3.
Старайся минимизировать количество блоков кода, чтобы сохранить читаемость, вставляй их только когда необходимо.]

Используй следующие субтитры: `
        }
    ];
    const DEFAULT_SETTINGS = {
        prompts: DEFAULT_PROMPTS,
        activePromptId: DEFAULT_PROMPTS[0].id,
        timeout: 180000,
        url: 'https://api.openai.com/v1/chat/completions',
        token: '',
        model: 'gpt-4.1-nano'
    };

    let ytsPrintBuffer = [], ytsPrintTimer = null, ytsPrintIsComplete = false, ytsErrorAlreadyShown = false;

    /**
     * Генерация уникального id промпта
     *
     * @return {string} Уникальный идентификатор промпта
     */
    function genPromptId() {
        return 'p_' + Math.random().toString(36).slice(2, 12) + "_" + Date.now();
    }

    /**
     * Логирование с префиксом YTS
     *
     * @param {string} msg Сообщение
     * @param {any} data Данные (опционально)
     */
    function log(msg, data = undefined) {
        if (typeof data !== 'undefined') console.log('[YTS]', msg, data);
        else console.log('[YTS]', msg);
    }

    /**
     Функция для поиска первого элемента по селектору внутри заданного контекста

     @param sel CSS-селектор
     @param context Элемент-контекст для поиска (по умолчанию document)
     @return Первый найденный элемент или null
     */
    const q = (sel, context = document) =>
        (context instanceof Document || context instanceof Element)
            ? context.querySelector(sel)
            : null;

    /**
     * Декоратор-дебоунс
     *
     * @param {function} func Функция
     * @param {number} wait Таймаут (мс)
     * @return {function} Обёртка
     */
    function debounce(func, wait) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    /**
     * Глубокое сравнение объектов
     *
     * @param {object} a Первый объект
     * @param {object} b Второй объект
     * @return {boolean} true если объекты равны
     */
    function isDeepEqual(a, b) {
        if (a === b) return true;
        if (typeof a !== typeof b) return false;
        if (typeof a !== 'object' || !a || !b) return false;
        const aKeys = Object.keys(a), bKeys = Object.keys(b);
        if (aKeys.length !== bKeys.length) return false;
        for (let k of aKeys)
            if (!Object.prototype.hasOwnProperty.call(b, k) || !isDeepEqual(a[k], b[k])) return false;
        return true;
    }

    /**
     * Получение разницы между базовыми и текущими настройками
     *
     * @param {object} base Базовый объект
     * @param {object} given Дельта
     * @return {object} Дельта-настройки
     */
    function getSettingsDelta(base, given) {
        const delta = {};
        for (const key in given)
            if (!isDeepEqual(given[key], base[key])) delta[key] = given[key];
        return delta;
    }

    /**
     * Слияние настроек
     *
     * @param {object} base Базовые настройки
     * @param {object} delta Персональные настройки
     * @return {object} Объединённый объект настроек
     */
    function mergeSettings(base, delta) {
        return Object.assign({}, base, delta || {});
    }

    /**
     * Сохранение настроек
     *
     * @param {object} settings Настройки
     */
    function saveSettings(settings) {
        log('Save settings', settings);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(getSettingsDelta(DEFAULT_SETTINGS, settings)));
    }

    /**
     * Загрузка настроек
     *
     * @return {object} Настройки
     */
    function loadSettings() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            if (!data) {
                log('Use default settings');
                return {...DEFAULT_SETTINGS};
            }
            const merged = mergeSettings(DEFAULT_SETTINGS, JSON.parse(data));
            if (!Array.isArray(merged.prompts) || merged.prompts.length === 0) merged.prompts = [...DEFAULT_PROMPTS];
            merged.prompts.forEach(p => {
                if (!p.id) p.id = genPromptId();
            });
            if (!merged.activePromptId ||
                !merged.prompts.find(p => p.id === merged.activePromptId)
            ) merged.activePromptId = merged.prompts[0].id;
            return merged;
        } catch (e) {
            log('Error loadSettings, fallback to defaults', e);
            return {...DEFAULT_SETTINGS};
        }
    }

    /**
     * Смена активного промпта
     *
     * @param {string} promptId id промпта
     */
    function setActivePrompt(promptId) {
        const settings = loadSettings();
        if (settings.prompts.find(p => p.id === promptId)) {
            settings.activePromptId = promptId;
            saveSettings(settings);
            updateUIAfterPromptChange();
        }
    }

    /**
     * Получить текущий активный промпт
     *
     * @return {object} Текущий активный промпт
     */
    function getActivePrompt() {
        const s = loadSettings();
        return s.prompts.find(p => p.id === s.activePromptId) || s.prompts[0];
    }

    /**
     * Очистка контейнера результата
     *
     * @param {HTMLElement} container DOM-элемент
     */
    function clearContainer(container) {
        while (container && container.firstChild) container.removeChild(container.firstChild);
    }

    /**
     * Создает видимую текстовую кнопку "youtube-стиля" (не через <button>, а через <yt-button>)
     *
     * @param {string} text Текст кнопки
     * @param {string} className CSS класс
     * @param {function} handler Обработчик клика
     * @return {HTMLElement} Кнопка
     */
    function createTextButton(text, className, handler) {
        const btn = document.createElement('span');
        btn.className = 'yts-text-btn ' + (className || '');
        btn.textContent = text;
        btn.tabIndex = 0;
        btn.role = "button";
        btn.addEventListener('click', handler);
        btn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                handler(e);
                e.preventDefault();
            }
        });
        return btn;
    }

    /**
     * Добавляет кнопки "Свернуть"/"Развернуть" и реализует функциональность
     *
     * @param {HTMLElement} resultContainer Контейнер YTS_ResultContainer
     */
    function appendMinimizeButtons(resultContainer) {
        if (!resultContainer || resultContainer.querySelector('.yts-min-btn')) return; // Уже есть

        // Создаем кнопку "Свернуть"
        const minBtn = createTextButton('Свернуть', 'yts-min-btn', () => {
            minimizeResultContainer();
        });
        // Кнопка появляется в правом нижнем углу блока
        minBtn.style.position = 'absolute';
        minBtn.style.padding = '0';
        minBtn.style.bottom = '12px';
        minBtn.style.color = '#898989';

        resultContainer.appendChild(minBtn);
        resultContainer.classList.add('yts-can-min');
        resultContainer.style.position = 'relative';
    }

    /**
     * Сворачивает блок результата, показывает кнопу "Развернуть"
     */
    function minimizeResultContainer() {
        const resultContainer = document.getElementById(RESULT_CONTAINER_ID);
        if (!resultContainer) return;

        // Сохраняем высоту для анимации (если нужно)
        resultContainer.classList.add('yts-minimized');
        // Скрыть все кроме title-row
        const children = Array.from(resultContainer.children);
        for (let el of children) {
            if (el.classList.contains('yts-title-row')) continue;
            if (el.classList.contains('yts-min-btn')) {
                el.style.display = 'none';
                continue;
            }
            el.style.display = 'none';
        }

        // Показать кнопку "Развернуть"
        if (!resultContainer.querySelector('.yts-more-btn')) {
            const moreBtn = createTextButton('Развернуть', 'yts-more-btn', restoreResultContainer);
            moreBtn.style.position = 'absolute';
            moreBtn.style.padding = '0';
            moreBtn.style.bottom = '12px';
            moreBtn.style.color = '#898989';
            resultContainer.appendChild(moreBtn);
        } else {
            resultContainer.querySelector('.yts-more-btn').style.display = '';
        }
    }

    /**
     * Восстанавливает блок результата в полный вид, прячет "Развернуть", показывает "Свернуть"
     */
    function restoreResultContainer() {
        const resultContainer = document.getElementById(RESULT_CONTAINER_ID);
        if (!resultContainer) return;
        resultContainer.classList.remove('yts-minimized');
        // Показать все, кроме .yts-title-row и Развернуть
        const children = Array.from(resultContainer.children);
        for (let el of children) {
            if (el.classList.contains('yts-min-btn')) {
                el.style.display = '';
                continue;
            }
            if (el.classList.contains('yts-more-btn')) {
                el.style.display = 'none';
                continue;
            }
            if (el.classList.contains('yts-title-row')) continue;
            el.style.display = '';
        }
    }

    const oldUpdateResultContentStream = updateResultContentStream;
    updateResultContentStream = function (deltaText, isComplete) {
        oldUpdateResultContentStream(deltaText, isComplete);
        const container = document.getElementById(RESULT_CONTAINER_ID);
        if (isComplete && container) {
            setTimeout(() => appendMinimizeButtons(container), 10);
        }
    };

    /**
     * Добавление блока кнопок копирования
     *
     * @param {HTMLElement} container Контейнер
     * @param {string} summaryText Текст для копирования (результат)
     * @param {string} subtitlesText Оригинальные субтитры для копирования
     */
    function appendCopyButtons(container, summaryText, subtitlesText) {
        if (q('.yts-copy-btn-group', container)) return;
        const groupDiv = document.createElement('div');
        groupDiv.className = 'yts-copy-btn-group';

        const btnCopySummary = createButtonIcon({
            title: 'Копировать результат',
            icon: '📋',
            onClick: function () {
                navigator.clipboard.writeText(summaryText).then(() => {
                    markBtnCopied(btnCopySummary);
                }).catch(() => {
                    markBtnFailed(btnCopySummary);
                });
            }
        });
        groupDiv.appendChild(btnCopySummary);

        const btnCopySubs = createButtonIcon({
            title: 'Копировать субтитры',
            icon: '💬',
            onClick: function () {
                navigator.clipboard.writeText(subtitlesText).then(() => {
                    markBtnCopied(btnCopySubs);
                }).catch(() => {
                    markBtnFailed(btnCopySubs);
                });
            }
        });
        groupDiv.appendChild(btnCopySubs);

        let titleRow = container.querySelector('.yts-title-row');
        if (!titleRow) {
            titleRow = document.createElement('div');
            titleRow.className = 'yts-title-row';
            container.insertBefore(titleRow, container.firstChild);
            const old = container.querySelector('.result-title');
            if (old && old.parentNode !== titleRow) old.remove();
        }
        titleRow.appendChild(groupDiv);
    }

    /**
     * Подсветка кнопки как "Скопировано"
     *
     * @param {HTMLElement} btn Кнопка DOM
     */
    function markBtnCopied(btn) {
        btn.classList.remove('yts-copy-failed');
        btn.classList.add('yts-copy-success');
        setTimeout(() => {
            btn.classList.remove('yts-copy-success');
        }, 1500);
    }

    /**
     * Подсветка кнопки как "Ошибка копирования"
     *
     * @param {HTMLElement} btn Кнопка DOM
     */
    function markBtnFailed(btn) {
        btn.classList.remove('yts-copy-success');
        btn.classList.add('yts-copy-failed');
        setTimeout(() => {
            btn.classList.remove('yts-copy-failed');
        }, 1500);
    }

    /**
     * Создать иконку-кнопку для копирования
     *
     * @param {object} args аргументы
     * @param {string} args.title Текст подсказки
     * @param {string} args.icon Emoji/иконка кнопки
     * @param {function} args.onClick Обработчик клика
     * @return {HTMLElement} DOM-элемент кнопки
     */
    function createButtonIcon({title = '', icon = '', onClick}) {
        const btn = document.createElement('button');
        btn.type = "button";
        btn.className = 'yts-copy-btn yt-spec-button-shape-next--mono yt-spec-button-shape-next--tonal';
        btn.title = title;
        btn.innerText = icon;
        btn.addEventListener('click', onClick);
        return btn;
    }

    /**
     * Показывает ошибку
     *
     * @param {string} errorMessage Сообщение ошибки
     */
    function showError(errorMessage) {
        if (ytsErrorAlreadyShown) return;
        ytsErrorAlreadyShown = true;

        log('Show error', errorMessage);
        const container = document.getElementById(RESULT_CONTAINER_ID);
        if (!container) return;
        clearContainer(container);

        let titleRow = document.createElement('div');
        titleRow.className = 'yts-title-row';

        const title = document.createElement('div');
        title.className = 'result-title';
        title.textContent = 'Ошибка:';
        titleRow.appendChild(title);

        container.appendChild(titleRow);

        const error = document.createElement('div');
        error.className = 'result-error';
        error.textContent = errorMessage;

        container.appendChild(error);
    }

    /**
     * Универсальная кнопка
     *
     * @param {object} args id, text, onClick, onContextMenu
     * @return {HTMLElement} DOM-элемент
     */
    function createButton({id = '', text = '', onClick, onContextMenu}) {
        const btn = document.createElement('button');
        if (id) btn.id = id;
        btn.textContent = text;
        if (onClick) btn.addEventListener('click', onClick);
        if (onContextMenu) btn.addEventListener('contextmenu', onContextMenu);
        btn.type = "button";
        return btn;
    }

    /**
     * Вставка стилей
     */
    function injectStyles() {
        if (q('#yts-style')) return;
        GM_addStyle(`
            #${BTN_ID}{
                border:none;margin-left:8px;
                padding:0 16px;border-radius:18px;font-size:14px;font-family:Roboto,Noto,sans-serif;font-weight:500;
                text-decoration:none;display:inline-flex;align-items:center;
                height:36px;line-height:normal;cursor:pointer
            }
            #${RESULT_CONTAINER_ID}{
                border-radius:12px;padding:15px 15px 35px 15px;font-family:Roboto,Arial,sans-serif;
                box-sizing:border-box;background:var(--yt-spec-badge-chip-background,#222);
            }
            .yts-title-row{
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 8px;
                width: 100%;
            }
            .result-title{font-size:18px;font-weight:600;}
            .yts-copy-btn-group{
                display: flex;
                gap: 4px;
                align-items: center;
                margin-left: auto;
            }
            .yts-copy-btn{
                border:none;
                border-radius:50%;
                cursor:pointer;
                padding:5px 8px;
                font-size:17px;
                width:32px;
                height:32px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                transition: background 0.23s, color 0.2s;
                outline: none;
                position: relative;
            }
            .yts-copy-btn.yts-copy-success{
                background-color: #43ff004f !important;
            }
            .yts-copy-btn.yts-copy-failed{
                background-color: #ff00005e !important;
            }

            #${RESULT_CONTAINER_ID} .result-content{font-size:14px;line-height:1.4;white-space:pre-wrap;overflow-y:auto;max-height:320px;overscroll-behavior:contain;}
            #${RESULT_CONTAINER_ID} .result-error{color:#ff2929;font-weight:bold;margin-top:8px;font-size:14px;}
            #${RESULT_CONTAINER_ID}.yts-can-min { position: relative; }
            #${RESULT_CONTAINER_ID} .yts-text-btn {
                background: none;
                color: #3ea6ff;
                border: none;
                cursor: pointer;
                font-size: 15px;
                font-weight: 500;
                padding: 2px 10px;
                border-radius: 18px;
                outline: none;
                line-height: 1;
                margin: 0;
                user-select: none;
                display: inline-block;
                transition: background .13s;
            }
            #${RESULT_CONTAINER_ID}.yts-minimized {
                min-height: 0 !important;
                max-height: 80px;
                overflow: hidden;
                transition: max-height .18s;
            }
            #${RESULT_CONTAINER_ID}.yts-minimized .yts-title-row,
            #${RESULT_CONTAINER_ID}.yts-minimized .yts-copy-btn-group {
                display: flex !important;
            }
            #${RESULT_CONTAINER_ID}.yts-minimized .yts-title-row .result-title::after {
                content: " (свёрнуто)";
                color: #b9b9aa;
                font-size: 12px;
                margin-left: 4px;
                font-weight: 500;
                opacity: 0.8;
            }
            #${RESULT_CONTAINER_ID}:not(.yts-minimized) .yts-title-row .result-title::after {
                content: "";
            }

            #${MODAL_ID}{
                display:none;position:fixed;z-index:999999;left:0;top:0;width:100vw;height:100vh;background:rgba(0,0,0,0.7)
            }
            #${MODAL_ID} .modal-inner{
                background:#2b2b2b;color:#f1f1f1;border-radius:12px;box-shadow:0 4px 38px 0 rgba(0,0,0,0.26);
                position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:950px;width:97vw;
                padding:32px 24px 22px 24px;box-sizing:border-box;
            }
            #${MODAL_ID} .modal-title{font-size:23px;font-weight:600;margin-bottom:6px;color:#f1f1f1;letter-spacing:.01em;text-align:center;user-select:none;}
            #${MODAL_ID} form{display:flex;flex-direction:column;align-items:stretch;width:100%;}
            #${MODAL_ID} .prompt-list-block{margin-bottom:5px;max-height:255px;overflow-y:auto;padding-right:5px;}
            #${MODAL_ID} .prompt-row{display:flex;align-items:center;gap:5px;margin-bottom:5px;}
            #${MODAL_ID} .prompt-input-title{width:140px;margin-bottom: auto !important;}
            #${MODAL_ID} .prompt-input-prompt{flex:1 1 0%;resize:vertical;min-height:60px;max-height:160px;}
            #${MODAL_ID} .prompt-btn{border:none;background:#444;color:#fff;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:13px;min-width:24px;justify-content:center;}
            #${MODAL_ID} .prompt-btn:disabled{opacity:0.6;cursor:default;}
            #${MODAL_ID} .prompt-btn.add{background:#3077bb;display:flex;margin-left:auto;}
            #${MODAL_ID} .prompt-btn.add:hover{background:#1d5993;}
            #${MODAL_ID} .prompt-btn.remove{background:#d33535;}
            #${MODAL_ID} .prompt-btn.remove:hover{background:#9f1919;}
            #${MODAL_ID} .prompt-btn.remove:disabled{background:#3e3e3e;}
            #${MODAL_ID} label{margin-bottom:4px;font-weight:600;color:#cdcdcd;text-align:left;font-size:14px;display:block;}
            #${MODAL_ID} input[type="text"],#${MODAL_ID} input[type="number"],#${MODAL_ID} input[type="password"]{
                font-size:13px;margin-bottom:10px;padding:7px 9px 7px 9px;border-radius:4px;border:1px solid #4a4d4d;background:#252525;color:#f1f1f1;box-sizing:border-box;
            }
            #${MODAL_ID} textarea{font-size:13px;padding:7px;border-radius:4px;border:1px solid #4a4d4d;background:#252525;color:#f1f1f1;box-sizing:border-box;overscroll-behavior: contain;}
            #${MODAL_ID} textarea::-webkit-resizer {border:none;background:none;}
            #${MODAL_ID} .modal-actions{display:flex;justify-content:space-between;gap:13px;margin-top:10px;width:100%;}
            #${MODAL_ID} .modal-btn{padding:7px 21px;background:#4a4d4d;color:#f1f1f1;border:none;border-radius:5px;font-size:13px;font-weight:500;cursor:pointer;transition:background .18s;flex:1 1 0%;max-width:150px;user-select:none;}
            #${MODAL_ID} .modal-btn:hover{background:#393b3b;}
            #${MODAL_ID} .modal-btn.reset{background:#d33535;color:#fff;}
            #${MODAL_ID} .modal-btn.reset:hover{background:#9f1919;}
            #${MODAL_ID} .modal-close{position:absolute;top:15px;right:20px;font-size:40px;font-weight:bold;color:#636363;cursor:pointer;background:none;border:none;line-height:1;transition:color .16s;user-select:none;}
            #${MODAL_ID} .modal-close:hover{color:#b1b1b1;}
            #${MODAL_ID} input:focus,#${MODAL_ID} textarea:focus{outline:none!important;border-color:#4a4d4d!important;}
            #${CONTEXT_MENU_ID}{
                position:fixed;z-index:999999;background:#373737;border-radius:5px;box-shadow:0 2px 18px 0 rgba(0,0,0,0.25);
                padding:1px;display:none;min-width:140px;color:#f1f1f1;font-family:Roboto,Arial,sans-serif;font-size:14px;user-select:none}
            #${CONTEXT_MENU_ID} .menu-item{padding:9px 20px 9px 14px;cursor:pointer;background:none;border-radius:3px;display:flex;align-items:center;}
            #${CONTEXT_MENU_ID} .menu-item:hover{background:#ffffff1a;}
            #${CONTEXT_MENU_ID} .menu-item.active{background:#2151ad;color:#fff;}
            #${CONTEXT_MENU_ID} .menu-item.active:hover{background:#295cbf}
            #${CONTEXT_MENU_ID} .menu-item .mark{margin-left:0;min-width: 25px;text-align:center;}
            #${CONTEXT_MENU_ID} .menu-separator{height:1px;background:#42484c;width:95%;margin:4px auto;}
        `);
        log('Styles injected');
    }

    /**
     * Ожидание появления элемента
     *
     * @param {string} selector Селектор
     * @return {Promise<HTMLElement>} Промис c найденным элементом
     */
    function waitForElement(selector) {
        log('waitForElement', selector);
        const el = q(selector);
        if (el) return Promise.resolve(el);
        return new Promise(resolve => {
            const observer = new MutationObserver(() => {
                const found = q(selector);
                if (found) {
                    observer.disconnect();
                    log('Found element', selector);
                    resolve(found);
                }
            });
            observer.observe(document.body, {childList: true, subtree: true});
        });
    }

    /**
     * Преобразует число секунд в строку времени мм:сс.мс или чч:мм:сс.мс, если showHours=true
     *
     * @param {number|string} seconds Количество секунд
     * @param {boolean} showHours Показывать ли часы в выводимой строке
     * @return {string} Время в формате мм:сс.мс или чч:мм:сс.мс
     */
    function secondsToTimeString(seconds, showHours) {
        /**
         * Преобразует число секунд в строку времени
         *
         * @param seconds Количество секунд
         * @param showHours Показывать ли часы
         * @return Строка времени
         */
        seconds = parseFloat(seconds);
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
        const main = [
            m.toString().padStart(2, '0'),
            s.toString().padStart(2, '0')
        ].join(':') + '.' + ms.toString().padStart(3, '0');
        return showHours
            ? h.toString().padStart(2, '0') + ":" + main
            : main;
    }

    /**
     * Парсинг и одновременное извлечение субтитров из XML в двух форматах: полный с таймкодами и просто текст
     *
     * @param xmlString XML-субтитры
     * @return {subtitlesFull: string, subtitlesText: string} Субтитры с таймкодами и только текст
     */
    function extractTextFromSubtitleXml(xmlString) {
        log('Extract subtitles');
        const textMatches = xmlString.match(/<text[^>]*>(.*?)<\/text>/g);
        if (!textMatches) {
            return {
                subtitlesFull: "",
                subtitlesText: ""
            };
        }

        // subtitlesText: только текст
        const subtitlesText = textMatches.map(match => {
            const content = match.replace(/<text[^>]*>/, "").replace(/<\/text>/, "");
            return decodeHtmlEntities(content);
        }).join(" ").trim();

        // Для subtitlesFull: определяем, отображать ли часы
        let maxStart = 0;
        const startRegex = /start="([\d.]+)"/g;
        let startMatch;
        while ((startMatch = startRegex.exec(xmlString)) !== null) {
            const start = parseFloat(startMatch[1]);
            if (start > maxStart) maxStart = start;
        }
        const showHours = maxStart >= 3600;

        let subtitlesFull = "[start - dur] text\n";
        const regex = /<text[^>]*start="([\d.]+)"[^>]*dur="([\d.]+)"[^>]*>(.*?)<\/text>/;
        textMatches.forEach(match => {
            const item = regex.exec(match.replace(/\n/g, ''));
            if (item) {
                const start = parseFloat(item[1]);
                const dur = item[2];
                const text = decodeHtmlEntities(item[3]);
                subtitlesFull += `[${secondsToTimeString(start, showHours)} - ${dur}] ${text}\n`;
            }
        });

        return {
            subtitlesFull: subtitlesFull.trim(),
            subtitlesText: subtitlesText
        };
    }

    /**
     * Декодировать html-сущности
     *
     * @param {string} text Строка
     * @return {string} Декодированный текст
     */
    function decodeHtmlEntities(text) {
        const entities = {
            '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
            '&#x2F;': '/', '&#x60;': '`', '&#x3D;': '='
        };
        return text.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&#x2F;|&#x60;|&#x3D;/g, m => entities[m] || m);
    }

    let lastSubtitlesForCopy = "";
    let lastSummaryForCopy = "";

    /**
     * Извлечение JS-объекта из inline <script> на странице по выражению присваивания

     * @param {string} varName Название переменной (например, "ytInitialPlayerResponse")
     * @param {string[]} path Путь к вложенному объекту (например, ["captions", "playerCaptionsTracklistRenderer", "captionTracks"])
     * @return {any|null} Найденный объект или null
     */
    function extractObjectFromScripts(varName, path = []) {
        // 1. Попробуем window[varName]
        let obj = window[varName];
        if (obj && path.length) obj = path.reduce((o, k) => (o ? o[k] : undefined), obj);
        if (obj !== undefined && obj !== null) return obj;

        // 2. Парсим <script> в поисках varName = {...};
        const scripts = Array.from(document.scripts);
        for (const script of scripts) {
            const text = script.textContent;
            // match JS объект по varName или window.varName
            const re = new RegExp(`${varName}\\s*=\\s*({[\\s\\S]+?});`);
            const match = text.match(re);
            if (match) {
                try {
                    const data = JSON.parse(match[1]);
                    const value = path.length ? path.reduce((o, k) => (o ? o[k] : undefined), data) : data;
                    if (value !== undefined && value !== null) return value;
                } catch (e) {/*ignore*/}
            }
        }
        return null;
    }

    /**
     * Получить данные видео/субтитров через парсинг HTML страницы (без window.ytInitialPlayerResponse)
     *
     * @return {Promise<object>} Объект с данными видео, субтитров и дополнительной информацией
     */
    async function getVideoFullData() {
        log('getVideoFullData');

        const NOT_DEFINED = 'не определено';
        const playerResponse = extractObjectFromScripts('ytInitialPlayerResponse');
        if (!playerResponse) log('Данные о видео не найдены (ytInitialPlayerResponse == null)');

        const videoId = playerResponse.videoDetails?.videoId
            || (new URLSearchParams(location.search)).get('v')
            || q('meta[itemprop="identifier"]')?.getAttribute('content')?.trim()
            || NOT_DEFINED;

        const videoUrl = videoId !== NOT_DEFINED ? `https://www.youtube.com/watch?v=${videoId}` : NOT_DEFINED;

        const title = playerResponse.videoDetails?.title
            || playerResponse.microformat?.playerMicroformatRenderer?.title?.simpleText
            || q('meta[name="title"]')?.getAttribute('content')?.trim()
            || NOT_DEFINED;

        const shortDescription =
            q('meta[name="description"]')?.getAttribute('content')?.trim()
            || NOT_DEFINED;

        const keywords =
            q('meta[name="keywords"]')?.getAttribute('content')?.trim()
            || NOT_DEFINED;

        const channelName = (() => {
            const primary =
                playerResponse?.videoDetails?.author
                || playerResponse?.microformat?.playerMicroformatRenderer?.ownerChannelName;
            if (primary) return primary;

            const span_author = q('span[itemprop="author"]');
            return span_author
                ? q('link[itemprop="name"]', span_author)?.getAttribute('content')?.trim() || NOT_DEFINED
                : NOT_DEFINED;
        })();

        const publishDate = playerResponse.microformat?.playerMicroformatRenderer?.publishDate
            || playerResponse.microformat?.playerMicroformatRenderer?.uploadDate
            || q('meta[itemprop="datePublished"]')?.getAttribute('content')?.trim()
            || NOT_DEFINED;

        const lengthSeconds = (() => {
            const primary = playerResponse?.videoDetails?.lengthSeconds;
            if (primary) return primary;

            const dur = q('meta[itemprop="duration"]')?.getAttribute('content');
            if (!dur) return NOT_DEFINED;

            const m = dur.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
            if (!m) return NOT_DEFINED;

            const min = m[1] ? parseInt(m[1]) : 0;
            const sec = m[2] ? parseInt(m[2]) : 0;
            return (min * 60 + sec).toString();
        })();

        const category = playerResponse.microformat?.playerMicroformatRenderer?.category
            || q('meta[itemprop="genre"]')?.getAttribute('content')?.trim()
            || NOT_DEFINED;

        const thumbnailUrl = (() => {
            const thumbnails = playerResponse?.videoDetails?.thumbnail?.thumbnails
                || playerResponse?.microformat?.playerMicroformatRenderer?.thumbnail?.thumbnails
                || [];
            if (Array.isArray(thumbnails) && thumbnails.length > 0) {
                return thumbnails[thumbnails.length - 1].url;
            }
            return q('meta[property="og:image"]')?.getAttribute('content')?.trim()
                || NOT_DEFINED;
        })();

        const captionTracks = (() => {
            const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
            if (Array.isArray(tracks) && tracks.length > 0) {
                return tracks;
            }
            const match = document.match(/"captionTracks":\s*\[(.*?)\](?:,|\})/s);
            if (!match) throw new Error('Субтитры не найдены для этого видео');
            try {
                return JSON.parse(`[${match[1]}]`);
            } catch (e) {
                throw new Error('Ошибка обработки данных субтитров');
            }
        })();

        const langPref = ['ru', 'en'];
        let captionTrack = langPref.map(lc => captionTracks.find(t => t.languageCode === lc))
            .find(Boolean) || captionTracks[0];

        if (!captionTrack?.baseUrl)
            throw new Error('Не удалось найти ссылку на субтитры');
        const subtitleUrl = captionTrack.baseUrl;

        const subtitleXml = await (await fetch(subtitleUrl)).text();
        const { subtitlesText, subtitlesFull } = extractTextFromSubtitleXml(subtitleXml);
        if (!subtitlesText)
            throw new Error('Не удалось извлечь текст из субтитров');

        let videoData = {
            channelName,
            videoId,
            videoUrl,
            title,
            shortDescription,
            keywords,
            publishDate,
            lengthSeconds,
            category,
            thumbnailUrl,
            subtitleUrl,
            subtitlesText,
            subtitlesFull
        };

        log('Video data', videoData);
        return videoData;
    }

    /**
     * Создание или обновление контейнера результата
     *
     * @param {boolean} loading Флаг процесса (идёт генерация)
     * @return {Promise<void>} Промис
     */
    async function createOrUpdateResultContainer(loading = true) {
        log('createOrUpdateResultContainer', loading);
        const middleRowDiv = await waitForElement('#middle-row');
        if (!middleRowDiv) return;
        let container = document.getElementById(RESULT_CONTAINER_ID);
        if (!container) {
            container = document.createElement('div');
            container.id = RESULT_CONTAINER_ID;
            // container.className = 'bold yt-formatted-string';
            middleRowDiv.insertBefore(container, middleRowDiv.firstChild);
        }
        clearContainer(container);

        let titleRow = document.createElement('div');
        titleRow.className = 'yts-title-row';

        const title = document.createElement('div');
        title.className = 'result-title';
        title.textContent = loading ? 'Выполняется...' : 'Готово';
        titleRow.appendChild(title);
        container.appendChild(titleRow);

        const content = document.createElement('div');
        content.className = 'result-content';
        content.id = 'yts-streaming-content';

        container.appendChild(content);
    }

    /**
     * Контекстное меню: создание/отображение
     */
    function createContextMenu() {
        let menu = document.getElementById(CONTEXT_MENU_ID);
        if (menu) menu.remove();
        const settings = loadSettings();

        menu = document.createElement('div');
        menu.id = CONTEXT_MENU_ID;

        settings.prompts.forEach(p => {
            const item = document.createElement('div');
            item.className = "menu-item";
            if (p.id === settings.activePromptId) item.classList.add('active');

            const mark = document.createElement('span');
            mark.className = 'mark';
            if (p.id === settings.activePromptId) {
                mark.textContent = '➤';
                mark.style.color = '#ffd700';
            } else {
                mark.textContent = ' ';
                mark.style.color = 'transparent';
            }

            item.appendChild(mark);

            const labelNode = document.createElement('span');
            labelNode.textContent = p.title || '(без названия)';
            item.appendChild(labelNode);

            item.addEventListener('click', () => {
                setActivePrompt(p.id);
                hideContextMenu();
            });
            menu.appendChild(item);
        });

        const separator = document.createElement('div');
        separator.className = 'menu-separator';
        menu.appendChild(separator);

        const settingsItem = document.createElement('div');
        settingsItem.className = "menu-item";
        const mark = document.createElement('span');
        mark.className = 'mark';
        mark.textContent = '🛠️️';
        settingsItem.appendChild(mark);

        const settingsLabel = document.createElement('span');
        settingsLabel.textContent = 'Настройки';
        settingsItem.appendChild(settingsLabel);

        settingsItem.addEventListener('click', () => {
            hideContextMenu();
            showSettingsModal();
        });
        menu.appendChild(settingsItem);

        document.body.appendChild(menu);

        ['mousedown', 'scroll'].forEach(ev =>
            document.addEventListener(ev, hideContextMenu, {capture: true})
        );
        window.addEventListener('blur', hideContextMenu);
        log('Context menu created');
    }

    /**
     * Показать контекстное меню
     *
     * @param {number} x X-координата
     * @param {number} y Y-координата
     */
    function showContextMenu(x, y) {
        let menu = document.getElementById(CONTEXT_MENU_ID) || (createContextMenu(), document.getElementById(CONTEXT_MENU_ID));
        menu.style.left = `${Math.round(x)}px`;
        menu.style.top = `${Math.round(y)}px`;
        menu.style.display = 'block';
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 5}px`;
        if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 5}px`;
        log('Show context menu', {x, y});
    }

    /**
     * Скрыть контекстное меню
     *
     * @param {Event} e Событие
     */
    function hideContextMenu(e) {
        let menu = document.getElementById(CONTEXT_MENU_ID);
        if (!menu || menu.style.display === 'none') return;
        if (e && menu.contains(e.target)) return;
        menu.style.display = 'none';
    }

    /**
     * Обновить UI после смены промпта
     */
    function updateUIAfterPromptChange() {
        updateButtonTitle();
        createContextMenu();
    }

    /**
     * Получить и обновить название кнопки
     */
    function updateButtonTitle() {
        const btn = q(`#${BTN_ID}`);
        const active = getActivePrompt();
        if (btn && active) btn.textContent = active.title || 'Генерировать';
    }

    /**
     * Модалка настроек
     */
    function showSettingsModal() {
        let modal = document.getElementById(MODAL_ID);
        if (!modal) {
            modal = document.createElement('div');
            modal.id = MODAL_ID;

            const modalInner = document.createElement('div');
            modalInner.className = 'modal-inner';

            const closeBtn = createButton({
                text: '×', onClick: () => {
                    modal.style.display = 'none';
                }
            });
            closeBtn.className = 'modal-close';
            closeBtn.title = 'Закрыть';

            const title = document.createElement('div');
            title.className = 'modal-title';
            title.textContent = 'Настройки';

            const form = document.createElement('form');
            // ========== Блок промптов ===========
            const promptBlock = document.createElement('div');
            promptBlock.className = 'prompt-list-block';
            promptBlock.id = 'prompt-list-block';
            // Сразу сгенерируем строки промптов, данные подаются отдельной функцией ниже!

            // == Остальные настройки (API, таймаут) ==
            const inputs = [];

            function formField(labelText, tag, id, options = {}) {
                const label = document.createElement('label');
                label.htmlFor = id;
                label.textContent = labelText;
                const input = document.createElement(tag);
                input.id = id;
                for (let k in options) input[k] = options[k];
                return {label, input};
            }

            // Формируем поля
            inputs.push(formField('API URL (LLM):', 'input', 'yts-setting-url', {type: 'text'}));
            inputs.push(formField('Bearer-токен (для API):', 'input', 'yts-setting-token', {
                type: 'password',
                autocomplete: 'off'
            }));
            inputs.push(formField('Таймаут ответа (мс):', 'input', 'yts-setting-timeout', {
                type: 'number',
                min: 10000,
                step: 1000
            }));
            inputs.push(formField('Модель:', 'input', 'yts-setting-model', {
                type: 'text',
                placeholder: 'gpt-4.1-nano'
            }));

            // == Кнопки ==
            const actions = document.createElement('div');
            actions.className = 'modal-actions';
            const btnReset = createButton({text: 'Сброс', onClick: () => setSettingsForm(DEFAULT_SETTINGS)});
            btnReset.className = 'modal-btn reset';
            const btnSave = createButton({text: 'Сохранить'});
            btnSave.className = 'modal-btn';
            btnSave.type = 'submit';

            actions.appendChild(btnReset);
            actions.appendChild(btnSave);

            // == Собираем форму ==
            form.appendChild(promptBlock);
            for (let ff of inputs) form.append(ff.label, ff.input);
            form.appendChild(actions);

            form.onsubmit = function (e) {
                e.preventDefault();
                // Собираем промпты
                const rows = promptBlock.querySelectorAll('.prompt-row');
                const prompts = [];
                for (let row of rows) {
                    const id = row.dataset.id || genPromptId();
                    const t = row.querySelector('.prompt-input-title').value.trim();
                    const p = row.querySelector('.prompt-input-prompt').value;
                    if (t && p) prompts.push({id, title: t, prompt: p});
                }
                let settings = loadSettings();
                // Если активного промпта нет либо его удалили/переименовали — делаем первым по списку
                let newActive = settings.activePromptId;
                if (!prompts.find(z => z.id === newActive)) newActive = prompts[0].id;
                saveSettings({
                    prompts,
                    activePromptId: newActive,
                    url: q('#yts-setting-url').value,
                    timeout: Math.max(10000, parseInt(q('#yts-setting-timeout').value, 10) || DEFAULT_SETTINGS.timeout),
                    model: q('#yts-setting-model').value || 'gpt-4.1-nano',
                    token: q('#yts-setting-token').value
                });
                modal.style.display = 'none';
                setTimeout(updateUIAfterPromptChange, 50); // немного задержаться для UI
            };

            modalInner.append(closeBtn, title, form);
            modal.appendChild(modalInner);
            document.body.appendChild(modal);
        }
        setSettingsForm(loadSettings());
        modal.style.display = 'block';
        q(`#${MODAL_ID} .prompt-input-title`)?.focus();
        log('Show settings modal');
    }

    /**
     * Обновление состояния кнопок удаления промптов
     *
     * @param {HTMLElement} container Контейнер с промпт-строками
     */
    function updatePromptDeleteButtons(container) {
        if (!container) return;
        const rows = container.querySelectorAll('.prompt-row');
        if (rows.length === 1) {
            const btn = rows[0].querySelector('.prompt-btn.remove');
            if (btn) btn.disabled = true;
        } else {
            rows.forEach(row => {
                const btn = row.querySelector('.prompt-btn.remove');
                if (btn) btn.disabled = false;
            });
        }
    }

    /**
     * Заполнение формы настроек
     *
     * @param {object} args Настройки
     */
    function setSettingsForm({prompts, timeout, url, token, model}) {
        // Промпты
        const promps = Array.isArray(prompts) && prompts.length
            ? prompts
            : [...DEFAULT_PROMPTS];
        const block = q(`#${MODAL_ID} #prompt-list-block`);
        // Очищаем содержимое блока
        while (block.firstChild) block.removeChild(block.firstChild);
        // Добавляем строки промптов
        promps.forEach((pr, idx) => block.appendChild(makePromptRow(pr, idx, promps.length)));
        // Кнопка "+"
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'prompt-btn add';
        addBtn.textContent = '+';
        addBtn.onclick = function () {
            block.insertBefore(
                makePromptRow({
                    id: genPromptId(),
                    title: '',
                    prompt: ''
                }, block.childElementCount, block.childElementCount),
                addBtn
            );
            // обновляем состояние кнопок
            updatePromptDeleteButtons(block);
        };
        block.appendChild(addBtn);

        // После вставки строк обновить кнопки удаления по числу строк
        updatePromptDeleteButtons(block);

        // Остальные поля
        q(`#yts-setting-timeout`).value = timeout || DEFAULT_SETTINGS.timeout;
        q(`#yts-setting-url`).value = url || DEFAULT_SETTINGS.url;
        q(`#yts-setting-token`).value = token || DEFAULT_SETTINGS.token;
        q(`#yts-setting-model`).value = model || DEFAULT_SETTINGS.model;
    }

    /**
     * Генерация строки для промпта
     *
     * @param {object} pr Промпт-объект
     * @param {number} idx Индекс
     * @param {number} total Количество промптов всего
     * @return {HTMLElement} Элемент строки промпта
     */
    function makePromptRow(pr, idx, total) {
        const row = document.createElement('div');
        row.className = 'prompt-row';
        row.dataset.id = pr.id;

        const inputTitle = document.createElement('input');
        inputTitle.type = "text";
        inputTitle.placeholder = "Название действия";
        inputTitle.value = pr.title || '';
        inputTitle.className = 'prompt-input-title';

        const inputPrompt = document.createElement('textarea');
        inputPrompt.className = 'prompt-input-prompt';
        inputPrompt.placeholder = "Текст промпта";
        inputPrompt.rows = 2;
        inputPrompt.value = pr.prompt;

        row.appendChild(inputTitle);
        row.appendChild(inputPrompt);

        // Кнопка удалить
        const btnDel = document.createElement('button');
        btnDel.type = 'button';
        btnDel.className = 'prompt-btn remove';
        btnDel.textContent = '-';
        // Отключить если последний промпт
        btnDel.disabled = total <= 1;
        btnDel.onclick = function () {
            if (btnDel.disabled) return;
            row.remove();
            // обновляем состояние кнопок удаления для актуального блока
            const block = q(`#${MODAL_ID} #prompt-list-block`);
            if (block) updatePromptDeleteButtons(block);
        };
        row.appendChild(btnDel);

        return row;
    }

    /**
     * Стример обновления результата
     *
     * @param {string} deltaText Новый кусочек
     * @param {boolean} isComplete Флаг завершения
     */
    function updateResultContentStream(deltaText, isComplete) {
        const c = document.getElementById(RESULT_CONTAINER_ID);
        if (!c) return;
        let contentDiv = q('#yts-streaming-content', c);
        if (!contentDiv) {
            contentDiv = document.createElement('div');
            contentDiv.className = 'result-content';
            contentDiv.id = 'yts-streaming-content';
            c.appendChild(contentDiv);
        }
        if (!ytsPrintIsComplete && ytsPrintBuffer.length === 0 && !contentDiv.textContent) contentDiv.textContent = '';
        if (deltaText && typeof deltaText === 'string' && deltaText.length > 0) ytsPrintBuffer.push(deltaText);
        if (isComplete) ytsPrintIsComplete = true;
        if (ytsPrintTimer) return;
        ytsPrintTimer = setInterval(() => {
            if (ytsPrintBuffer.length) {
                const piece = ytsPrintBuffer.shift();
                contentDiv.textContent += piece;
                contentDiv.scrollTop = contentDiv.scrollHeight;
            } else if (ytsPrintIsComplete) {
                c.querySelector('.result-title').textContent = 'Готово';

                lastSummaryForCopy = contentDiv.textContent;
                appendCopyButtons(c, lastSummaryForCopy, lastSubtitlesForCopy);

                clearInterval(ytsPrintTimer);
                ytsPrintTimer = null;
                ytsPrintIsComplete = false;
                log('Streaming complete');
            }
        }, 5);
    }

    /**
     * Выполняет LLM streaming fetch с помощью fetch, без инъектора

     * @param {string} url URL эндпоинта
     * @param {object} opts Опции запроса (headers, body, method)
     * @param {function} onDelta Callback для каждой delta-строки (части)
     * @return {Promise<void>} Промис для завершения передачи
     */
    async function streamFetchLLM(url, opts, onDelta) {
        const resp = await fetch(url, opts);
        if (!resp.body) throw new Error('Нет поддержки стриминга у fetch');
        if (!resp.ok) {
            let errorMsg = `API error: HTTP status ${resp.status}`;
            try {
                const text = await resp.text();
                let info;
                try {
                    info = JSON.parse(text);
                } catch {
                }
                if (info?.error?.message) errorMsg = info.error.message;
                else if (typeof info?.detail === 'string') errorMsg = info.detail;
                else if (info?.detail?.error?.message) errorMsg = info.detail.error.message;
                else if (info?.detail) errorMsg = JSON.stringify(info.detail);
                else if (info) errorMsg = JSON.stringify(info);
                else if (text) errorMsg = text;
            } catch {
            }
            throw new Error(errorMsg);
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buf = '';
        while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            buf += decoder.decode(value, {stream: true});
            let lineEnd;
            while ((lineEnd = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, lineEnd).trim();
                buf = buf.slice(lineEnd + 1);
                if (!line) continue;
                if (line.startsWith('data: ')) {
                    const j = line.slice(6);
                    if (j === '[DONE]') continue;
                    let content = '';
                    try {
                        let d = JSON.parse(j);
                        if (d?.error?.message) throw new Error(d.error.message);
                        if (d?.detail) throw new Error(typeof d.detail === 'string' ? d.detail : JSON.stringify(d.detail));
                        content = d.choices?.[0]?.delta?.content || '';
                    } catch (err) {
                        throw new Error(
                            err.message || "Ошибка парсинга потока LLM: " + j
                        );
                    }
                    if (content) await onDelta(content, false);
                }
            }
        }
        await onDelta('', true);
    }

    /**
     * Отправка запроса в LLM API, потоковой обработкой delta'ов

     * @param {object} videoData Видео-данные
     * @return {Promise<any>} Промис результата
     */
    function sendToAPI(videoData) {
        return new Promise(async (resolve, reject) => {
            const settings = loadSettings();
            const promptObj = settings.prompts.find(p => p.id === settings.activePromptId) || settings.prompts[0];
            const prompt = (promptObj?.prompt || '') + videoData.subtitlesText;
            const requestData = {
                model: settings.model || "gpt-4.1-nano",
                messages: [{role: "user", content: prompt}],
                stream: true
            };
            const TIMEOUT = settings.timeout || 180000;
            log('sendToAPI', {TIMEOUT, model: settings.model, url: settings.url, promptTitle: promptObj.title});
            let timeoutId = setTimeout(() => {
                showError('Превышено время ожидания ответа от API (' + Math.floor(TIMEOUT / 1000) + ' секунд)');
                reject(new Error('Timeout'));
            }, TIMEOUT);

            let resolved = false;
            try {
                await streamFetchLLM(
                    settings.url || DEFAULT_SETTINGS.url,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": "Bearer " + (settings.token || ''),
                            "Accept": "text/event-stream"
                        },
                        body: JSON.stringify(requestData)
                    },
                    (chunk, isComplete) => {
                        updateResultContentStream(chunk, !!isComplete);
                        if (isComplete && !resolved) {
                            resolved = true;
                            clearTimeout(timeoutId);
                            resolve();
                        }
                    }
                );
            } catch (err) {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeoutId);
                    showError(err.message || "Ошибка генерации ответа от LLM");
                    reject(err);
                }
            }
        });
    }

    /**
     * Основная функция: выполнение действия текущего промпта
     *
     * @return {Promise<void>} Промис
     */
    async function performPromptedAction() {
        restoreResultContainer();
        ytsErrorAlreadyShown = false;
        await createOrUpdateResultContainer(true);
        log('Action started');
        try {
            const videoData = await getVideoFullData();
            if (!videoData.subtitlesText || videoData.subtitlesText.length < 10)
                return showError('Не удалось получить достаточно субтитров для этого видео');
            lastSubtitlesForCopy = videoData.subtitlesText;
            await sendToAPI(videoData);
        } catch (error) {
            showError(error.message || 'Ошибка при обработке запроса');
        }
    }

    /**
     * Добавить кнопку действия на страницу
     */
    function addButton() {
        waitForElement(BTN_TARGET).then((buttonContainer) => {
            if (!buttonContainer) return;
            if (!q(`#${BTN_ID}`)) {
                const summaryButton = createButton({
                    id: BTN_ID,
                    text: getActivePrompt().title || 'Генерировать',
                    onClick: performPromptedAction,
                    onContextMenu: function (evt) {
                        evt.preventDefault();
                        showContextMenu(evt.clientX, evt.clientY);
                    }
                });
                summaryButton.className = 'yt-spec-button-shape-next--mono yt-spec-button-shape-next--tonal'
                buttonContainer.appendChild(summaryButton);
                log('Button added');
            }
            updateButtonTitle();
        });
        createContextMenu();
    }

    /**
     * Удалить UI (кнопка/контейнер)
     */
    function removeUI() {
        q(`#${BTN_ID}`)?.remove();
        q(`#${RESULT_CONTAINER_ID}`)?.remove();
        log('UI removed');
    }

    /**
     * Проверить необходимость UI (только для страницы видео)
     */
    function checkButton() {
        if (location.pathname === '/watch') {
            addButton();
            q(`#${RESULT_CONTAINER_ID}`)?.remove();
        } else removeUI();
    }

    // ==== INIT ====
    injectStyles();

    const navHandler = debounce(checkButton, 80);
    window.addEventListener("yt-navigate-finish", navHandler);
    window.addEventListener("spfdone", navHandler);
    checkButton();

    log('yts script started');

})();