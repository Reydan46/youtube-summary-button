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
// @version        0.8.8
// @homepageURL    https://github.com/Reydan46/youtube-summary-button
// @supportURL     https://github.com/Reydan46/youtube-summary-button/issues
// @updateURL      https://raw.githubusercontent.com/Reydan46/youtube-summary-button/main/yts.user.js
// @downloadURL    https://raw.githubusercontent.com/Reydan46/youtube-summary-button/main/yts.user.js
// @grant          GM_addStyle
// @grant          GM_setClipboard
// @grant          GM_info
// @grant          GM_setValue
// @grant          GM_getValue
// @match          https://*.youtube.com/*
// @connect        api.openai.com
// @connect        raw.githubusercontent.com
// @connect        youtube.com
// @connect        ytimg.com
// @run-at         document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    if (window.self !== window.top) return;

    // === Константы и идентификаторы ===
    const USE_GM_STORAGE = true;
    const MODULE_NAME = "YTS";
    const STORAGE_KEY = 'yts-settings';
    const TARGET_BUTTON_ELEMENT = "#owner";
    const TARGET_RESULT_ELEMENT = "#middle-row";
    const BTN_ID = "YTS_GenBtn";
    const RESULT_CONTAINER_ID = "YTS_ResultContainer";
    const MODAL_ID = 'YTS_SettingsModal';
    const CONTEXT_MENU_ID = 'YTS_ContextMenu';
    const PROMPT_PREVIEW_MODAL_ID = 'YTS_PromptPreviewModal';
    const PROMPT_DOC_MODAL_ID = 'YTS_PromptDocModal';
    const CUSTOM_PROMPT_MODAL_ID = 'YTS_CustomPromptModal';

    let ytsPrintBuffer = [];
    let ytsPrintTimer = null;
    let ytsPrintIsComplete = false;
    let ytsErrorAlreadyShown = false;
    let currentResult = "";
    let globalVideoData = {};

    // === Перечисление SVG-иконок ===
    const ICONS = {
        COPY: {
            elements: [
                {
                    type: 'rect',
                    attrs: {x: '9', y: '9', width: '13', height: '13', rx: '2'}
                },
                {
                    type: 'path',
                    attrs: {d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'}
                }
            ]
        },
        SUBTITLES: {
            elements: [
                {
                    type: 'text',
                    attrs: {
                        x: '2',
                        y: '16',
                        'font-size': '15',
                        'font-weight': '600',
                        'font-family': 'Arial',
                        fill: 'currentColor'
                    },
                    text: 'CC'
                }
            ]
        }
    };

    // === Стейт/настройки по-умолчанию ===
    const DEFAULT_PROMPTS = [
        {
            id: 'summary',
            title: "Краткий пересказ",
            prompt: `Ты — ассистент по анализу видеоконтента. Проанализируй предоставленные субтитры и составь краткий пересказ содержания видео.

Твоя задача — выделить основную суть каждого смыслового блока или раздела ролика, передавая главные идеи и события максимально лаконично. 
На каждый смысловой блок используй не более одного короткого предложения. Не копируй текст субтитров, а передавай информацию своими словами.
Избегай лишних деталей и второстепенных описаний. Соблюдай строго последовательность изложения, чтобы пересказ отражал структуру исходного материала.
Оформляй ответ сплошным текстом без списков, таймкодов или других выделений; новый смысловой блок начинай с новой строки.
Не добавляй никаких пояснений, выводов, вводных и дополнительной информации вне лаконичного пересказа.

Используй следующие субтитры:
{{subtitlesText}}`
        }, {
            id: 'article',
            title: "Статья-конспект",
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

Используй следующие субтитры:
{{subtitlesText}}`
        }, {
            id: 'moments',
            title: "Ключевые моменты",
            prompt: `Ты — ассистент по анализу видеоконтента. Действуй строго согласно инструкции:

1. Проанализируй предоставленные эпизоды и субтитры. Выдели только самые важные и интересные моменты видео: ключевые события, переходы, открытия, этапы, выводы, логические части и структурные блоки.
2. Для каждого выделенного момента указывай только оригинальный таймкод из начала строки субтитров, полностью и без изменений (например, [00:15:09] или [00:10.12]). Запрещается придумывать таймкоды, округлять или изменять их. Если нужно отразить событие чуть раньше, используй ближайший предыдущий из оригинальных субтитров.
3. Не используй собственные диапазоны, интервалы или любые другие форматы тайминга — применяй только строки с таймкодами из субтитров.
4. Описание каждого момента делай очень кратким, только суть, своими словами, не копируя текст субтитров. Не добавляй никаких пояснений, голосовых комментариев, вводных или заключений.
5. В описаниях избегай спойлеров — никаких раскрытий ключевых твистов, финалов, неожиданных развязок; ограничься намёками либо общим описанием без подробных деталей и исходов.
6. Форматируй ответ только в виде списка по одной строке на каждый момент:
[таймкод] — описание
[таймкод] — описание
[таймкод] — описание
и так далее. Никаких пустых строк между пунктами.
7. Эпизоды от автора могут не включать все важные моменты — добавляй любые значимые события из субтитров, даже если их нет среди эпизодов.
8. Исключи пустые строки в ответе.
9. В итоговом списке обязательно располагай все моменты строго по возрастанию времени таймкодов (от самого раннего к самому позднему).
10. В ответе разрешён только тот формат таймкодов, который встречается в начале строк оригинальных субтитров. Не добавляй часы ([hh:mm:ss]), если в субтитрах изначально был только формат [mm:ss] или [mm:ss.xx]. Не меняй формат таймкодов, а используй их ровно в том виде, как они указаны в субтитрах.

Эпизоды, предоставленные автором:
{{episodes}}

Используй следующие субтитры:
{{subtitlesFull}}`
        }, {
            id: 'faq',
            title: "Вопрос-ответ",
            prompt: `Ты — технический ассистент. 
Проанализируй субтитры технического видео и составь FAQ (вопрос-ответ) по основным темам ролика, используя только информацию из субтитров. 
Каждый вопрос и ответ должны быть краткими, по существу. 
Не добавляй ничего от себя и не выходи за рамки сказанного в ролике.
Формат вывода:

Q: [Краткий, чёткий вопрос по сути темы, выявленной из субтитров]
A: [Краткий, конкретный ответ, строго на основе информации из субтитров]

Q: [Вопрос]
A: [Ответ]

(Каждая пара "вопрос-ответ" всегда с новой строки. Без пояснений, предисловий и заключений.)

Используй следующие субтитры:
{{subtitlesText}}`
        },
    ];
    const DEFAULT_SETTINGS = {
        prompts: DEFAULT_PROMPTS,
        activePromptId: DEFAULT_PROMPTS[0].id,
        timeout: 180000,
        url: 'https://api.openai.com/v1/chat/completions',
        token: '',
        model: 'gpt-4.1-nano',
        customPromptText: '',
        customPromptPlaceholders: ['subtitlesText']
    };

    /**
     * Вставка стилей
     */
    function injectStyles() {
        if (q('#yts-style')) return;
        GM_addStyle(`
            #${BTN_ID} {
                border:none;
                margin-left:8px;
                padding:0 16px;
                border-radius:18px;
                font-size:14px;
                font-family:Roboto,Noto,sans-serif;
                font-weight:500;
                text-decoration:none;
                display:inline-flex;
                align-items:center;
                height:36px;
                line-height:normal;
                cursor:pointer
            }
            #${RESULT_CONTAINER_ID} {
                position:relative;
                border-radius:12px;
                padding:15px 15px 35px 15px;
                font-family:Roboto,Arial,sans-serif;
                box-sizing:border-box;
                background:var(--yt-spec-badge-chip-background,#222);
            }
            .yts-title-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 8px;
                width: 100%;
            }
            .result-title {
                font-size:18px;
                font-weight:600;
            }
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

            .yts-copy-btn svg {
                display: inline-block;
                vertical-align: middle;
                color: #717171;
                transition: color 0.2s;
            }

            .yts-copy-btn:hover svg {
                color: #ffffff;
            }

            .yts-copy-btn.yts-copy-success svg {
                color: #43ff71;
            }

            #${RESULT_CONTAINER_ID} .result-content {
                font-size:14px;
                line-height:1.4;
                white-space:pre-wrap;
                overflow-y:auto;
                max-height:320px;
                overscroll-behavior:contain;
                }
            #${RESULT_CONTAINER_ID} .result-error {
                color:#ff2929;
                font-weight:bold;
                margin-top:8px;
                font-size:14px;
            }
            #${RESULT_CONTAINER_ID}.yts-can-min {
                position: relative;
            }
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
            #${RESULT_CONTAINER_ID} .yts-min-btn,
            #${RESULT_CONTAINER_ID} .yts-more-btn {
                position: absolute;
                padding: 0;
                bottom: 12px;
                color: #898989;
                background: none;
                border: none;
                cursor: pointer;
                font-size: 14px;
                font-family: inherit;
                font-weight: 500;
                transition: background .12s;
            }

            #${MODAL_ID} {
                display:none;
                position:fixed;
                z-index:999999;
                left:0;
                top:0;
                width:100vw;
                height:100vh;
                background:rgba(0,0,0,0.7);
            }
            #${MODAL_ID} .modal-inner{
                background:#2b2b2b;
                color:#f1f1f1;
                border-radius:12px;
                box-shadow:0 4px 38px 0 rgba(0,0,0,0.26);
                position:absolute;
                left:50%;
                top:50%;
                transform:translate(-50%,-50%);
                max-width:80vw;
                width:97vw;
                padding:32px 24px 22px 24px;
                box-sizing:border-box;
            }
            #${MODAL_ID} .modal-title {
                font-size:23px;
                font-weight:600;
                margin-bottom:6px;
                color:#f1f1f1;
                letter-spacing:.01em;
                text-align:center;
                user-select:none;
            }
            #${MODAL_ID} form {
                display:flex;
                flex-direction:column;
                align-items:stretch;
                width:100%;
            }
            #${MODAL_ID} .prompt-list-block {
                margin-bottom:4px;
                max-height:549px;
                overflow-y:auto;
                padding-right:5px;
            }
            #${MODAL_ID} .prompt-list-header {
                display:flex;
                align-items:center;
                justify-content:space-between;
                padding-bottom:5px;
                position: sticky;
                top: 0px;
                background: #2b2b2b;
                z-index: 2;
                margin-right: -1px;
            }
            #${MODAL_ID} .prompt-list-header .prompt-list-header-btns {
                display:flex;
                gap:6px;
                padding-right:1px;
            }
            #${MODAL_ID} .prompt-list-header .prompt-list-header-title {
                font-weight: bold;
                align-content: end;
                height: 31px;
                flex: 1;
                font-size: 14px;
            }
            #${MODAL_ID} .prompt-block-row {
                margin-bottom:15px;
            }
            #${MODAL_ID} .prompt-row-1 {
                margin-bottom:5px;
            }
            #${MODAL_ID} .prompt-row {
                display:flex;
                align-items:center;
                gap:6px;
            }
            #${MODAL_ID} .prompt-input-title {
                width:140px;
                margin-bottom: auto !important;
                flex:1 1 0%;
            }
            #${MODAL_ID} .prompt-input-prompt {
                flex:1 1 0%;
                resize:vertical;
                min-height:60px;
                max-height:30vh;
            }
            #${MODAL_ID} .prompt-btn {
                border:none;
                background:#ffffff45;
                color:#fff;
                padding:0;
                border-radius:4px;
                cursor:pointer;
                font-size:13px;
                min-width:24px;
                justify-content:center;
                width: 22px;
                height: 31px;
                align-items: center;
            }
            #${MODAL_ID} .prompt-btn:hover {
                background: #ffffff26;}
            #${MODAL_ID} .prompt-btn:disabled {
                opacity:0.6;
                cursor:default;
            }
            #${MODAL_ID} .prompt-btn.add {
                background:#3077bb;
                display:flex;
            }
            #${MODAL_ID} .prompt-btn.add:hover {
                background:#1d5993;
            }
            #${MODAL_ID} .prompt-btn.remove {
                background:#d33535;
            }
            #${MODAL_ID} .prompt-btn.remove:hover {
                background:#9f1919;
            }
            #${MODAL_ID} .prompt-btn.remove:disabled {
                background:#3e3e3e;
            }
            #${MODAL_ID} .prompt-btn.check,
            #${MODAL_ID} .prompt-btn.about {
                color:#191d23;
                font-weight:bold;
            }
            #${MODAL_ID} .prompt-btn.check[disabled], 
            #${MODAL_ID} .prompt-btn.about[disabled] {
                opacity:0.2;
                color:#ccc;
                cursor:default;
            }
            #${MODAL_ID} label {
                margin-bottom:4px;
                font-weight:600;
                color:#cdcdcd;
                text-align:left;
                font-size:14px;
                display:block;
                align-content: center;
            }
            #${MODAL_ID} input[type="text"],
            #${MODAL_ID} input[type="number"],
            #${MODAL_ID} input[type="password"] {
                font-size:13px;
                padding:7px 9px 7px 9px;
                border-radius:4px;
                border:1px solid #4a4d4d;
                background:#252525;
                color:#f1f1f1;
                box-sizing:border-box;
            }
            #${MODAL_ID} textarea {
                font-size:13px;
                padding:7px;
                border-radius:4px;
                border:1px solid #4a4d4d;
                background:#252525;
                color:#f1f1f1;
                box-sizing:border-box;
            }
            #${MODAL_ID} textarea::-webkit-resizer {
                border:none;
                background:none;
            }
            #${MODAL_ID} .modal-actions {
                display:flex;
                justify-content:space-between;
                gap:13px;
                margin-top:10px;
                width:100%;
            }
            #${MODAL_ID} .modal-btn {
                padding:7px 21px;
                background:#4a4d4d;
                color:#f1f1f1;
                border:none;
                border-radius:5px;
                font-size:13px;
                font-weight:500;
                cursor:pointer;
                transition:background .18s;
                flex:1 1 0%;
                max-width:150px;
                user-select:none;
            }
            #${MODAL_ID} .modal-btn:hover {
                background:#393b3b;
                }
            #${MODAL_ID} .modal-btn.reset {
                background:#762c83;
                color:#fff;
            }
            #${MODAL_ID} .modal-btn.reset:hover {
                background:#56215f;
            }
            #${MODAL_ID} .modal-btn.export,
            #${MODAL_ID} .modal-btn.import{
                background:#354069;
            }
            #${MODAL_ID} .modal-btn.export:hover,
            #${MODAL_ID} .modal-btn.import:hover{
                background:#293049;
            }
            #${MODAL_ID} .modal-close {
                position:absolute;
                top:15px;
                right:20px;
                font-size:40px;
                font-weight:bold;
                color:#636363;
                cursor:pointer;
                background:none;
                border:none;
                line-height:1;
                transition:color .16s;
                user-select:none;
            }
            #${MODAL_ID} .modal-close:hover {
                color:#b1b1b1;
            }
            #${MODAL_ID} input:focus,
            #${MODAL_ID} textarea:focus {
                outline:none!important;
                border-color:#4a4d4d!important;
            }
            #${CONTEXT_MENU_ID} {
                position:fixed;
                z-index:999999;
                background:#373737;
                border-radius:5px;
                box-shadow:0 2px 18px 0 rgba(0,0,0,0.25);
                padding:1px;
                display:none;
                min-width:140px;
                color:#f1f1f1;
                font-family:Roboto,Arial,sans-serif;
                font-size:14px;
                user-select:none;
            }
            #${CONTEXT_MENU_ID} .menu-item {
                padding:9px 20px 9px 14px;
                cursor:pointer;
                background:none;
                border-radius:3px;
                display:flex;
                align-items:center;
            }
            #${CONTEXT_MENU_ID} .menu-item:hover {
                background:#ffffff1a;
            }
            #${CONTEXT_MENU_ID} .menu-item.active {
                background:#2151ad;
                color:#fff;
            }
            #${CONTEXT_MENU_ID} .menu-item.active:hover {
                background:#295cbf
            }
            .menu-item .mark {
                margin-left:0;
                min-width: 25px;
                text-align:center;
                color: transparent;
            }
            .menu-item.active .mark {
                color:#ffd700;
            }
            .menu-separator {
                height:1px;
                background:#42484c;
                width:95%;
                margin:4px auto;
            }
            .timestamp-link {
                color:#53a6ff;
                text-decoration:none;
                cursor:pointer;
                font-weight:550;
                margin-right:5px;
            }
            #${PROMPT_PREVIEW_MODAL_ID} {
                display:none;
                position:fixed;
                z-index:999999;
                left:0;
                top:0;
                width:100vw;
                height:100vh;
                background:rgba(0,0,0,0.7);
            }
            #${PROMPT_PREVIEW_MODAL_ID} .modal-inner {
                background:#2b2b2b;
                color:#f1f1f1;
                border-radius:12px;
                box-shadow:0 4px 38px 0 rgba(0,0,0,0.26);
                position:absolute;
                left:50%;
                top:50%;
                transform:translate(-50%,-50%);
                max-width:80vw;width:97vw;
                padding:32px 24px 22px 24px;
                box-sizing:border-box;
            }
            #${PROMPT_PREVIEW_MODAL_ID} .modal-title {
                font-size:23px;
                font-weight:600;
                margin-bottom:6px;
                color:#f1f1f1;
                letter-spacing:.01em;
                text-align:center;
                user-select:none;
            }
            #${PROMPT_PREVIEW_MODAL_ID} textarea {
                font-size:13px;
                padding:7px;
                border-radius:4px;
                border:1px solid #4a4d4d;
                background:#252525;
                color:#f1f1f1;
                box-sizing:border-box;
            }
            #${PROMPT_PREVIEW_MODAL_ID} textarea::-webkit-resizer {
                border:none;
                background:none;
            }
            #${PROMPT_PREVIEW_MODAL_ID} textarea:focus {
                outline:none!important;
                border-color:#4a4d4d!important;
            }
            #${PROMPT_PREVIEW_MODAL_ID} .modal-close {
                position:absolute;
                top:15px;
                right:20px;
                font-size:40px;
                font-weight:bold;
                color:#636363;
                cursor:pointer;
                background:none;
                border:none;
                line-height:1;
                transition:color .16s;
                ser-select:none;
            }
            #${PROMPT_PREVIEW_MODAL_ID} .modal-close:hover {
            color:#b1b1b1;
            }
            #${PROMPT_DOC_MODAL_ID}{
                display:none;
                position:fixed;
                z-index:999999;
                left:0;
                top:0;
                width:100vw;
                height:100vh;
                background:rgba(0,0,0,0.7);
            }
            #${PROMPT_DOC_MODAL_ID} b {
                font-size: 14px;
            }
            #${PROMPT_DOC_MODAL_ID} .modal-inner{
                background:#2b2b2b;
                color:#f1f1f1;
                border-radius:12px;
                box-shadow:0 4px 38px 0 rgba(0,0,0,0.26);
                position:absolute;
                left:50%;
                top:50%;
                transform:translate(-50%,-50%);
                max-width:80vw;
                width:97vw;
                padding:0px 15px 15px 20px;
                box-sizing:border-box;
            }
            #${PROMPT_DOC_MODAL_ID} .modal-doc-content {
                overflow-y: auto;
                padding-right: 10px;
                max-height: 90vh;
            }

            #${PROMPT_DOC_MODAL_ID} .modal-topbar {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 10px 5px 5px 5px;
                background: #2b2b2b;
                position: sticky;
                top: 0;
                z-index: 10;
                border-top-left-radius: 12px;
                border-top-right-radius: 12px;
            }

            #${PROMPT_DOC_MODAL_ID} .modal-title {
                font-size:23px;
                font-weight:600;
                color:#f1f1f1;
                letter-spacing:.01em;
                text-align:center;
                user-select:none;
                flex: 1;
            }
            #${PROMPT_DOC_MODAL_ID} .modal-close {
                position: static;
                margin-left: 16px;
                font-size:40px;
                font-weight:bold;
                color:#636363;
                cursor:pointer;
                background:none;
                border:none;
                line-height:1;
                transition:color .16s;
                user-select:none;
                z-index: 1;
            }
            #${PROMPT_DOC_MODAL_ID} .modal-close:hover{
                color:#b1b1b1;
            }
            #${PROMPT_DOC_MODAL_ID} code{
                padding: 2px 5px;
                border-radius: 3px;
                font-size: 13px;
            }
            #${PROMPT_DOC_MODAL_ID} pre{
                background: #191924;
                color: #c8e6c1;
                border-radius:5px;
                padding: 7px 12px;
                margin: 7px 0 10px 0;
                white-space: pre-wrap;
            }
            #${PROMPT_DOC_MODAL_ID} ul, 
            #${PROMPT_DOC_MODAL_ID} ol {
                margin-top: 4px;
                margin-bottom: 6px;
                padding-left: 20px;
            }
            #${PROMPT_DOC_MODAL_ID} hr{
                border: none;
                border-top: 1px solid #565656;
                margin: 18px auto 12px auto;
                width: 96%;
            }
            #${PROMPT_DOC_MODAL_ID} table {
                width: 100%;
                color: #edeed0;
                background: none;
                border: none;
            }
            #${PROMPT_DOC_MODAL_ID} .yts-doc-table {
                border-collapse: collapse;
                background: #202127;
                color: #e7e7ef;
                margin-bottom: 10px;
                margin-top: 8px;
                font-size: 14px;
                border-radius: 8px;
                box-shadow: 0 1px 7px 0 rgba(0,0,0,0.14);
                overflow: hidden;
            }
            #${PROMPT_DOC_MODAL_ID} .yts-doc-table.examples {
                margin-top: 5px;
                width: 100%;
            }
            #${PROMPT_DOC_MODAL_ID} .yts-doc-table th {
                background: #89898954;
                font-weight: 600;
                padding: 7px 10px;
                text-align: left;
                border-bottom: 1px solid #484848;
                font-size: 15px;
            }
            #${PROMPT_DOC_MODAL_ID} .yts-doc-table td, 
            #${PROMPT_DOC_MODAL_ID} .yts-doc-table th {
                padding: 6px 11px 6px 10px;
                border: none;
            }
            #${PROMPT_DOC_MODAL_ID} .yts-doc-table tr:nth-child(odd):not(:first-child) {
                background: #5252531c;
            }
            #${PROMPT_DOC_MODAL_ID} .yts-doc-table code {
                color: #76c5ff;
                padding: 2px 6px;
                border-radius: 3px;
                font-size: 13px;
            }
            #${PROMPT_DOC_MODAL_ID} .yts-doc-table.examples td code {
                color: #86ff85;
            }
            #${PROMPT_DOC_MODAL_ID} .yts-doc-table.examples th {
                background: #89898954;
            }
            #yts-preview-textarea{
                width: 100%;
                min-height: 70vh;
                font-family: inherit;
            }
            #model-select-modal {
                display: flex;
                align-items: center;
                justify-content: center;
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.7);
                z-index: 1000000;
            }

            #model-select-modal .modal-inner {
                background: #2b2b2b;
                color: #f1f1f1;
                border-radius: 12px;
                box-shadow: 0 4px 38px 0 rgba(0,0,0,0.26);
                max-width: 400px;
                width: 97vw;
                min-width: 270px;
                box-sizing: border-box;
                padding: 0px 10px 20px 20px;
                position:relative;
            }

            #model-select-modal .modal-topbar {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 10px 0 3px 0;
                background: #2b2b2b;
                position: sticky;
                top: 0;
                z-index: 10;
                border-top-left-radius: 12px;
                border-top-right-radius: 12px;
                min-height: 40px;
            }

            #model-select-modal .modal-title {
                font-size:23px;
                font-weight:600;
                color:#f1f1f1;
                letter-spacing:.01em;
                text-align:center;
                user-select:none;
                flex: 1;
            }

            #model-select-modal .modal-close{
                position: static;
                font-size:40px;
                font-weight:bold;
                color:#636363;
                cursor:pointer;
                background:none;
                border:none;
                line-height:1;
                transition:color .16s;
                user-select:none;
                z-index: 1;
            }

            #model-select-modal .modal-close:hover{
                color:#b1b1b1;
            }
            #model-select-modal .yts-model-modal-option {
                padding: 7px 13px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 15px;
                background: none;
                transition: background .17s, color .14s;
                text-align: left;
                margin-bottom: 1px;
                font-family: inherit;
            }
            #model-select-modal .yts-model-modal-option:nth-child(odd) {
                background: #0000001c;
            }
            #model-select-modal .yts-model-modal-option:nth-child(even) {
                background: #ffffff1c;
            }
            #model-select-modal .yts-model-modal-option:hover {
                background: #5db0ff29;
                color: #42a3ff;
            }
            .modal-message-info {
                display: none;
                text-align: center;
                margin-top: 10px;
                border-radius: 5px;
                padding: 5px;
                font-size: 12px;
            }
            #${CUSTOM_PROMPT_MODAL_ID} {
                display: none;
                position: fixed;
                z-index: 999999;
                left: 0;
                top: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(0,0,0,0.7);
            }
            #${CUSTOM_PROMPT_MODAL_ID} .modal-inner {
                background: #2b2b2b;
                color: #f1f1f1;
                border-radius: 12px;
                box-shadow: 0 4px 38px 0 rgba(0,0,0,0.26);
                position: absolute;
                left: 50%;
                top: 50%;
                transform: translate(-50%,-50%);
                max-width: 1000px;
                width: 97vw;
                padding: 24px;
                box-sizing: border-box;
            }
            #${CUSTOM_PROMPT_MODAL_ID} .modal-close {
                position: absolute;
                top: 15px;
                right: 20px;
                font-size: 40px;
                font-weight: bold;
                color: #636363;
                cursor: pointer;
                background: none;
                border: none;
                line-height: 1;
                transition: color .16s;
                user-select: none;
            }
            #${CUSTOM_PROMPT_MODAL_ID} .modal-close:hover {
                color: #b1b1b1;
            }
            #${CUSTOM_PROMPT_MODAL_ID} .modal-title {
                font-size: 23px;
                font-weight: 600;
                margin-bottom: 6px;
                color: #f1f1f1;
                letter-spacing: .01em;
                text-align: center;
                user-select: none;
            }
            #${CUSTOM_PROMPT_MODAL_ID} label {
                display: block;
                margin-bottom: 8px;
                font-weight: 600;
                color: #cdcdcd;
                font-size: 14px;
            }
            #${CUSTOM_PROMPT_MODAL_ID} textarea {
                width: 100%;
                min-height: 120px;
                font-size: 13px;
                padding: 7px;
                border-radius: 4px;
                border: 1px solid #4a4d4d;
                background: #252525;
                color: #f1f1f1;
                box-sizing: border-box;
                resize: vertical;
                font-family: inherit;
                margin-bottom: 12px;
                max-height: 700px;
            }
            #${CUSTOM_PROMPT_MODAL_ID} textarea:focus {
                outline: none;
            }
            #${CUSTOM_PROMPT_MODAL_ID} .placeholders-container {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-bottom: 20px;
            }
            #${CUSTOM_PROMPT_MODAL_ID} .custom-placeholder-select {
                display: inline-block;
                position: relative;
                vertical-align: middle;
                background: #3077bb;
                border-radius: 18px;
            }
            #${CUSTOM_PROMPT_MODAL_ID} .custom-placeholder-select select {
                border: none;
                border-radius: 18px;
                font-size: 13px;
                cursor: pointer;
                background: transparent;
                color: #fff;
                appearance: none;
                outline: none;
                font-weight: 500;
                position: relative;
                z-index: 2;
            }
            #${CUSTOM_PROMPT_MODAL_ID} .custom-placeholder-select select{
                background-color: #3077bb;
                color: #fff;
            }
            #${CUSTOM_PROMPT_MODAL_ID} .custom-placeholder-select select option {
                background-color: #4a4d4d;
                color: #fff;
            }
            #${CUSTOM_PROMPT_MODAL_ID} .custom-placeholder-select::after {
                content: "▼";
                position: absolute;
                right: 10px;
                top: 50%;
                transform: translateY(-50%);
                color: #fff;
                pointer-events: none;
                font-size: 13px;
                font-weight: bold;
                z-index: 3;
            }
            #${CUSTOM_PROMPT_MODAL_ID} select {
                padding: 6px 12px;
                border: none;
                border-radius: 18px;
                font-size: 13px;
                cursor: pointer;
                background: #4a4d4d;
                color: #f1f1f1;
                appearance: none;
                padding-right: 24px;
            }
            #${CUSTOM_PROMPT_MODAL_ID} button.placeholder-toggle {
                padding: 6px 12px;
                border: none;
                border-radius: 18px;
                font-size: 13px;
                cursor: pointer;
                transition: all 0.2s;
                background: #4a4d4d;
                color: #f1f1f1;
                margin-right: 0;
            }
            #${CUSTOM_PROMPT_MODAL_ID} button.placeholder-toggle.active {
                background: #3077bb;
            }
            #${CUSTOM_PROMPT_MODAL_ID} .custom-execute-btn {
                padding: 7px;
                background: #3077bb;
                color: #fff;
                border: none;
                border-radius: 5px;
                font-size: 14px;
                font-weight: 500;
                cursor: pointer;
                transition: background 0.18s;
                margin-top: 10px;
                display: block;
                margin-left: auto;
                margin-right: auto;
                width: 100%;
            }
            #${CUSTOM_PROMPT_MODAL_ID} .custom-execute-btn:hover {
                background: #1d5993;
            }
        `);
    }

    /**
     Возвращает время в формате DD.MM.YYYY HH:MM:SS.mmm. Можно указать unixtime.

     @param {number} [unixtime] Метка времени в миллисекундах (опционально)
     @return {string} Отформатированная дата и время
     */
    function getFormattedTime(unixtime) {
        const date = typeof unixtime === 'number' ? new Date(unixtime) : new Date();
        const pad = (n) => n.toString().padStart(2, '0');
        const day = pad(date.getDate());
        const month = pad(date.getMonth() + 1);
        const year = date.getFullYear();
        const hours = pad(date.getHours());
        const minutes = pad(date.getMinutes());
        const seconds = pad(date.getSeconds());
        const ms = date.getMilliseconds().toString().padStart(3, '0');
        return `${day}.${month}.${year} ${hours}:${minutes}:${seconds}.${ms}`;
    }

    /**
     * Определяет имя вызывающей функции для логирования
     *
     * @return {string} Имя функции-вызывателя или 'global'
     */
    function getCallerFunctionName() {
        const err = new Error();
        if (!err.stack) return 'global';
        const stack = err.stack.split('\n');
        for (let i = 2; i < stack.length; i++) {
            const line = stack[i].trim();
            // Chrome: at Имя (url:стр:стр) / Firefox: Имя@url:стр:стр
            let match = line.match(/at (\S+)/);           // Chrome/Edge
            if (!match) match = line.match(/^(\S+)@/);    // Firefox
            let name = match ? match[1] : '';
            // Пропустить технические или url-строки
            if (
                !name ||
                name === 'log' ||
                name === 'getCallerFunctionName' ||
                /^https?:/.test(name) ||
                name.startsWith('Object.') ||
                name.startsWith('MutationObserver')
            ) {
                continue;
            }
            // Явное <anonymous>
            if (name === '<anonymous>' || name === 'Object.<anonymous>') continue;
            return name;
        }
        return 'global';
    }

    /**
     Логирование сообщений с автоматическим указанием имени вызывающей функции и типа лога

     @param {string} message Сообщение для лога
     @param {...any} args Дополнительные аргументы или тип лога ('log', 'error', 'warn', 'info', 'debug')
     @return {void}
     */
    function log(message, ...args) {
        let type = "debug";
        if (
            args.length &&
            typeof args[args.length - 1] === "string" &&
            ["log", "error", "warn", "info", "debug"].includes(args[args.length - 1])
        ) {
            type = args.pop();
        }
        const time = getFormattedTime();
        const functionName = getCallerFunctionName();
        const prefix = functionName
            ? `[${time}] [${MODULE_NAME}] [${functionName}] ${message}`
            : `[${time}] [${MODULE_NAME}] ${message}`;
        if (console[type]) {
            console[type](prefix, ...args);
        } else {
            console.log(prefix, ...args);
        }
    }

    /**
     * Генерация уникального id промпта
     *
     * @return {string} Уникальный идентификатор промпта
     */
    function genPromptId() {
        return 'p_' + Math.random().toString(36).slice(2, 12) + "_" + Date.now();
    }

    /**
     * Функция для поиска первого элемента по селектору внутри заданного контекста

     * @param sel CSS-селектор
     * @param context Элемент-контекст для поиска (по умолчанию document)
     * @return Первый найденный элемент или null
     */
    function q(sel, context) {
        /**
         * Поиск элемента по селектору внутри контекста

         * @param sel CSS-селектор
         * @param context Контекст поиска (document или элемент)
         * @return Первый элемент или null
         */
        context = context || document;
        if (context instanceof Document || context instanceof Element) {
            return context.querySelector(sel);
        }
        return null;
    }

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
     * Устанавливает значение по ключу в зависимости от наличия GM_setValue и глобального флага
     *
     * @param {string} name Ключ
     * @param {any} value Значение (любое — преобразуется в строку)
     */
    function setSettingValue(name, value) {
        if (USE_GM_STORAGE && typeof GM_setValue === "function") {
            GM_setValue(name, value);
            return;
        }
        window.localStorage.setItem(name, value);
    }

    /**
     * Получает значение по ключу с учётом GM_getValue и глобального флага
     *
     * @param {string} name Ключ
     * @param {any} [def] Значение по умолчанию
     * @return {any} Значение или значение по умолчанию
     */
    function getSettingValue(name, def) {
        if (USE_GM_STORAGE && typeof GM_getValue === "function") {
            let v = GM_getValue(name, undefined);
            return typeof v !== "undefined" ? v : def;
        }
        let v = window.localStorage.getItem(name);
        return v !== null ? v : def;
    }

    /**
     * Сохранение настроек
     *
     * @param {object} settings Настройки
     */
    function saveSettings(settings) {
        const delta = JSON.stringify(getSettingsDelta(DEFAULT_SETTINGS, settings));
        log('Save settings', delta);
        setSettingValue(STORAGE_KEY, delta);
    }

    /**
     * Загрузка настроек
     *
     * @return {object} Настройки
     */
    function loadSettings() {
        try {
            const data = getSettingValue(STORAGE_KEY, null);
            if (!data) {
                return {...DEFAULT_SETTINGS};
            }
            const merged = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(data) || {});
            if (!Array.isArray(merged.prompts) || merged.prompts.length === 0) {
                log('Prompts are missing or corrupt in settings, restoring defaults');
                merged.prompts = [...DEFAULT_PROMPTS];
            }
            merged.prompts.forEach(p => {
                if (!p.id) p.id = genPromptId();
            });
            // Проверяем activePromptId с учетом специального значения 'custom'
            if (!merged.activePromptId ||
                (merged.activePromptId !== 'custom' &&
                    !merged.prompts.find(p => p.id === merged.activePromptId))
            ) {
                log('Active prompt missing or invalid, setting as first from list');
                merged.activePromptId = merged.prompts[0].id;
            }
            return merged;
        } catch (e) {
            log('Error loading settings, fallback to defaults', e, 'error');
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
        if (promptId === 'custom' || settings.prompts.find(p => p.id === promptId)) {
            settings.activePromptId = promptId;
            saveSettings(settings);
            updateUIAfterPromptChange();
        } else {
            log('Attempted to change to non-existent promptId', promptId, 'warn');
        }
    }

    /**
     * Получить текущий активный промпт
     *
     * @return {object} Текущий активный промпт
     */
    function getActivePrompt() {
        const s = loadSettings();
        if (s.activePromptId === 'custom') {
            return {
                id: 'custom',
                title: 'Свой запрос',
                prompt: s.customPromptText || ''
            };
        }
        return s.prompts.find(p => p.id === s.activePromptId) || s.prompts[0];
    }

    /**
     * Очистка контейнера результата
     *
     * @param {HTMLElement} container DOM-элемент
     */
    function clearContainer(container) {
        log('Clearing result container');
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
        if (!resultContainer || resultContainer.querySelector('.yts-min-btn')) return;

        const minBtn = createTextButton('Свернуть', 'yts-min-btn', () => {
            minimizeResultContainer();
            log('Result container minimized by user');
        });

        resultContainer.appendChild(minBtn);
        resultContainer.classList.add('yts-can-min');
        log('Minimize button added to result container');
    }

    /**
     * Сворачивает блок результата, показывает кнопу "Развернуть"
     */
    function minimizeResultContainer() {
        const resultContainer = document.getElementById(RESULT_CONTAINER_ID);
        if (!resultContainer) return;

        resultContainer.classList.add('yts-minimized');
        const children = Array.from(resultContainer.children);
        for (let el of children) {
            if (el.classList.contains('yts-title-row')) continue;
            if (el.classList.contains('yts-min-btn')) {
                el.style.display = 'none';
                continue;
            }
            el.style.display = 'none';
        }

        if (!resultContainer.querySelector('.yts-more-btn')) {
            const moreBtn = createTextButton('Развернуть', 'yts-more-btn', restoreResultContainer);
            resultContainer.appendChild(moreBtn);
            log('Expand button added to minimized container');
        } else {
            resultContainer.querySelector('.yts-more-btn').style.display = '';
        }
        log('Result container minimized');
    }

    /**
     * Восстанавливает блок результата в полный вид, прячет "Развернуть", показывает "Свернуть"
     */
    function restoreResultContainer() {
        const resultContainer = document.getElementById(RESULT_CONTAINER_ID);
        if (!resultContainer) return;
        resultContainer.classList.remove('yts-minimized');
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
        log('Result container restored to full view');
    }

// Переопределение updateResultContentStream (повтор вставки "collapse/expand"):
    const oldUpdateResultContentStream = updateResultContentStream;
    updateResultContentStream = function (deltaText, isComplete) {
        oldUpdateResultContentStream(deltaText, isComplete);
        const container = document.getElementById(RESULT_CONTAINER_ID);
        if (isComplete && container) {
            setTimeout(() => appendMinimizeButtons(container), 10);
            log('Result container: minimize feature checked after complete streaming');
        }
    };

    /**
     * Добавление блока кнопок копирования
     *
     * @param {HTMLElement} container Контейнер
     */
    function appendCopyButtons(container) {
        if (q('.yts-copy-btn-group', container)) return;
        const groupDiv = document.createElement('div');
        groupDiv.className = 'yts-copy-btn-group';

        const btnCopySummary = createButtonIcon({
            title: 'Копировать результат',
            icon: ICONS.COPY,
            onClick: function () {
                GM_setClipboard(currentResult, 'text');
                markBtnCopied(btnCopySummary);
                log('User copied summary/result to clipboard');
            }
        });
        groupDiv.appendChild(btnCopySummary);

        const btnCopySubs = createButtonIcon({
            title: 'Копировать субтитры',
            icon: ICONS.SUBTITLES,
            onClick: function (evt) {
                if (evt.button === 0) {
                    GM_setClipboard(globalVideoData.subtitlesFull, 'text');
                    markBtnCopied(btnCopySubs);
                    log('User copied full subtitles to clipboard (left mouse)');
                }
            }
        });

        btnCopySubs.addEventListener('contextmenu', function (evt) {
            evt.preventDefault();
            GM_setClipboard(globalVideoData.subtitlesText, 'text');
            markBtnCopied(btnCopySubs);
            log('User copied plain subtitles text to clipboard (right mouse)');
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
        log('Copy buttons block added to result UI');
    }

    /**
     * Подсветка кнопки как "Скопировано"
     *
     * @param {HTMLElement} btn Кнопка DOM
     */
    function markBtnCopied(btn) {
        btn.classList.add('yts-copy-success');
        setTimeout(() => {
            btn.classList.remove('yts-copy-success');
        }, 1500);
    }

    /**
     * Создать иконку-кнопку для копирования
     *
     * @param {object} args аргументы
     * @param {string} args.title Текст подсказки
     * @param {string} args.icon SVG-иконка кнопки
     * @param {function} args.onClick Обработчик клика
     * @return {HTMLElement} DOM-элемент кнопки
     */
    function createButtonIcon({title = '', icon = null, onClick}) {
        const btn = document.createElement('button');
        btn.type = "button";
        btn.className = 'yts-copy-btn yt-spec-button-shape-next--mono yt-spec-button-shape-next--tonal';
        btn.title = title;

        if (icon) {
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute("width", "16");
            svg.setAttribute("height", "16");
            svg.setAttribute("viewBox", "0 0 24 24");
            svg.setAttribute("fill", "none");
            svg.setAttribute("stroke", "currentColor");
            svg.setAttribute("stroke-width", "2");

            icon.elements.forEach(el => {
                const element = document.createElementNS("http://www.w3.org/2000/svg", el.type);

                Object.entries(el.attrs).forEach(([key, value]) => {
                    element.setAttribute(key, value);
                });

                if (el.type === 'text' && el.text) {
                    element.textContent = el.text;
                }

                svg.appendChild(element);
            });

            btn.appendChild(svg);
        }

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
        const container = document.getElementById(RESULT_CONTAINER_ID);
        if (!container) {
            log('No container to show error in', null, 'error');
            return;
        }
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
     * Ожидание появления элемента
     *
     * @param {string} selector Селектор
     * @return {Promise<HTMLElement>} Промис с найденным элементом
     */
    function waitForElement(selector) {
        log('Wait for element:', {selector});
        const el = q(selector);
        if (el) {
            log('Element found immediately', {selector});
            return Promise.resolve(el);
        }
        return new Promise(resolve => {
            const observer = new MutationObserver(() => {
                const found = q(selector);
                if (found) {
                    observer.disconnect();
                    log('Element found by MutationObserver', {selector});
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
        const main = [
            m.toString().padStart(2, '0'),
            s.toString().padStart(2, '0')
        ].join(':');
        return showHours
            ? h.toString().padStart(2, '0') + ":" + main
            : main;
    }

    /**
     * Парсинг и одновременное извлечение субтитров из XML в двух форматах: полный с таймкодами и просто текст
     *
     * @param xmlString XML-субтитры
     * @return {{subtitlesFull: string, subtitlesText: string}} Субтитры с таймкодами и только текст
     */
    function extractTextFromSubtitleXml(xmlString) {
        const textMatches = xmlString.match(/<text[^>]*>(.*?)<\/text>/g);
        if (!textMatches) {
            log('No subtitles <text> tags found in XML', null, 'error');
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

        let subtitlesFull = "[start] text\n";
        const regex = /<text[^>]*start="([\d.]+)"[^>]*dur="([\d.]+)"[^>]*>(.*?)<\/text>/;
        textMatches.forEach(match => {
            const item = regex.exec(match.replace(/\n/g, ''));
            if (item) {
                const start = parseFloat(item[1]);
                const text = decodeHtmlEntities(item[3]);
                subtitlesFull += `[${secondsToTimeString(start, showHours)}] ${text}\n`;
            }
        });

        log('Subtitles extracted from XML', {
            subtitlesTextLen: subtitlesText.length,
            subtitlesFullLines: subtitlesFull.split('\n').length
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

    /**
     * Извлечение JS-объекта из всего HTML-контента по выражению присваивания через регулярные выражения
     *
     * @param {string} html HTML-контент страницы
     * @param {string} varName Название переменной (например, "ytInitialPlayerResponse")
     * @param {string[]} path Путь к вложенному объекту (например, ["captions", "playerCaptionsTracklistRenderer", "captionTracks"])
     * @return {any|null} Найденный объект или null
     */
    function extractObjectFromHtml(html, varName, path = []) {
        const re = new RegExp(`${varName}\\s*=\\s*({[\\s\\S]+?});`);
        const match = html.match(re);
        if (match) {
            try {
                const data = JSON.parse(match[1]);
                const value = path.length ? path.reduce((o, k) => (o ? o[k] : undefined), data) : data;
                if (value !== undefined && value !== null) return value;
            } catch (e) {
            }
        }
        return null;
    }

    /**
     Универсальная функция для извлечения значения атрибута любого тега по произвольному полю имени из html-строки

     @param tag Имя тега (например, "meta")
     @param keyField Имя поля (например, "name" или "property")
     @param keyValue Значение поля для поиска (например, "description" или "og:image")
     @param valueField Имя значения (например, "content")
     @param html HTML-контент для поиска
     @return Значение valueField или null
     */
    function extractTagAttribute(tag, keyField, keyValue, valueField, html) {
        const re = new RegExp(`<${tag}[^>]+${keyField}=["']${keyValue}["'][^>]+${valueField}=["']([^"']+)["']`, 'i');
        const match = html.match(re);
        return match ? match[1].trim() : null;
    }

    /**
     Выполняет извлечение пунктов списка эпизодов с YouTube разметки, формирует нормализованный список строк эпизодов

     @return Массив строк эпизодов в формате "[мм:сс] Название"
     */
    function extractEpisodes() {
        const items = document.querySelectorAll('ytd-macro-markers-list-item-renderer.ytd-macro-markers-list-renderer');
        const episodes = [];
        items.forEach(item => {
            const titleEl = item.querySelector('h4.macro-markers[title]');
            const timeEl = item.querySelector('div#time');
            const title = titleEl ? titleEl.getAttribute('title') || titleEl.textContent.trim() : '';
            const time = timeEl ? timeEl.textContent.trim() : '';
            let normTime = time;
            if (time && !time.match(/^\d{2}:\d{2}$/)) {
                const parts = time.split(':').map(x => x.padStart(2, '0'));
                if (parts.length === 2) {
                    normTime = `${parts[0]}:${parts[1]}`;
                } else if (parts.length === 3) {
                    normTime = `${String(parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10)).padStart(2, '0')}:${parts[2]}`;
                }
            }
            if (title && normTime) {
                episodes.push(`[${normTime}] ${title}`);
            }
        });
        return episodes.join('\n');
    }

    /**
     * Получить данные видео/субтитров через парсинг HTML страницы (без window.ytInitialPlayerResponse)
     *
     * @return {Promise<object>} Объект с данными видео, субтитров и дополнительной информацией
     */
    async function getVideoFullData() {
        log('Fetching full video data including subtitles...');
        const NOT_DEFINED = 'не определено';

        const videoId = (new URLSearchParams(location.search)).get('v');
        if (!videoId) {
            log('videoId missing in URL', null, 'error');
            throw new Error('Данные о видео не найдены (videoId == null)');
        }
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

        const html = await (await fetch(videoUrl)).text();

        const playerResponse = extractObjectFromHtml(html, 'ytInitialPlayerResponse');
        if (!playerResponse) {
            log('ytInitialPlayerResponse not found in HTML', null, 'error');
            throw new Error('Данные о видео не найдены (ytInitialPlayerResponse == null)');
        }

        const title = playerResponse.videoDetails?.title
            || playerResponse.microformat?.playerMicroformatRenderer?.title?.simpleText
            || extractTagAttribute('meta', 'name', 'title', 'content', html)
            || NOT_DEFINED;

        const shortDescription =
            extractTagAttribute('meta', 'name', 'description', 'content', html)
            || NOT_DEFINED;

        const keywords =
            extractTagAttribute('meta', 'name', 'keywords', 'content', html)
            || NOT_DEFINED;

        const channelName = (() => {
            const primary =
                playerResponse?.videoDetails?.author
                || playerResponse?.microformat?.playerMicroformatRenderer?.ownerChannelName;
            if (primary) return primary;
            return NOT_DEFINED;
        })();

        const publishDate = playerResponse.microformat?.playerMicroformatRenderer?.publishDate
            || playerResponse.microformat?.playerMicroformatRenderer?.uploadDate
            || extractTagAttribute('meta', 'itemprop', 'datePublished', 'content', html)
            || NOT_DEFINED;

        const lengthSeconds = (() => {
            const primary = playerResponse?.videoDetails?.lengthSeconds;
            if (primary) return primary;

            const dur = extractTagAttribute('meta', 'itemprop', 'duration', 'content', html);
            if (!dur) return NOT_DEFINED;

            const m = dur.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
            if (!m) return NOT_DEFINED;

            const min = m[1] ? parseInt(m[1]) : 0;
            const sec = m[2] ? parseInt(m[2]) : 0;
            return (min * 60 + sec).toString();
        })();

        const category = playerResponse.microformat?.playerMicroformatRenderer?.category
            || extractTagAttribute('meta', 'itemprop', 'genre', 'content', html)
            || NOT_DEFINED;

        const thumbnailUrl = (() => {
            const thumbnails = playerResponse?.videoDetails?.thumbnail?.thumbnails
                || playerResponse?.microformat?.playerMicroformatRenderer?.thumbnail?.thumbnails
                || [];
            if (Array.isArray(thumbnails) && thumbnails.length > 0) {
                return thumbnails[thumbnails.length - 1].url;
            }
            return extractTagAttribute('meta', 'property', 'og:image', 'content', html)
                || NOT_DEFINED;
        })();

        const episodes = extractEpisodes()
            || NOT_DEFINED;

        const captionTracks = (() => {
            const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
            if (Array.isArray(tracks) && tracks.length > 0) {
                return tracks;
            }
            const match = html.match(/"captionTracks":\s*\[(.*?)]/s);
            if (!match) {
                log('No caption tracks found in HTML', null, 'error');
                throw new Error('Субтитры не найдены для этого видео');
            }
            try {
                return JSON.parse(`[${match[1]}]`);
            } catch (e) {
                log('Parsing captionTracks failed', e, 'error');
                throw new Error('Ошибка обработки данных субтитров');
            }
        })();

        const langPref = ['ru', 'en'];
        let captionTrack = langPref.map(lc => captionTracks.find(t => t.languageCode === lc))
            .find(Boolean) || captionTracks[0];

        if (!captionTrack?.baseUrl) {
            log('No valid baseUrl for captions', {captionTrack}, 'error');
            throw new Error('Не удалось найти ссылку на субтитры');
        }
        const subtitleUrl = captionTrack.baseUrl;
        log('Fetching subtitles from', subtitleUrl);

        const subtitleXml = await (await fetch(subtitleUrl)).text();
        const {subtitlesText, subtitlesFull} = extractTextFromSubtitleXml(subtitleXml);
        if (!subtitlesText) {
            log('Failed to extract subtitles text', null, 'error');
            throw new Error('Не удалось извлечь текст из субтитров');
        }
        if (subtitlesText.length < 10) {
            log('Subtitles too short or empty', {length: subtitlesText.length}, 'error');
            throw new Error('Не удалось получить достаточно субтитров для этого видео');
        }

        const result = {
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
            episodes,
            subtitleUrl,
            subtitlesText,
            subtitlesFull
        };
        log('Successfully fetched all video and subtitles data', result);
        return result;
    }

    /**
     * Создает или обновляет контейнер результата
     *
     * @param {boolean} loading Флаг процесса (идёт генерация)
     * @return {Promise<void>} Промис
     */
    async function createOrUpdateResultContainer(loading = true) {
        log('Creating/updating result container, loading state:', loading);
        const targetElement = await waitForElement(TARGET_RESULT_ELEMENT);
        if (!targetElement) {
            log('Target element for result container not found!', null, 'error');
            return;
        }
        let container = document.getElementById(RESULT_CONTAINER_ID);
        if (!container) {
            container = document.createElement('div');
            container.id = RESULT_CONTAINER_ID;
            targetElement.insertBefore(container, targetElement.firstChild);
            log('Result container inserted to page');
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
        log('Result container UI updated');
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
            } else {
                mark.textContent = ' ';
            }

            item.appendChild(mark);

            const labelNode = document.createElement('span');
            labelNode.textContent = p.title || '(без названия)';
            item.appendChild(labelNode);

            item.addEventListener('click', () => {
                log('Context menu: user switched to prompt', {promptId: p.id, title: p.title});
                setActivePrompt(p.id);
                hideContextMenu();
            });
            menu.appendChild(item);
        });

        // Добавляем пункт "Свой запрос"
        const customItem = document.createElement('div');
        customItem.className = "menu-item";
        if (settings.activePromptId === 'custom') customItem.classList.add('active');

        const customMark = document.createElement('span');
        customMark.className = 'mark';
        customMark.textContent = settings.activePromptId === 'custom' ? '➤' : ' ';
        customItem.appendChild(customMark);

        const customLabel = document.createElement('span');
        customLabel.textContent = 'Свой запрос';
        customItem.appendChild(customLabel);

        customItem.addEventListener('click', () => {
            log('Context menu: user switched to custom prompt');
            setActivePrompt('custom');
            hideContextMenu();
        });
        menu.appendChild(customItem);

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
    }

    /**
     * Обработчик нажатия на кнопку "Выполнить" в окне кастомного промпта
     *
     * :param modal: DOM-элемент модального окна
     * :param promptTextarea: DOM-элемент textarea промпта
     * :param placeholdersContainer: DOM-элемент с плейсхолдерами
     */
    function handleCustomPromptExecuteBtn(modal, promptTextarea, placeholdersContainer) {
        log('handleCustomPromptExecuteBtn: called');
        const customPrompt = promptTextarea.value.trim();
        if (!customPrompt) {
            log('handleCustomPromptExecuteBtn: empty custom prompt');
            alert('Введите текст запроса');
            return;
        }

        // Собираем выбранные плейсхолдеры с описаниями
        const selected = [];

        // Кнопки
        placeholdersContainer.querySelectorAll('button.placeholder-toggle.active').forEach(btn => {
            selected.push({
                key: btn.dataset.key,
                label: btn.textContent.trim()
            });
        });

        // Селектор субтитров
        const subtitlesSelect = placeholdersContainer.querySelector('select');
        if (subtitlesSelect && subtitlesSelect.value) {
            const opt = subtitlesSelect.selectedOptions[0];
            selected.push({
                key: subtitlesSelect.value,
                label: opt ? opt.textContent.trim() : subtitlesSelect.value
            });
        }

        log('Used custom prompt placeholders', selected);

        const activePlaceholders = selected.map(i => i.key);

        const currentSettings = loadSettings();
        currentSettings.customPromptText = customPrompt;
        currentSettings.customPromptPlaceholders = activePlaceholders;
        saveSettings(currentSettings);

        modal.remove();

        if (ytsPrintTimer) {
            clearInterval(ytsPrintTimer);
            ytsPrintTimer = null;
        }
        ytsPrintBuffer = [];
        ytsPrintIsComplete = false;
        ytsErrorAlreadyShown = false;
        currentResult = "";

        restoreResultContainer();
        createOrUpdateResultContainer(true).then(() => {
            log('handleCustomPromptExecuteBtn: started loading video data for custom prompt');
            getVideoFullData().then(videoData => {
                let fullPrompt = customPrompt;
                if (selected.length > 0) {
                    fullPrompt += '\n\n';
                    selected.forEach(sel => {
                        if (videoData[sel.key] !== undefined) {
                            fullPrompt += `${sel.label}: ${videoData[sel.key]}\n`;
                        }
                    });
                }
                log('handleCustomPromptExecuteBtn: sending to API', {usedPlaceholders: selected});
                sendToAPI({...videoData, customPrompt: fullPrompt}).catch(error => {
                    showError(error.message || 'Ошибка при обработке запроса');
                    log('handleCustomPromptExecuteBtn: sendToAPI error', error, 'error');
                });
            }).catch(error => {
                showError(error.message || 'Ошибка при обработке запроса');
                log('handleCustomPromptExecuteBtn: getVideoFullData error', error, 'error');
            });
        });
    }

    /**
     * Показывает модальное окно для ввода кастомного промпта
     */
    function showCustomPromptModal() {
        log('showCustomPromptModal: called');
        let modal = document.getElementById(CUSTOM_PROMPT_MODAL_ID);

        if (!modal) {
            log('showCustomPromptModal: creating modal');
            modal = document.createElement('div');
            modal.id = CUSTOM_PROMPT_MODAL_ID;
            modal.style.display = 'block';

            const modalInner = document.createElement('div');
            modalInner.className = 'modal-inner';

            const closeBtn = document.createElement('button');
            closeBtn.className = 'modal-close';
            closeBtn.type = 'button';
            closeBtn.textContent = '×';
            closeBtn.title = 'Закрыть';
            closeBtn.onclick = () => {
                log('showCustomPromptModal: close clicked');
                modal.remove();
            };

            const title = document.createElement('div');
            title.className = 'modal-title';
            title.textContent = 'Свой запрос';

            const promptLabel = document.createElement('label');
            promptLabel.textContent = 'Текст запроса:';

            const promptTextarea = document.createElement('textarea');
            promptTextarea.placeholder = 'Введите ваш запрос к LLM...';

            const settings = loadSettings();
            promptTextarea.value = settings.customPromptText || '';

            const placeholdersLabel = document.createElement('label');
            placeholdersLabel.textContent = 'Добавить к запросу данные:';

            const placeholdersContainer = document.createElement('div');
            placeholdersContainer.className = 'placeholders-container';

            const placeholders = [
                {
                    key: 'subtitles', label: 'Субтитры', options: [
                        {value: 'subtitlesText', label: 'Субтитры (только текст)'},
                        {value: 'subtitlesFull', label: 'Субтитры (с таймкодами)'}
                    ]
                },
                {key: 'episodes', label: 'Эпизоды (с таймкодами)'},
                {key: 'title', label: 'Название видео'},
                {key: 'shortDescription', label: 'Описание видео'},
                {key: 'channelName', label: 'Название канала'},
                {key: 'publishDate', label: 'Дата публикации'},
                {key: 'lengthSeconds', label: 'Длительность'},
                {key: 'category', label: 'Категория'},
                {key: 'keywords', label: 'Ключевые слова'},
                {key: 'videoUrl', label: 'Ссылка на видео'},
                {key: 'thumbnailUrl', label: 'Ссылка на превью'},
            ];

            const savedPlaceholders = settings.customPromptPlaceholders;

            placeholders.forEach(ph => {
                if (ph.options) {
                    const selectWrap = document.createElement('div');
                    selectWrap.className = 'custom-placeholder-select';

                    const select = document.createElement('select');
                    ph.options.forEach(opt => {
                        const option = document.createElement('option');
                        option.value = opt.value;
                        option.textContent = opt.label;
                        option.selected = savedPlaceholders.includes(opt.value);
                        select.appendChild(option);
                    });
                    selectWrap.appendChild(select);
                    placeholdersContainer.appendChild(selectWrap);
                } else {
                    const toggle = document.createElement('button');
                    toggle.type = 'button';
                    toggle.textContent = ph.label;
                    toggle.dataset.key = ph.key;
                    toggle.className = 'placeholder-toggle';
                    if (savedPlaceholders.includes(ph.key)) {
                        toggle.classList.add('active');
                    }
                    toggle.onclick = () => {
                        toggle.classList.toggle('active');
                    };
                    placeholdersContainer.appendChild(toggle);
                }
            });

            const btnBlock = document.createElement('div');
            btnBlock.style.display = "flex";
            btnBlock.style.gap = "8px";
            btnBlock.style.justifyContent = "flex-end";
            btnBlock.style.marginTop = "10px";

            const executeBtn = document.createElement('button');
            executeBtn.textContent = 'Выполнить';
            executeBtn.className = 'custom-execute-btn';
            executeBtn.disabled = promptTextarea.value.trim() === '';
            executeBtn.style.transition = "background .18s, opacity .18s";
            executeBtn.onclick = function () {
                if (!executeBtn.disabled) {
                    handleCustomPromptExecuteBtn(modal, promptTextarea, placeholdersContainer);
                }
            };

            function styleExecuteBtn() {
                if (executeBtn.disabled) {
                    executeBtn.style.background = '#3e3e3e';
                    executeBtn.style.color = '#b1b1b1';
                    executeBtn.style.opacity = '0.6';
                    executeBtn.style.cursor = 'default';
                } else {
                    executeBtn.style.background = '#3077bb';
                    executeBtn.style.color = '#fff';
                    executeBtn.style.opacity = '';
                    executeBtn.style.cursor = 'pointer';
                }
            }

            executeBtn.onmouseenter = function () {
                if (!executeBtn.disabled) {
                    executeBtn.style.background = '#1d5993';
                }
            };

            executeBtn.onmouseleave = function () {
                if (!executeBtn.disabled) {
                    executeBtn.style.background = '#3077bb';
                }
            };

            styleExecuteBtn();

            const resetBtn = document.createElement('button');
            resetBtn.textContent = 'Сброс';
            resetBtn.type = 'button';
            resetBtn.className = 'custom-execute-btn custom-reset-btn';
            resetBtn.style.background = '#762c83';
            resetBtn.style.color = '#fff';
            resetBtn.style.marginRight = 'auto';
            resetBtn.style.transition = "background .18s";
            resetBtn.onmouseenter = function () {
                resetBtn.style.background = '#56215f';
            };
            resetBtn.onmouseleave = function () {
                resetBtn.style.background = '#762c83';
            };
            resetBtn.onclick = function () {
                promptTextarea.value = '';
                executeBtn.disabled = true;
                styleExecuteBtn();

                const selects = placeholdersContainer.querySelectorAll('select');
                if (selects.length) {
                    selects[0].value = 'subtitlesText';
                }

                const placeholderButtons = placeholdersContainer.querySelectorAll('button.placeholder-toggle');
                placeholderButtons.forEach(btn => {
                    if (DEFAULT_SETTINGS.customPromptPlaceholders.includes(btn.dataset.key)) {
                        btn.classList.add('active');
                    } else {
                        btn.classList.remove('active');
                    }
                });

                const currentSettings = loadSettings();
                currentSettings.customPromptText = DEFAULT_SETTINGS.customPromptText;
                currentSettings.customPromptPlaceholders = DEFAULT_SETTINGS.customPromptPlaceholders;
                saveSettings(currentSettings);
            };

            promptTextarea.addEventListener('input', function () {
                executeBtn.disabled = promptTextarea.value.trim() === '';
                styleExecuteBtn();
            });

            btnBlock.appendChild(resetBtn);
            btnBlock.appendChild(executeBtn);

            modalInner.append(
                closeBtn,
                title,
                promptLabel,
                promptTextarea,
                placeholdersLabel,
                placeholdersContainer,
                btnBlock
            );
            modal.appendChild(modalInner);
            document.body.appendChild(modal);
        } else {
            log('showCustomPromptModal: modal exists, reopening');
        }

        modal.style.display = 'block';
        modal.querySelector('textarea').focus();
    }

    /**
     * Показать контекстное меню
     *
     * @param {number} x X-координата
     * @param {number} y Y-координата
     */
    function showContextMenu(x, y) {
        let menu = document.getElementById(CONTEXT_MENU_ID);
        if (!menu) {
            createContextMenu();
            menu = document.getElementById(CONTEXT_MENU_ID);
        }
        menu.style.left = `${Math.round(x)}px`;
        menu.style.top = `${Math.round(y)}px`;
        menu.style.display = 'block';
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 5}px`;
        if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 5}px`;
    }

    /**
     * Скрыть контекстное меню
     *
     * @param {Event} e Событие
     */
    function hideContextMenu(e = null) {
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
        if (btn && active && btn.textContent !== active.title) {
            btn.textContent = active.title || 'Генерировать';
            log('Button title updated', {title: btn.textContent});
        }
    }

    /**
     * Запрашивает список моделей у LLM по текущему url и токену
     *
     * @param {string} apiUrl URL эндпоинта
     * @param {string} apiToken Bearer-токен
     * @return {Promise<Array>} Массив моделей
     */
    async function fetchLLMModels(apiUrl, apiToken) {
        /**
         * Запрашивает и возвращает список моделей из LLM
         *
         * :param apiUrl: URL API
         * :param apiToken: Bearer-токен
         * :return: Массив id моделей
         */
        log('fetchLLMModels called', {apiUrl, apiToken});
        let url = apiUrl;
        try {
            let m = url.match(/^https?:\/\/[^\/]+/);
            url = m ? m[0] : url;
            url = url.replace(/\/+$/, '');
            url += "/v1/models";
        } catch (e) {
            log('Error processing apiUrl in fetchLLMModels', e, 'error');
            throw new Error('Некорректный URL API');
        }
        log('fetchLLMModels: final models URL', url);
        if (!/^https?:\/\//.test(url)) url = "https://" + url;
        const resp = await fetch(url, {
            method: "GET",
            headers: {
                "Authorization": "Bearer " + (apiToken || ""),
                "Accept": "application/json"
            }
        });
        log('fetchLLMModels: fetch response status', resp.status);
        if (!resp.ok) {
            const txt = await resp.text();
            let msg = `Ошибка LLM API: HTTP ${resp.status}`;
            try {
                const j = JSON.parse(txt);
                if (j.error?.message) msg = j.error.message;
            } catch (parseErr) {
                log('fetchLLMModels: JSON parse error in error body', parseErr, 'error');
            }
            log('fetchLLMModels: error body', txt, 'error');
            throw new Error(msg);
        }
        const data = await resp.json();
        log('fetchLLMModels: received data', data);
        if (!data.data || !Array.isArray(data.data)) {
            log('fetchLLMModels: invalid /v1/models response structure', data, 'error');
            throw new Error("Некорректный ответ от API /v1/models");
        }
        const ids = data.data.map(m => m.id);
        log('fetchLLMModels: models ids', ids);
        return ids;
    }

    /**
     * Показывает модальное окно выбора модели

     * @param {Array<string>} models Массив моделей
     * @param {function(string):void} onSelect Колбек для выбранной модели
     */
    function showModelsSelectModal(models, onSelect) {
        let modal = document.getElementById('model-select-modal');
        if (modal) modal.remove();

        modal = document.createElement('div');
        modal.id = 'model-select-modal';

        const modalInner = document.createElement('div');
        modalInner.className = 'modal-inner';

        const topBar = document.createElement('div');
        topBar.className = 'modal-topbar';

        const title = document.createElement('div');
        title.className = "modal-title";
        title.textContent = 'Выбор модели';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'modal-close';
        closeBtn.type = 'button';
        closeBtn.textContent = '×';
        closeBtn.title = 'Закрыть';
        closeBtn.onclick = () => modal.remove();

        topBar.appendChild(title);
        topBar.appendChild(closeBtn);

        const modelsList = document.createElement('div');
        modelsList.style.maxHeight = "50vh";
        modelsList.style.overflowY = "auto";
        modelsList.style.marginTop = "10px";
        modelsList.style.marginBottom = "8px";
        modelsList.style.paddingRight = '10px';

        models.forEach(m => {
            const opt = document.createElement('div');
            opt.className = 'yts-model-modal-option';
            opt.textContent = m;
            opt.onclick = () => {
                modal.remove();
                if (typeof onSelect === "function") onSelect(m);
            };
            modelsList.appendChild(opt);
        });

        modalInner.appendChild(topBar);
        modalInner.appendChild(modelsList);

        modal.appendChild(modalInner);

        modal.onclick = function (e) {
            if (e.target === modal) modal.remove();
        };
        document.body.appendChild(modal);
    }

    /**
     Универсальное контекстное меню с пунктами действий

     @param x X-координата
     @param y Y-координата
     @param items Массив пунктов меню [{label: "текст", onClick: функция}]
     */
    function showContextMenuUniversal(x, y, items) {
        let menuId = 'YTS_UniMenu';
        let oldMenu = document.getElementById(menuId);
        if (oldMenu) oldMenu.remove();

        const menu = document.createElement('div');
        menu.id = menuId;
        menu.style.position = 'fixed';
        menu.style.zIndex = '1000001';
        menu.style.background = '#373737';
        menu.style.borderRadius = '5px';
        menu.style.boxShadow = '0 2px 18px 0 rgba(0,0,0,0.25)';
        menu.style.padding = '1px';
        menu.style.color = '#f1f1f1';
        menu.style.fontFamily = 'Roboto,Arial,sans-serif';
        menu.style.fontSize = '14px';
        menu.style.userSelect = 'none';
        menu.style.minWidth = '170px';
        menu.style.top = y + 'px';
        menu.style.left = x + 'px';

        items.forEach((item) => {
            if (item === null) {
                // Разделитель
                const sep = document.createElement('div');
                sep.className = 'menu-separator';
                sep.style.height = '1px';
                sep.style.background = '#42484c';
                sep.style.width = '95%';
                sep.style.margin = '4px auto';
                menu.appendChild(sep);
                return;
            }
            const el = document.createElement('div');
            el.className = 'menu-item';
            el.tabIndex = 0;
            el.style.padding = '9px 20px 9px 14px';
            el.style.cursor = 'pointer';
            el.style.borderRadius = '3px';
            el.style.display = "flex";
            el.style.alignItems = "center";
            el.textContent = item.label;
            el.addEventListener('mouseenter', () => el.style.background = '#2151ad');
            el.addEventListener('mouseleave', () => el.style.background = 'none');
            el.addEventListener('click', () => {
                menu.remove();
                item.onClick?.();
            });
            menu.appendChild(el);
        });

        document.body.appendChild(menu);

        function hide(event) {
            if (event && menu.contains(event.target)) return;
            menu.remove();
            document.removeEventListener('mousedown', hide, {capture: true});
            document.removeEventListener('scroll', hide, {capture: true});
        }

        setTimeout(() => {
            document.addEventListener('mousedown', hide, {capture: true});
            document.addEventListener('scroll', hide, {capture: true});
        }, 10);
    }

    /**
     Сохранить объект в файл JSON

     :param data: Данные для сохранения
     :param fileName: Имя файла
     */
    function saveJSONToFile(data, fileName) {
        const blob = new Blob([JSON.stringify(data, null, 2)], {type: "application/json"});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fileName || "export.json";
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            a.remove();
            URL.revokeObjectURL(a.href);
        }, 120);
    }

    /**
     Импортировать настройки из выбранного файла с уникализацией промптов

     @param onImport Функция (data:Object) для загрузки настроек
     */
    function importFromFile(onImport) {
        const input = document.createElement('input');
        input.type = "file";
        input.accept = ".json,application/json";
        input.style.display = "none";
        input.addEventListener('change', function () {
            if (input.files && input.files.length > 0) {
                const file = input.files[0];
                const reader = new FileReader();
                reader.onload = function (e) {
                    try {
                        let raw = e.target.result;
                        if (raw instanceof ArrayBuffer) {
                            raw = new TextDecoder().decode(raw);
                        }
                        let imported;
                        try {
                            imported = JSON.parse(raw);
                        } catch (err) {
                            alert("Ошибка разбора JSON файла: " + err);
                            return;
                        }

                        // Оставляем только ключи из DEFAULT_SETTINGS
                        const cleanImported = {};
                        Object.keys(DEFAULT_SETTINGS).forEach(k => {
                            if (imported[k] != null) cleanImported[k] = imported[k];
                        });

                        // Получаем текущие настройки
                        let settings = loadSettings();
                        let merged = {...settings};

                        // Обрабатываем prompts
                        if (Array.isArray(cleanImported.prompts)) {
                            const currentPrompts = Array.isArray(settings.prompts) ? settings.prompts : [];
                            // Карта для проверки существующих prompt и title
                            const existingPromptsMap = new Map();
                            const existingTitlesCount = {};

                            // Собираем уже существующие prompt и title
                            currentPrompts.forEach(p => {
                                existingPromptsMap.set((p.prompt || '').trim(), true);
                                const t = (p.title || '').trim();
                                if (t) {
                                    if (!existingTitlesCount[t]) existingTitlesCount[t] = 1;
                                    else existingTitlesCount[t]++;
                                }
                            });

                            // Уникализируем и добавляем новые промпты
                            const promptsToAdd = [];
                            cleanImported.prompts.forEach(newPr => {
                                const basePrompt = (newPr.prompt || '').trim();
                                const baseTitle = (newPr.title || '').trim();

                                // Проверяем duplicate prompt
                                if (existingPromptsMap.has(basePrompt)) return;

                                // Проверяем duplicate title и уникализируем
                                let title = baseTitle;
                                let num = (existingTitlesCount[title] || 0) + 1;
                                while (currentPrompts.concat(promptsToAdd).some(p => (p.title || '').trim() === title)) {
                                    title = baseTitle + "_" + num;
                                    num++;
                                }
                                existingTitlesCount[baseTitle] = (existingTitlesCount[baseTitle] || 0) + 1;

                                promptsToAdd.push({
                                    ...newPr,
                                    id: 'p_' + Math.random().toString(36).slice(2, 12) + "_" + Date.now(),
                                    title: title
                                });
                                existingPromptsMap.set(basePrompt, true);
                            });

                            merged.prompts = [...currentPrompts, ...promptsToAdd];
                        }

                        // Остальные настройки, кроме prompts
                        Object.keys(DEFAULT_SETTINGS).forEach(k => {
                            if (k !== 'prompts' && cleanImported[k] != null) {
                                merged[k] = cleanImported[k];
                            }
                        });

                        // Автоматически обновляем форму настроек
                        setTimeout(() => onImport(merged), 10);

                    } catch (err) {
                        alert("Ошибка импорта настроек: " + err);
                    }
                };
                reader.readAsText(file);
            }
        });
        document.body.appendChild(input);
        input.click();
        setTimeout(() => input.remove(), 5000);
    }

    /**
     Создаёт строку с кнопками сброса, экспорта и импорта для настроек.
     Сохраняет и обновляет настройки сразу после изменений.

     :param formActionsRow: DOM-элемент строки для размещения кнопок (например, actions или отдельный div)
     :param setSettingsForm: Функция для отображения новых настроек в форме
     */
    function addSettingsUtilityButtons(formActionsRow, setSettingsForm) {
        const btnReset = createButton({
            text: 'Сброс ...',
            onClick: function (e) {
                e.preventDefault();
                const rect = btnReset.getBoundingClientRect();
                showContextMenuUniversal(
                    rect.left, rect.bottom,
                    [
                        {
                            label: 'Сбросить промпты',
                            onClick: () => {
                                log('Settings modal: reset PROMPTS');
                                const last = loadSettings();
                                const newSettings = {
                                    ...last,
                                    prompts: DEFAULT_PROMPTS
                                };
                                setSettingsForm(newSettings);
                            }
                        },
                        {
                            label: 'Сбросить остальные настройки',
                            onClick: () => {
                                log('Settings modal: reset PREFS');
                                const last = loadSettings();
                                const newSettings = {
                                    ...DEFAULT_SETTINGS,
                                    prompts: last.prompts
                                };
                                setSettingsForm(newSettings);
                            }
                        },
                        null,
                        {
                            label: 'Сбросить всё',
                            onClick: () => {
                                log('Settings modal: reset ALL');
                                setSettingsForm(DEFAULT_SETTINGS);
                            }
                        }
                    ]
                );
            }
        });
        btnReset.className = 'modal-btn reset';
        formActionsRow.appendChild(btnReset);

        const btnExport = createButton({
            text: 'Экспорт ...',
            onClick: function (e) {
                e.preventDefault();
                const rect = btnExport.getBoundingClientRect();
                const settings = loadSettings();
                const prompts = Array.isArray(settings.prompts) ? settings.prompts : [];
                const prefs = {};
                Object.keys(DEFAULT_SETTINGS).forEach(k => {
                    if (k !== 'prompts') prefs[k] = settings[k];
                });
                showContextMenuUniversal(rect.left, rect.bottom, [
                    {
                        label: 'Экспорт промптов',
                        onClick: () => {
                            saveJSONToFile({prompts}, 'yts_prompts.json');
                        }
                    },
                    {
                        label: 'Экспорт настроек',
                        onClick: () => {
                            saveJSONToFile(prefs, 'yts_settings.json');
                        }
                    },
                    null,
                    {
                        label: 'Экспорт всего',
                        onClick: () => {
                            saveJSONToFile(settings, 'yts_full_export.json');
                        }
                    }
                ]);
            }
        });
        btnExport.className = 'modal-btn export';
        formActionsRow.appendChild(btnExport);

        const btnImport = createButton({
            text: 'Импорт',
            onClick: function () {
                importFromFile(setSettingsForm);
            }
        });
        btnImport.className = 'modal-btn import';
        formActionsRow.appendChild(btnImport);

        const btnSave = createButton({text: 'Сохранить'});
        btnSave.className = 'modal-btn save';
        btnSave.type = 'submit';
        formActionsRow.appendChild(btnSave);
    }

    /**
     * Модальное окно настроек
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

            const promptBlock = document.createElement('div');
            promptBlock.className = 'prompt-list-block';
            promptBlock.id = 'prompt-list-block';

            function makeRow(labelText, inputId, inputType, placeholder = "", inputProps = {}) {
                const row = document.createElement('div');
                row.style.display = "flex";
                row.style.gap = "7px";
                row.style.alignItems = "center";
                row.style.marginBottom = "6px";

                const label = document.createElement("label");
                label.textContent = labelText;
                label.htmlFor = inputId;
                label.style.flex = "0 0 auto";
                label.style.minWidth = "155px";
                row.appendChild(label);

                const input = document.createElement('input');
                input.type = inputType;
                input.placeholder = placeholder || "";
                input.id = inputId;
                input.style.flex = "1 1 0%";
                for (let k in inputProps) input[k] = inputProps[k];
                row.appendChild(input);

                return {row, input, label};
            }

            const settingRows = [];
            settingRows.push(makeRow('API URL (LLM):', 'yts-setting-url', 'text', '', {}));
            settingRows.push(makeRow('Bearer-токен (для API):', 'yts-setting-token', 'password', '', {autocomplete: 'off'}));
            settingRows.push(makeRow('Таймаут ответа (мс):', 'yts-setting-timeout', 'number', '', {
                min: 10000,
                step: 1000
            }));

            const modelRow = document.createElement('div');
            modelRow.style.display = "flex";
            modelRow.style.gap = "7px";
            modelRow.style.marginBottom = "6px";

            const modelLabel = document.createElement("label");
            modelLabel.textContent = "Модель:";
            modelLabel.htmlFor = "yts-setting-model";
            modelLabel.style.flex = "0 0 auto";
            modelLabel.style.minWidth = "155px";
            modelRow.appendChild(modelLabel);

            const modelInput = document.createElement('input');
            modelInput.type = "text";
            modelInput.placeholder = "";
            modelInput.id = "yts-setting-model";
            modelInput.style.flex = "1 1 0%";
            modelRow.appendChild(modelInput);

            const modelBtn = document.createElement('button');
            modelBtn.type = 'button';
            modelBtn.title = 'Получить список моделей с сервера';
            modelBtn.className = 'prompt-btn model-select-btn';
            modelBtn.textContent = "▼";
            modelBtn.addEventListener('click', async function () {
                modelBtn.disabled = true;
                modelBtn.title = "Загрузка...";
                const apiUrl = q("#yts-setting-url").value;
                const apiToken = q("#yts-setting-token").value;
                try {
                    if (!apiUrl) {
                        alert("Укажите API URL");
                        return;
                    }
                    if (!apiToken) {
                        alert("Укажите Bearer-токен");
                        return;
                    }
                    const models = await fetchLLMModels(apiUrl, apiToken);

                    if (!models.length) {
                        alert("Сервер не вернул ни одной модели");
                        return;
                    }
                    showModelsSelectModal(models, m => {
                        modelInput.value = m;
                        setTimeout(applyValidation, 14);
                    });
                } catch (e) {
                    alert("Ошибка получения моделей: " + (e.message || e));
                } finally {
                    modelBtn.disabled = false;
                    modelBtn.title = "Получить список моделей";
                }
            });
            modelRow.appendChild(modelBtn);

            const actions = document.createElement('div');
            actions.className = 'modal-actions';

            addSettingsUtilityButtons(actions, setSettingsForm);

            form.appendChild(promptBlock);

            for (let r of settingRows) form.appendChild(r.row);
            form.appendChild(modelRow);

            form.appendChild(actions);

            form.onsubmit = function (e) {
                e.preventDefault();
                const rows = promptBlock.querySelectorAll('.prompt-block-row');
                const prompts = [];
                for (let row of rows) {
                    const id = row.dataset.id || genPromptId();
                    const t = row.querySelector('.prompt-input-title').value.trim();
                    const p = row.querySelector('.prompt-input-prompt').value;
                    if (t && p) prompts.push({id, title: t, prompt: p});
                }
                let settings = loadSettings();
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
                setTimeout(updateUIAfterPromptChange, 50);
            };


            const messageInfo = document.createElement('div');
            messageInfo.className = 'modal-message-info';

            modalInner.append(closeBtn, title, form, messageInfo);
            modal.appendChild(modalInner);
            document.body.appendChild(modal);
            log('Settings modal created');
        }
        setSettingsForm(loadSettings());
        modal.style.display = 'block';
        q(`#${MODAL_ID} .prompt-input-title`)?.focus();
    }

    /**
     Улучшенная справка по промптам и плейсхолдерам ― оформление таблицами, стилизация

     @return
     */
    function showPromptDocsModal() {
        let modal = document.getElementById(PROMPT_DOC_MODAL_ID);

        if (!modal) {
            modal = document.createElement('div');
            modal.id = PROMPT_DOC_MODAL_ID;

            const modalInner = document.createElement('div');
            modalInner.className = 'modal-inner';

            // === Верхний фиксированный блок с заголовком и кнопкой закрытия ===
            const topBar = document.createElement('div');
            topBar.className = 'modal-topbar';

            const title = document.createElement('div');
            title.className = 'modal-title';
            title.textContent = 'Справка: промпты и плейсхолдеры';

            const closeBtn = createButton({
                text: '×',
                onClick: () => {
                    modal.style.display = 'none';
                }
            });
            closeBtn.className = 'modal-close';
            closeBtn.title = 'Закрыть';

            topBar.appendChild(title);
            topBar.appendChild(closeBtn);

            const modalContent = document.createElement('div');
            modalContent.className = 'modal-doc-content';

            const instruction = document.createElement('div');
            instruction.style.fontSize = '15px';
            instruction.style.marginBottom = '10px';
            instruction.style.marginTop = '8px';

            const intro1 = document.createElement('p');
            intro1.textContent =
                'Промпт — это шаблон для LLM (ChatGPT/Claude и др.), ' +
                'где вы используете специальные переменные (плейсхолдеры) для подстановки реальных данных о видео: субтитров, заголовка, описания и других метаданных.';

            const instructionsList = document.createElement('ul');
            const instructions = [
                {text: 'Каждый плейсхолдер заменяется на соответствующее значение из текущего видео.'},
                {
                    text: 'Плейсхолдеры записываются в формате ',
                    bold: '{{название}}',
                    after: ' — например, ',
                    bold2: '{{title}}',
                    after2: '.'
                },
                {
                    text: 'Можно применять к плейсхолдерам цепочку операций через двоеточие: ',
                    bold: '{{название:операция1(...),операция2(...)}}',
                    after: ', все операции выполняются по порядку.'
                },
                {
                    text: 'Для сложных шаблонов используйте групповой плейсхолдер ',
                    bold: '{{videoData}}',
                    after: ', который выводит сразу все основные параметры видео.'
                },
                {
                    text: 'Гибко управляйте полями в ',
                    bold: '{{videoData}}',
                    after: ': можно перечислить только нужные (',
                    bold2: '{{videoData:+title,publishDate}}',
                    after2: '), или исключить некоторые (',
                    bold3: '{{videoData:-thumbnailUrl}}',
                    after3: ').'
                }
            ];
            instructions.forEach(item => {
                let li = document.createElement('li');
                if (item.text) li.appendChild(document.createTextNode(item.text));
                if (item.bold) {
                    let b = document.createElement('b');
                    b.textContent = item.bold;
                    li.appendChild(b);
                }
                if (item.after) li.appendChild(document.createTextNode(item.after));
                if (item.bold2) {
                    let b = document.createElement('b');
                    b.textContent = item.bold2;
                    li.appendChild(b);
                }
                if (item.after2) li.appendChild(document.createTextNode(item.after2));
                if (item.bold3) {
                    let b = document.createElement('b');
                    b.textContent = item.bold3;
                    li.appendChild(b);
                }
                if (item.after3) li.appendChild(document.createTextNode(item.after3));
                instructionsList.appendChild(li);
            });

            const phHeader = document.createElement('b');
            phHeader.style.display = "block";
            phHeader.style.marginTop = "12px";
            phHeader.textContent = 'Поддерживаемые плейсхолдеры:';

            const phTable = document.createElement('table');
            phTable.className = 'yts-doc-table';
            phTable.style.marginTop = '8px';
            phTable.style.marginBottom = '10px';

            const ph_trh = document.createElement('tr');
            const ph_th1 = document.createElement('th');
            ph_th1.textContent = 'Плейсхолдер';
            const ph_th2 = document.createElement('th');
            ph_th2.textContent = 'Значение';
            ph_trh.appendChild(ph_th1);
            ph_trh.appendChild(ph_th2);
            phTable.appendChild(ph_trh);

            [
                {code: '{{subtitlesText}}', desc: 'Текст всех субтитров (без таймкодов, одним блоком).'},
                {code: '{{subtitlesFull}}', desc: 'Субтитры с разметкой времени (таймкоды в начале каждой строки).'},
                {code: '{{title}}', desc: 'Название видео.'},
                {code: '{{shortDescription}}', desc: 'Короткое описание видео.'},
                {code: '{{publishDate}}', desc: 'Дата публикации.'},
                {code: '{{lengthSeconds}}', desc: 'Длительность видео в секундах.'},
                {code: '{{channelName}}', desc: 'Название канала.'},
                {code: '{{category}}', desc: 'Категория на YouTube.'},
                {code: '{{videoUrl}}', desc: 'Ссылка на видео.'},
                {code: '{{thumbnailUrl}}', desc: 'Ссылка на изображение превью.'},
                {code: '{{keywords}}', desc: 'Ключевые слова (список, через запятую).'},
                {code: '{{episodes}}', desc: 'Эпизоды с разметкой времени (таймкоды в начале каждой строки).'},
                {code: '{{videoData}}', desc: 'Все параметры видео списком вида "ключ: значение".'}
            ].forEach(ph => {
                const tr = document.createElement('tr');
                const td1 = document.createElement('td');
                td1.style.verticalAlign = 'top';
                td1.appendChild(document.createElement('code')).textContent = ph.code;
                const td2 = document.createElement('td');
                td2.style.verticalAlign = 'top';
                td2.textContent = ph.desc;
                tr.appendChild(td1);
                tr.appendChild(td2);
                phTable.appendChild(tr);
            });

            const opHeader = document.createElement('b');
            opHeader.style.display = "block";
            opHeader.style.marginTop = "8px";
            opHeader.textContent = 'Доступные операции для обработки значения:';

            const opTable = document.createElement('table');
            opTable.className = 'yts-doc-table';

            const trh = document.createElement('tr');
            const th1 = document.createElement('th');
            th1.textContent = 'Операция';
            const th2 = document.createElement('th');
            th2.textContent = 'Описание';
            trh.appendChild(th1);
            trh.appendChild(th2);
            opTable.appendChild(trh);

            [
                ['replace(a,b)', 'замена всех вхождений "a" на "b" в строке'],
                ['lower()', 'преобразовать в нижний регистр'],
                ['upper()', 'преобразовать в верхний регистр'],
                ['trim()', 'убрать пробелы по краям строки'],
                ['capitalize()', 'первая буква заглавная, остальные маленькие'],
                ['split(sep)', 'разбить строку на массив по разделителю'],
                ['join(sep)', 'объединить массив строк в строку через разделитель'],
                ['sort()', 'отсортировать массив'],
                ['length()', 'длина строки или массива'],
                ['slice(start,end)', 'получить часть строки или массива'],
            ].forEach(pair => {
                const tr = document.createElement('tr');
                const tdCode = document.createElement('td');
                tdCode.appendChild(document.createElement('code')).textContent = pair[0];
                const tdDesc = document.createElement('td');
                tdDesc.textContent = pair[1];
                tr.appendChild(tdCode);
                tr.appendChild(tdDesc);
                opTable.appendChild(tr);
            });

            const egHeader = document.createElement('b');
            egHeader.textContent = 'Примеры использования:';
            egHeader.style.display = "block";
            egHeader.style.marginTop = "16px";

            const egTable = document.createElement('table');
            egTable.className = 'yts-doc-table examples';

            const eg_trh = document.createElement('tr');
            const eg_th1 = document.createElement('th');
            eg_th1.textContent = 'Шаблон';
            const eg_th2 = document.createElement('th');
            eg_th2.textContent = 'Результат';
            eg_trh.appendChild(eg_th1);
            eg_trh.appendChild(eg_th2);
            egTable.appendChild(eg_trh);

            [
                {ex: '{{videoData:+title,publishDate}}', desc: 'только название видео и дата публикации'},
                {
                    ex: `{{keywords:split(","),sort(),slice(0,3),join(" / ")}}`,
                    desc: 'три первых ключевых слова в алфавитном порядке'
                },
                {ex: `{{title:replace(" ","_"),lower()}}`, desc: 'название видео, в нижнем регистре и без пробелов'}
            ].forEach(item => {
                const tr = document.createElement('tr');
                const tdEx = document.createElement('td');
                tdEx.appendChild(document.createElement('code')).textContent = item.ex;
                const tdDesc = document.createElement('td');
                tdDesc.textContent = item.desc;
                tr.appendChild(tdEx);
                tr.appendChild(tdDesc);
                egTable.appendChild(tr);
            });

            const note = document.createElement('div');
            note.style.marginTop = "16px";
            note.style.fontSize = "14px";
            let bTip = document.createElement('b');
            bTip.textContent = 'Совет: ';
            note.appendChild(bTip);
            note.appendChild(document.createTextNode('Используйте предпросмотр (👁️ в настройках промпта), чтобы увидеть, как данные подставляются в шаблон.'));

            instruction.appendChild(intro1);
            instruction.appendChild(instructionsList);

            // Вкладываем всё внутрь modalContent (только кроме closeBtn и title)
            modalContent.append(
                instruction,
                phHeader, phTable,
                opHeader, opTable,
                egHeader, egTable,
                note
            );

            modalInner.append(topBar, modalContent);
            modal.appendChild(modalInner);
            document.body.appendChild(modal);
        }
        modal.style.display = 'block';
    }

    /**
     * Показывает окно предпросмотра (проверки) промпта с подставленными переменными

     * @param {string} prompt Исходный промпт
     * @return {void}
     */
    function showPromptPreviewModalWithRealData(prompt) {
        /**
         * Отображает модальное окно предпросмотра промпта с реальными данными видео/субтитров

         * :param prompt: Текст промпта с плейсхолдерами
         * :return: Нет
         */
        let modal = document.getElementById(PROMPT_PREVIEW_MODAL_ID);
        let textarea;

        if (!modal) {
            modal = document.createElement('div');
            modal.id = PROMPT_PREVIEW_MODAL_ID;

            const modalInner = document.createElement('div');
            modalInner.className = 'modal-inner';

            const closeBtn = createButton({
                text: '×',
                onClick: () => {
                    modal.style.display = 'none';
                }
            });
            closeBtn.className = 'modal-close';
            closeBtn.title = 'Закрыть';

            const title = document.createElement('div');
            title.className = 'modal-title';
            title.textContent = 'Проверка промпта (реальные данные)';

            textarea = document.createElement('textarea');
            textarea.id = 'yts-preview-textarea';
            textarea.readOnly = true;

            modalInner.append(closeBtn, title, textarea);
            modal.appendChild(modalInner);
            document.body.appendChild(modal);
        } else {
            textarea = q('#yts-preview-textarea', modal);
        }

        textarea.value = 'Загрузка данных видео...';
        modal.style.display = 'block';
        textarea.focus();

        getVideoFullData()
            .then(vd => {
                textarea.value = replacePromptVars(prompt, vd || {});
            })
            .catch(e => {
                textarea.value = 'Ошибка получения данных:\n' + (e && e.message ? e.message : e);
            });
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
     * Валидация URL-адреса
     *
     * @param {string} url URL-адрес для проверки
     * @return {boolean} true, если URL валиден
     */
    function isValidURL(url) {
        if (typeof url !== 'string' || !url.trim()) return false;
        url = url.trim();
        // Только строгое начало и доменное имя, запрет пробелов
        const regex = /^(https?:\/\/)(([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}|localhost)(:\d+)?(\/.*)?$/;
        if (/\s/.test(url)) return false;
        return regex.test(url);
    }

    /**
     Проверяет отличие формы настроек от сохранённых и проводит валидацию, включая URL.

     :param prompts: Массив промптов
     :param url: API URL
     :param token: Токен LLM
     :param timeout: Таймаут в мс
     :param model: Модель LLM
     :return: {dirty: ..., error: ...}
     */
    function validateSettingsForm({
                                      prompts,
                                      url,
                                      token,
                                      timeout,
                                      model
                                  }) {
        // Базовая валидация — минимум 1 промпт, все поля промпта не пустые
        if (!Array.isArray(prompts) || prompts.length === 0) {
            return {dirty: true, error: "Требуется минимум один промпт"};
        }
        log(`Prompts: ${JSON.stringify(prompts)}`);
        const someEmptyPrompt = prompts.some(p => !p.title.trim() || !p.prompt.trim());
        log(`Some empty prompt: ${someEmptyPrompt}`);
        if (someEmptyPrompt) {
            return {dirty: true, error: "Все промпты должны иметь название и текст"};
        }

        // Валидация URL
        if (!isValidURL(url)) {
            return {dirty: true, error: "Некорректный URL"};
        }

        // Сравнение с сохранёнными (без deepEqual, только по соответствию)
        const settings = loadSettings();
        let dirty = false;
        if (!(Array.isArray(settings.prompts) && settings.prompts.length === prompts.length
            && settings.prompts.every((p, idx) =>
                p.id === prompts[idx].id &&
                p.title === prompts[idx].title &&
                p.prompt === prompts[idx].prompt))) {
            dirty = true;
        }
        if ((settings.url || "") !== (url || "")) dirty = true;
        if ((settings.token || "") !== (token || "")) dirty = true;
        if ((settings.model || "") !== (model || "")) dirty = true;
        if ((settings.timeout || 0) !== (timeout || 0)) dirty = true;

        return {dirty, error: ""};
    }

    /**
     Устанавливает стиль кнопки "Сохранить" по состоянию (dirty/error/обычное).
     */
    function setSaveBtnStatus(saveBtn, dirty, error) {
        /**
         Устанавливает оформление кнопки "Сохранить" по валидации

         :param saveBtn: DOM-элемент кнопки
         :param dirty: Были ли изменения
         :param error: Строка ошибки или ""
         */
        if (!saveBtn) return;
        const messageInfo = q('.modal-message-info');
        saveBtn.style.transition = "background 0.18s";
        if (error) {
            messageInfo.style.display = "block";
            messageInfo.style.background = "#911b1b";
            messageInfo.textContent = error;
            saveBtn.style.background = "#911b1b";
            saveBtn.style.color = "#fff";
            saveBtn.onmouseenter = function () {
                saveBtn.style.background = "#591414";
            };
            saveBtn.onmouseleave = function () {
                saveBtn.style.background = "#911b1b";
            };
            saveBtn.disabled = true;
            saveBtn.title = error;
        } else if (dirty) {
            messageInfo.style.display = "block";
            messageInfo.style.background = "#2f5b36";
            messageInfo.textContent = "Есть несохранённые изменения";
            saveBtn.style.background = "#2f5b36";
            saveBtn.style.color = "#fff";
            saveBtn.onmouseenter = function () {
                saveBtn.style.background = "#1e4124";
            };
            saveBtn.onmouseleave = function () {
                saveBtn.style.background = "#2f5b36";
            };
            saveBtn.disabled = false;
            saveBtn.title = "Сохранить изменения";
        } else {
            messageInfo.style.display = "none";
            messageInfo.style.background = "#4a4d4d";
            messageInfo.textContent = "Нет изменений";
            saveBtn.style.background = "";
            saveBtn.style.color = "";
            saveBtn.onmouseenter = null;
            saveBtn.onmouseleave = null;
            saveBtn.disabled = true;
            saveBtn.title = "Нет изменений";
        }
    }

    /**
     * Собирает текущее состояние полей настроек
     *
     * @return {object} Объект с настройками
     */
    function collectCurrentValues() {
        /**
         * Собирает текущие значения настроек формы
         *
         * @return {object} Текущее состояние всех полей (prompts, url, token, timeout, model)
         */
        const blockPrompts = document.querySelector(`#${MODAL_ID} #prompt-list-block`);
        const inputUrl = document.querySelector('#yts-setting-url');
        const inputToken = document.querySelector('#yts-setting-token');
        const inputTimeout = document.querySelector('#yts-setting-timeout');
        const inputModel = document.querySelector('#yts-setting-model');

        const prRows = blockPrompts ? blockPrompts.querySelectorAll('.prompt-block-row') : [];
        const arr = [];
        for (let row of prRows) {
            arr.push({
                id: row.dataset.id,
                title: row.querySelector('.prompt-input-title').value.trim(),
                prompt: row.querySelector('.prompt-input-prompt').value
            });
        }
        return {
            prompts: arr,
            url: inputUrl ? inputUrl.value : '',
            token: inputToken ? inputToken.value : '',
            timeout: inputTimeout ? parseInt(inputTimeout.value, 10) : 0,
            model: inputModel ? inputModel.value : ''
        };
    }

    /**
     * Применяет авто-валидацию и подсветку кнопки "Сохранить"
     */
    function applyValidation() {
        /**
         * Применяет авто-валидацию формы настроек и обновляет состояние кнопки "Сохранить"
         */
        const btnSaveHere = document.querySelector(`#${MODAL_ID} .modal-btn.save`);
        if (!btnSaveHere) return;
        const values = collectCurrentValues();
        const {dirty, error} = validateSettingsForm(values);
        setSaveBtnStatus(btnSaveHere, dirty, error);
    }

    /**
     * Заполнение формы настроек
     *
     * @param {object} args Настройки
     */
    function setSettingsForm({prompts, timeout, url, token, model}) {
        const promps = Array.isArray(prompts) && prompts.length
            ? prompts
            : [...DEFAULT_PROMPTS];
        const block = q(`#${MODAL_ID} #prompt-list-block`);
        while (block.firstChild) block.removeChild(block.firstChild);

        const headerDiv = document.createElement('div');
        headerDiv.className = 'prompt-list-header';

        const headerTitle = document.createElement('div');
        headerTitle.textContent = 'Промпты';
        headerTitle.className = 'prompt-list-header-title';
        headerDiv.appendChild(headerTitle);

        const headerBtns = document.createElement('div');
        headerBtns.className = 'prompt-list-header-btns';

        const btnInfo = createButton({
            text: "?",
            onClick: () => {
                showPromptDocsModal();
            }
        });
        btnInfo.type = 'button';
        btnInfo.className = 'prompt-btn about';
        btnInfo.style.fontWeight = '700';
        btnInfo.style.fontSize = '18px';
        btnInfo.style.color = '#fff';
        btnInfo.title = 'Справка по плейсхолдерам и промптам';
        headerBtns.appendChild(btnInfo);

        const btnAdd = document.createElement('button');
        btnAdd.type = 'button';
        btnAdd.className = 'prompt-btn add';
        btnAdd.title = 'Добавить промпт';
        btnAdd.textContent = '✚';
        btnAdd.onclick = function () {
            const rows = block.querySelectorAll('.prompt-block-row');
            const {block: newBlock, inputTitle} = makePromptRow({
                id: genPromptId(),
                title: '',
                prompt: ''
            }, rows.length, rows.length + 1, applyValidation);
            block.appendChild(newBlock);
            updatePromptDeleteButtons(block);
            setTimeout(() => {
                if (inputTitle) inputTitle.focus();
                block.scrollTop = block.scrollHeight;
            }, 10);
            setTimeout(applyValidation, 14);
        };
        headerBtns.appendChild(btnAdd);

        headerDiv.appendChild(headerBtns);
        block.appendChild(headerDiv);

        promps.forEach((pr, idx) => {
            const {block: promptRow} = makePromptRow(pr, idx, promps.length, applyValidation);
            block.appendChild(promptRow);
        });

        updatePromptDeleteButtons(block);

        q(`#yts-setting-timeout`).value = timeout || DEFAULT_SETTINGS.timeout;
        q(`#yts-setting-url`).value = url || DEFAULT_SETTINGS.url;
        q(`#yts-setting-token`).value = token || DEFAULT_SETTINGS.token;
        q(`#yts-setting-model`).value = model || DEFAULT_SETTINGS.model;

        // --- Подключение авто-валидации и подсветки кнопки "Сохранить" ---
        const blockPrompts = block;
        const btnSaveHere = q(`#${MODAL_ID} .modal-btn.save`);
        const formNode = q(`#${MODAL_ID} form`);

        if (btnSaveHere && formNode) {
            formNode.addEventListener('input', applyValidation, true);
            formNode.addEventListener('change', applyValidation, true);
            formNode.addEventListener('keyup', applyValidation, true);
            blockPrompts.addEventListener('DOMNodeInserted', applyValidation, true);
            blockPrompts.addEventListener('DOMNodeRemoved', applyValidation, true);
            setTimeout(applyValidation, 15);
        }
    }

    /**
     Создаёт строчку промпта с учетом автоматической валидации формы при удалении

     @param pr Объект промпта
     @param idx Индекс строки
     @param total Всего строк
     @param applyValidation Функция для запуска валидации (вызов setTimeout внутри если нужно)
     @return Объект с DOM-элементом и ссылками на важные элементы
     */
    function makePromptRow(pr, idx, total, applyValidation) {
        const block = document.createElement('div');
        block.className = 'prompt-block-row';
        block.dataset.id = pr.id;

        const row1 = document.createElement('div');
        row1.className = 'prompt-row prompt-row-1';

        const inputTitle = document.createElement('input');
        inputTitle.type = "text";
        inputTitle.placeholder = "Название действия";
        inputTitle.value = pr.title || '';
        inputTitle.className = 'prompt-input-title';
        inputTitle.style.flex = '1 1 0%';
        inputTitle.style.background = '#1a1a1a';
        row1.appendChild(inputTitle);

        const btnCheck = createButton({
            text: "👁️",
            onClick: () => {
                showPromptPreviewModalWithRealData(inputPrompt.value);
            }
        });
        btnCheck.type = 'button';
        btnCheck.className = 'prompt-btn check';
        btnCheck.title = 'Показать итоговый промпт с подставленными реальными переменными';
        row1.appendChild(btnCheck);

        const btnDel = document.createElement('button');
        btnDel.type = 'button';
        btnDel.className = 'prompt-btn remove';
        btnDel.textContent = '✖';
        btnDel.title = 'Удалить этот промпт';
        btnDel.disabled = total <= 1;
        btnDel.onclick = function () {
            if (btnDel.disabled) return;
            block.remove();
            const parent = block.parentElement;
            if (parent) updatePromptDeleteButtons(parent);
            log('Prompt row deleted');
            // Корректно вызвать валидацию
            if (typeof applyValidation === 'function') {
                setTimeout(applyValidation, 14);
            }
        };
        row1.appendChild(btnDel);

        const row2 = document.createElement('div');
        row2.className = 'prompt-row prompt-row-2';

        const inputPrompt = document.createElement('textarea');
        inputPrompt.className = 'prompt-input-prompt';
        inputPrompt.placeholder = "Текст промпта";
        inputPrompt.rows = 2;
        inputPrompt.value = pr.prompt;
        inputPrompt.style.flex = '1 1 0%';
        row2.appendChild(inputPrompt);

        block.appendChild(row1);
        block.appendChild(row2);

        return {block, inputTitle, inputPrompt};
    }


    /**
     * Преобразует строку времени в секунды (миллисекунды не учитываются),
     * а также возвращает отформатированное время для отображения (без часов, если они равны 00)
     *
     * @param timeStr Строка времени
     * @return Секунды и строка для показа
     */
    function timeStringToSecondsAndDisplay(timeStr) {
        const msMatch = timeStr.match(/(\d{2}:\d{2}(?::\d{2})?)(\.\d{1,4})?$/);

        const parts = msMatch[1].split(':');
        let h = 0, m = 0, s = 0;
        if (parts.length === 3) {
            h = Number(parts[0]);
            m = Number(parts[1]);
            s = Number(parts[2]);
        } else if (parts.length === 2) {
            m = Number(parts[0]);
            s = Number(parts[1]);
        }

        const totalSeconds = h * 3600 + m * 60 + s;

        // Строим строку для показа: не отображаем часы, если это 00
        let display;
        if (h > 0) {
            display = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        } else {
            display = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }

        return {seconds: totalSeconds, display};
    }

    /**
     * Вставляет ссылки на таймкод вместо текстовых меток [MM:SS], [HH:MM:SS], игнорируя миллисекунды в отображении и переходе.
     *
     * @param contentDiv DOM-элемент результата
     * @param text Исходный текст результата
     */
    function renderTimestampsWithLinks(contentDiv, text) {
        while (contentDiv.firstChild) contentDiv.removeChild(contentDiv.firstChild);

        const lines = text.split('\n');
        for (let idx = 0; idx < lines.length; idx++) {
            let line = lines[idx];
            // Паттерн: [MM:SS(.MS)] или [HH:MM:SS(.MS)] только в начале строки
            const regex = /^\[(\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,4})?)]\s*/;
            const m = line.match(regex);
            if (m) {
                const ts = m[1];
                const {seconds: sec, display} = timeStringToSecondsAndDisplay(ts);
                const link = document.createElement('a');
                link.href = 'javascript:void(0)';
                link.className = 'timestamp-link';
                link.textContent = display;
                link.addEventListener('click', function (e) {
                    e.preventDefault();
                    let player = document.querySelector('video');
                    if (player && typeof player.currentTime === 'number') {
                        player.currentTime = sec;
                        if (player.paused) {
                            player.play().catch(() => {
                            });
                        }
                        log('User clicked timestamp: jump to in-player', {seconds: sec});
                    } else {
                        const videoUrl = typeof globalVideoData !== "undefined" && globalVideoData && globalVideoData.videoUrl ? globalVideoData.videoUrl : location.href;
                        location.href = videoUrl.includes('?')
                            ? `${videoUrl}&t=${sec}`
                            : `${videoUrl}?t=${sec}`;
                        log('User clicked timestamp: go to video URL with offset', {url: location.href, seconds: sec});
                    }
                });
                contentDiv.appendChild(link);
                const after = line.slice(m[0].length);
                if (after.length) {
                    contentDiv.appendChild(document.createTextNode(after));
                }
            } else {
                contentDiv.appendChild(document.createTextNode(line));
            }
            if (idx !== lines.length - 1) {
                contentDiv.appendChild(document.createElement('br'));
            }
        }
    }

    /**
     * Потоковое обновление контента в результате
     *
     * @param {string} deltaText Текстовое обновление
     * @param {boolean} isComplete Флаг завершения
     */
    function updateResultContentStream(deltaText, isComplete) {
        const result_container = document.getElementById(RESULT_CONTAINER_ID);
        if (!result_container) {
            log('Result container not found for streaming update', null, 'warn');
            return;
        }
        let contentDiv = q('#yts-streaming-content', result_container);
        if (!contentDiv) {
            contentDiv = document.createElement('div');
            contentDiv.className = 'result-content';
            contentDiv.id = 'yts-streaming-content';
            result_container.appendChild(contentDiv);
        }
        if (!ytsPrintIsComplete && ytsPrintBuffer.length === 0 && !currentResult) currentResult = '';
        if (deltaText && typeof deltaText === 'string' && deltaText.length > 0) ytsPrintBuffer.push(deltaText);
        if (isComplete) ytsPrintIsComplete = true;
        if (ytsPrintTimer) return;
        appendCopyButtons(result_container);
        ytsPrintTimer = setInterval(() => {
            if (ytsPrintBuffer.length) {
                const piece = ytsPrintBuffer.shift();
                currentResult += piece;
                try {
                    renderTimestampsWithLinks(contentDiv, currentResult);
                } catch (err) {
                    log('Error rendering timestamps with links', err, 'error');
                }
                contentDiv.scrollTop = contentDiv.scrollHeight;
            } else if (ytsPrintIsComplete) {
                result_container.querySelector('.result-title').textContent = 'Готово';
                clearInterval(ytsPrintTimer);
                ytsPrintTimer = null;
                ytsPrintIsComplete = false;
                log('Streaming print buffer complete. User sees finished result');
            }
        }, 5);
    }

    /**
     * Выполняет LLM streaming fetch с помощью fetch, без инъектора
     *
     * @param {string} url URL эндпоинта
     * @param {object} opts Опции запроса (headers, body, method)
     * @param {function} onDelta Callback для каждой delta-строки (части)
     * @return {Promise<void>} Промис для завершения передачи
     */
    async function streamFetchLLM(url, opts, onDelta) {
        const requestInit = {
            ...('method' in opts ? {method: opts.method} : {}),
            ...('headers' in opts ? {headers: opts.headers} : {}),
            ...('body' in opts ? {body: opts.body} : {}),
        };

        log('Starting streaming fetch to LLM endpoint', {url, headers: requestInit.headers});
        const resp = await fetch(url, requestInit);
        if (!resp.body) {
            log('fetch: No streaming body supported by fetch', null, 'error');
            throw new Error('Нет поддержки стриминга у fetch');
        }
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
                    let d;
                    try {
                        d = JSON.parse(j);
                    } catch (err) {
                        log("Error parsing streaming data: not JSON", j, 'error');
                        throw new Error("Ошибка парсинга потока - Некорректный JSON: " + j);
                    }
                    if (d?.error?.message) {
                        log('API stream error field', d.error.message, 'error');
                        throw new Error(d.error.message);
                    }
                    if (d?.detail) {
                        log('API stream error detail', d.detail, 'error');
                        throw new Error(typeof d.detail === 'string' ? d.detail : JSON.stringify(d.detail));
                    }
                    content = d.choices?.[0]?.delta?.content || '';
                    if (content) {
                        await onDelta(content, false);
                    }
                }
            }
        }
        await onDelta('', true);
        log('Streaming fetch complete');
    }

    /**
     * Заменяет плейсхолдеры {{ключ:действие1(arg1),действие2(arg2)}} и варианты {{videoData:+key1,...}}, {{videoData:-key2,...}}
     * Поддерживает цепочку действий, аргументы функций могут содержать запятые и пробелы
     * Логирует заменённые ключи
     *
     * @param {string} template Шаблон
     * @param {object} data Объект с данными
     * @return {string} Строка с заменами
     */
    function replacePromptVars(template, data) {
        // Если это кастомный промпт, возвращаем его как есть
        if (data.customPrompt) {
            return data.customPrompt;
        }

        const replacedKeys = new Set();

        // Парсер цепочка действий вида action1(args),action2(args ...)
        function parseActions(actionsSpec) {
            const actions = [];
            let i = 0, l = actionsSpec.length, buf = '', depth = 0;
            while (i < l) {
                const ch = actionsSpec[i];
                if (ch === '(') {
                    depth++;
                    buf += ch;
                } else if (ch === ')') {
                    depth--;
                    buf += ch;
                } else if (ch === ',' && depth === 0) {
                    actions.push(buf.trim());
                    buf = '';
                } else {
                    buf += ch;
                }
                i++;
            }
            if (buf.trim()) actions.push(buf.trim());
            return actions;
        }

        // Парсер аргументов внутри (...), поддерживает скобки и кавычки
        function parseArgs(argStr) {
            // Удаляет внешний слой кавычек, если есть
            function unquote(s) {
                return typeof s === 'string' && /^(['"])(.*)\1$/.test(s) ? s.slice(1, -1) : s;
            }

            const args = [];
            let cur = '', l = argStr.length, i = 0, inQ = false, qChar = '', depth = 0;
            while (i < l) {
                let ch = argStr[i];
                if ((ch === '"' || ch === "'")) {
                    if (!inQ) {
                        inQ = true;
                        qChar = ch;
                    } else if (qChar === ch) {
                        inQ = false;
                    }
                    cur += ch;
                } else if (ch === '(' && !inQ) {
                    depth++;
                    cur += ch;
                } else if (ch === ')' && !inQ) {
                    if (depth > 0) {
                        depth--;
                        cur += ch;
                    } // else пропускаем, это завершающая скобка
                } else if (ch === ',' && !inQ && depth === 0) {
                    args.push(unquote(cur.trim()));
                    cur = '';
                } else {
                    cur += ch;
                }
                i++;
            }
            if (cur.trim()) args.push(unquote(cur.trim()));
            return args;
        }

        // {{videoData}} (+ support :+keys and :-keys)
        template = template.replace(
            /{{\s*videoData\s*(?::\s*([+-][a-zA-Z0-9_,\s]+))?\s*}}/g,
            (_match, argList) => {
                let keys;
                if (!argList) {
                    keys = Object.keys(data);
                } else if (argList.startsWith('-')) {
                    // Исключения
                    const excluded = argList
                        .slice(1)
                        .split(',')
                        .map(s => s.trim())
                        .filter(Boolean);
                    keys = Object.keys(data).filter(k => !excluded.includes(k));
                } else if (argList.startsWith('+')) {
                    // Только определённые ключи
                    keys = argList
                        .split(',')
                        .map(s => s.trim().replace(/^\+/, ''))
                        .filter(Boolean)
                        .filter(k => Object.prototype.hasOwnProperty.call(data, k));
                } else {
                    keys = Object.keys(data);
                }
                keys.forEach(key => replacedKeys.add(key));
                return keys.map(
                    key => `${key}: ${data[key]}`
                ).join('\n');
            }
        );

        // {{key}}, {{key:action(args),action2(args)}}
        template = template.replace(
            /{{\s*([a-zA-Z0-9_]+)(?::([^{}]*))?\s*}}/g,
            (_match, key, actionsSpec) => {
                if (key === 'videoData') return _match;

                if (!Object.prototype.hasOwnProperty.call(data, key) || data[key] === undefined) return _match;
                let value = data[key];
                replacedKeys.add(key);

                if (actionsSpec) {
                    const actions = parseActions(actionsSpec);
                    for (let actionRaw of actions) {
                        const actionMatch = actionRaw.match(/^([a-zA-Z_][a-zA-Z_0-9]*)\((.*)\)$/) || [null, actionRaw.trim()];
                        const func = actionMatch[1];
                        const argStr = actionMatch[2];

                        switch (func) {
                            case 'replace': {
                                let [searchValue, replaceValue] = parseArgs(argStr || '');
                                if (typeof value === "string" && typeof searchValue !== 'undefined' && typeof replaceValue !== 'undefined')
                                    value = value.replaceAll(searchValue, replaceValue);
                                break;
                            }
                            case 'lower': {
                                if (typeof value === "string") value = value.toLowerCase();
                                break;
                            }
                            case 'upper': {
                                if (typeof value === "string") value = value.toUpperCase();
                                break;
                            }
                            case 'trim': {
                                if (typeof value === "string") value = value.trim();
                                break;
                            }
                            case 'capitalize': {
                                if (typeof value === "string" && value.length)
                                    value = value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
                                break;
                            }
                            case 'split': {
                                let [sep] = parseArgs(argStr || ',');
                                if (typeof value === "string") value = value.split(sep);
                                break;
                            }
                            case 'join': {
                                let [sep] = parseArgs(argStr || ',');
                                if (Array.isArray(value)) value = value.join(sep);
                                break;
                            }
                            case 'sort': {
                                if (Array.isArray(value)) value = [...value].sort();
                                break;
                            }
                            case 'length': {
                                value = (Array.isArray(value) || typeof value === "string") ? value.length : '';
                                break;
                            }
                            case 'slice': {
                                let [start, end] = parseArgs(argStr || '');
                                let nStart = parseInt(start), nEnd = end !== undefined ? parseInt(end) : undefined;
                                if (Array.isArray(value)) {
                                    value = (typeof nEnd !== 'undefined' && !isNaN(nEnd)) ?
                                        value.slice(nStart, nEnd) : value.slice(nStart);
                                } else if (typeof value === "string") {
                                    value = (typeof nEnd !== 'undefined' && !isNaN(nEnd)) ?
                                        value.slice(nStart, nEnd) : value.slice(nStart);
                                }
                                break;
                            }
                            default:
                                break;
                        }
                    }
                }
                if (Array.isArray(value)) value = value.join(',');

                return String(value);
            }
        );

        if (replacedKeys.size > 0) {
            log('Prompt replace: variables replaced', Array.from(replacedKeys));
        }

        return template;
    }

    /**
     * Отправка запроса в LLM API, с потоковой обработкой delta'ов
     *
     * @param {object} videoData Видео-данные
     * @return {Promise<any>} Промис результата
     */
    function sendToAPI(videoData) {
        return new Promise(async (resolve, reject) => {
            const settings = loadSettings();
            const promptObj = settings.prompts.find(p => p.id === settings.activePromptId) || settings.prompts[0];
            const prompt = replacePromptVars(promptObj?.prompt || '', videoData);
            const requestData = {
                model: settings.model || "gpt-4.1-nano",
                messages: [{role: "user", content: prompt}],
                stream: true
            };
            const TIMEOUT = settings.timeout || 180000;
            log('Sending request to LLM API', {
                url: settings.url,
                model: settings.model,
                timeout: TIMEOUT,
                promptTitle: promptObj?.title,
                prompt: prompt
            });
            let timeoutId = setTimeout(() => {
                showError('Превышено время ожидания ответа от API (' + Math.floor(TIMEOUT / 1000) + ' секунд)');
                log('API request timed out', null, 'error');
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
                            log('Streaming complete, all results received');
                            resolve();
                        }
                    }
                );
            } catch (err) {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeoutId);
                    log('Stream/LLM API error', err, 'error');
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
        const settings = loadSettings();

        // Если выбран кастомный промпт, показываем окно ввода
        if (settings.activePromptId === 'custom') {
            showCustomPromptModal();
            return;
        }

        log('Starting prompt action...');
        if (ytsPrintTimer) {
            clearInterval(ytsPrintTimer);
            ytsPrintTimer = null;
            log('Cleared previous print timer');
        }
        ytsPrintBuffer = [];
        ytsPrintIsComplete = false;
        ytsErrorAlreadyShown = false;
        currentResult = "";

        restoreResultContainer();
        await createOrUpdateResultContainer(true);
        log('Prompt action: started streaming generation');
        try {
            globalVideoData = await getVideoFullData();
            await sendToAPI(globalVideoData);
            log('Prompt action complete, summary received');
        } catch (error) {
            log('Prompt action failed', error, 'error');
            showError(error.message || 'Ошибка при обработке запроса');
        }
    }

    /**
     * Добавить кнопку действия на страницу (по умолчанию отключена до полной инициализации)
     */
    function addButton() {
        waitForElement(TARGET_BUTTON_ELEMENT).then((buttonContainer) => {
            if (!buttonContainer) {
                log('Button container not found. Could not add main action button', null, 'warn');
                return;
            }
            if (!q(`#${BTN_ID}`)) {
                // noinspection JSUnusedGlobalSymbols
                const summaryButton = createButton({
                    id: BTN_ID,
                    text: getActivePrompt().title || 'Генерировать',
                    onClick: performPromptedAction,
                    onContextMenu: function (evt) {
                        evt.preventDefault();
                        showContextMenu(evt.clientX, evt.clientY);
                    }
                });
                summaryButton.className = 'yt-spec-button-shape-next--mono yt-spec-button-shape-next--tonal';
                buttonContainer.appendChild(summaryButton);
                log('Main action button added to UI', {text: summaryButton.textContent});
            } else {
                log('Main action button already exists, skipping creation');
            }
        });
        createContextMenu();
    }

    /**
     * Удалить UI (кнопка/контейнер)
     */
    function removeUI() {
        const btnExisted = !!q(`#${BTN_ID}`);
        const containerExisted = !!q(`#${RESULT_CONTAINER_ID}`);
        q(`#${BTN_ID}`)?.remove();
        q(`#${RESULT_CONTAINER_ID}`)?.remove();
        log('UI removed', {button: btnExisted, resultContainer: containerExisted});
    }

    /**
     * Проверить необходимость UI (только для страницы видео)
     */
    function checkButton() {
        log('Checking if summary button should be shown on current page', {path: location.pathname});
        if (location.pathname === '/watch') {
            addButton();
            q(`#${RESULT_CONTAINER_ID}`)?.remove();
        } else removeUI();
    }

    /**
     * Инициализация YTS плагина:
     * Вставка стилей, установка слушателей переходов, первичная отрисовка UI
     */
    function init() {
        injectStyles();
        log('Styles injected');
        const navHandler = debounce(checkButton, 150);
        window.addEventListener("yt-navigate-finish", navHandler);
        window.addEventListener("spfdone", navHandler);
        log('SPA navigation listeners added');
        setTimeout(() => {
            log('Initial checkButton call');
            navHandler();
        }, 0);
        log('Init complete');
    }

    if (document.readyState === "complete" || document.readyState === "interactive") {
        setTimeout(() => {
            init();
            log('DOMContentLoaded already complete/interactive: Plugin initialized immediately');
        }, 0);
    } else {
        document.addEventListener("DOMContentLoaded", () => {
            init();
            log('DOMContentLoaded event: Plugin initialized deferred');
        });
    }

    log(`Loaded: ${GM_info.script.name} v${GM_info.script.version} (${GM_info.scriptHandler} v${GM_info.version})`);

})();