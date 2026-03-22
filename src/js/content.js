function pickFirstText(selectors) {
  for (var i = 0; i < selectors.length; i += 1) {
    var el = document.querySelector(selectors[i]);
    if (el && el.textContent && el.textContent.trim()) {
      return el.textContent.trim();
    }
  }
  return '';
}

function normalizeText(input) {
  return String(input || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getQueryParam(key) {
  var encoded = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var query = window.location.search || '';
  var match = query.match(new RegExp('[?&]' + encoded + '=([^&#]+)'));
  return match && match[1] ? decodeURIComponent(match[1]) : '';
}

function slugFromUrl(url) {
  var match = url.match(/\/problems\/([^/]+)\/?/);
  return match && match[1] ? match[1] : 'unknown-problem';
}

function isLikelyProblemPage() {
  return /leetcode\.com\/problems\//.test(window.location.href);
}

function findLanguage() {
  var languageText = pickFirstText([
    'button[data-cy="lang-select"]',
    'div[data-cy="lang-select"]',
    '[id*="headlessui-listbox-button"]',
    '[class*="language-select"] button',
    '[class*="lang-select"] button',
  ]);

  if (!languageText) {
    return 'Unknown';
  }

  return languageText.replace(/\s+/g, ' ').trim();
}

function findDifficulty() {
  var difficultyText = pickFirstText([
    '[data-difficulty="EASY"]',
    '[data-difficulty="MEDIUM"]',
    '[data-difficulty="HARD"]',
    'div.text-difficulty-easy',
    'div.text-difficulty-medium',
    'div.text-difficulty-hard',
    '[class*="text-difficulty"]',
  ]);

  var normalized = normalizeText(difficultyText).toLowerCase();
  if (normalized.indexOf('easy') !== -1) {
    return 'Easy';
  }
  if (normalized.indexOf('medium') !== -1) {
    return 'Medium';
  }
  if (normalized.indexOf('hard') !== -1) {
    return 'Hard';
  }

  return 'Unknown';
}

function findTitle() {
  var title = pickFirstText(['div.text-title-large a', '[data-cy="question-title"]', 'h1']);

  return normalizeText(title);
}

function extractCodeFromDom() {
  var fromTextarea = document.querySelector('textarea.inputarea');
  if (fromTextarea && fromTextarea.value && fromTextarea.value.trim()) {
    return fromTextarea.value;
  }

  var monacoLines = document.querySelectorAll('.view-lines .view-line');
  if (monacoLines && monacoLines.length) {
    var combined = '';
    for (var i = 0; i < monacoLines.length; i += 1) {
      combined += (monacoLines[i].innerText || '') + '\n';
    }
    if (combined.trim()) {
      return combined.trimEnd();
    }
  }

  var fromCodeBlock = document.querySelector('code');
  if (fromCodeBlock && fromCodeBlock.innerText && fromCodeBlock.innerText.trim()) {
    return fromCodeBlock.innerText;
  }

  return '';
}

async function getProblemData() {
  var url = window.location.href;
  if (!isLikelyProblemPage()) {
    return { ok: false, error: 'Not on a LeetCode problem page.' };
  }

  var title = findTitle();
  var difficulty = findDifficulty();

  var statementEl =
    document.querySelector('[data-track-load="description_content"]') ||
    document.querySelector('.elfjS') ||
    document.querySelector('div[data-key="description-content"]');

  var statement = '';
  if (statementEl && statementEl.innerText) {
    statement = statementEl.innerText.trim();
  }

  var code = extractCodeFromDom();

  return {
    ok: true,
    data: {
      title: title || slugFromUrl(url),
      slug: slugFromUrl(url),
      url: url,
      difficulty: difficulty,
      statement: statement || 'Statement was not detected on the current page.',
      language: findLanguage(),
      code: code || '',
      savedAt: new Date().toISOString(),
    },
  };
}

function maybeAcceptedOnPage() {
  if (!document.body) {
    return false;
  }

  var pageText = normalizeText(document.body.innerText).toLowerCase();
  if (!pageText) {
    return false;
  }

  return /(^|\s)accepted($|\s)/.test(pageText);
}

function hasFailedSubmissionOnPage() {
  if (!document.body) {
    return false;
  }

  var pageText = normalizeText(document.body.innerText).toLowerCase();
  if (!pageText) {
    return false;
  }

  var failures = [
    'wrong answer',
    'time limit exceeded',
    'runtime error',
    'compile error',
    'memory limit exceeded',
    'output limit exceeded',
  ];

  for (var i = 0; i < failures.length; i += 1) {
    if (pageText.indexOf(failures[i]) !== -1) {
      return true;
    }
  }

  return false;
}

var autoSaveState = {
  working: false,
  lastKey: '',
  armed: false,
};

function runtimeSend(message) {
  return new Promise(function (resolve) {
    chrome.runtime.sendMessage(message, function (response) {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || {});
    });
  });
}

async function tryAutoSave() {
  if (autoSaveState.working || !autoSaveState.armed || !isLikelyProblemPage()) {
    return;
  }

  if (hasFailedSubmissionOnPage()) {
    autoSaveState.armed = false;
    return;
  }

  if (!maybeAcceptedOnPage()) {
    return;
  }

  autoSaveState.working = true;
  try {
    var payload = await getProblemData();
    if (!payload || !payload.ok) {
      return;
    }

    var dedupeKey = [
      payload.data.slug,
      payload.data.language,
      (payload.data.code || '').length,
    ].join('|');
    if (dedupeKey === autoSaveState.lastKey) {
      return;
    }

    autoSaveState.lastKey = dedupeKey;
    payload.data.autoTriggered = true;
    var response = await runtimeSend({ type: 'saveProblemToGithub', payload: payload.data });
    if (!response || !response.ok) {
      console.warn(
        'Auto-save failed:',
        response && response.error ? response.error : 'Unknown save error'
      );
      return;
    }

    autoSaveState.armed = false;
  } catch (error) {
    console.warn('Auto-save failed:', error);
  } finally {
    autoSaveState.working = false;
  }
}

function isSubmitTrigger(target) {
  if (!target) {
    return false;
  }

  var element = target.closest('button, [role="button"]');
  if (!element) {
    return false;
  }

  var text = normalizeText(element.innerText || element.textContent).toLowerCase();
  if (!text) {
    return false;
  }

  return text === 'submit' || text.indexOf('submit') !== -1;
}

function startAcceptedWatcher() {
  if (!document.body) {
    return;
  }

  document.addEventListener(
    'click',
    function (event) {
      if (!isLikelyProblemPage()) {
        return;
      }

      if (isSubmitTrigger(event.target)) {
        autoSaveState.armed = true;
      }
    },
    true
  );

  var observer = new MutationObserver(function () {
    tryAutoSave();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  setInterval(function () {
    tryAutoSave();
  }, 2500);
}

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (!request || request.type !== 'collectProblemData') {
    return;
  }

  getProblemData()
    .then(function (payload) {
      sendResponse(payload);
    })
    .catch(function (error) {
      sendResponse({ ok: false, error: error.message || 'Failed to collect problem data.' });
    });

  return true;
});

if (isLikelyProblemPage()) {
  startAcceptedWatcher();
}
