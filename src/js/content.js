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

function fastHash(input) {
  var text = String(input || '');
  var hash = 0;
  for (var i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

function slugFromUrl(url) {
  var match = url.match(/\/problems\/([^/]+)\/?/);
  return match && match[1] ? match[1] : 'unknown-problem';
}

function isLikelyProblemPage() {
  return /leetcode\.com\/problems\//.test(window.location.href);
}

function sanitizeLanguageCandidate(text) {
  var candidate = String(text || '')
    .replace(/[\u25be\u25bc\u2304]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!candidate) {
    return '';
  }

  // Guard against accidentally capturing editor code as "language".
  if (
    candidate.length > 40 ||
    candidate.indexOf('\n') !== -1 ||
    /\b(def|class|return|function|SELECT|INSERT|UPDATE|DELETE)\b/.test(candidate)
  ) {
    return '';
  }

  return candidate;
}

function findLanguage() {
  var selectors = [
    'button[data-cy="lang-select"]',
    'div[data-cy="lang-select"]',
    '[id*="headlessui-listbox-button"]',
    '[class*="language-select"] button',
    '[class*="lang-select"] button',
    '.select-language',
    '[role="button"][data-testid="lang"]',
  ];

  var languageText = sanitizeLanguageCandidate(pickFirstText(selectors));

  if (!languageText || languageText === 'Unknown') {
    var monacoLangEl =
      document.querySelector('[class*="editor"] [class*="language"]') ||
      document.querySelector('[data-testid="language-selector"]') ||
      document.querySelector('[data-e2e-locator*="language"]');
    if (monacoLangEl && monacoLangEl.textContent) {
      languageText = sanitizeLanguageCandidate(monacoLangEl.textContent);
    }
  }

  if (!languageText) {
    var ariaLabelSources = document.querySelectorAll('[aria-label*="language" i]');
    for (var i = 0; i < ariaLabelSources.length; i += 1) {
      var ariaCandidate = sanitizeLanguageCandidate(
        ariaLabelSources[i].innerText || ariaLabelSources[i].textContent || ''
      );
      if (ariaCandidate) {
        languageText = ariaCandidate;
        break;
      }
    }
  }

  if (!languageText) {
    return 'Unknown';
  }

  return languageText;
}

function getSubmissionStatusFromPage() {
  var statusSelectors = [
    '[data-e2e-locator*="submission"]',
    '[data-e2e-locator*="result"]',
    '[class*="submission"]',
    '[class*="result"]',
    '[id*="submission"]',
    '[id*="result"]',
    '[aria-live="polite"]',
    '[role="status"]',
  ];

  var scopedTextParts = [];
  for (var i = 0; i < statusSelectors.length; i += 1) {
    var nodes = document.querySelectorAll(statusSelectors[i]);
    if (!nodes || !nodes.length) {
      continue;
    }
    for (var j = 0; j < nodes.length; j += 1) {
      var piece = normalizeText(nodes[j].innerText || nodes[j].textContent || '');
      if (piece) {
        scopedTextParts.push(piece.toLowerCase());
      }
    }
  }

  var statusText = scopedTextParts.join(' ');
  if (!statusText && document.body) {
    // Fallback if selectors miss due UI updates.
    statusText = normalizeText(document.body.innerText || '').toLowerCase();
  }

  if (!statusText) {
    return 'unknown';
  }

  var failedSignals = [
    'wrong answer',
    'time limit exceeded',
    'runtime error',
    'compile error',
    'memory limit exceeded',
    'output limit exceeded',
    'presentation error',
  ];

  for (var k = 0; k < failedSignals.length; k += 1) {
    if (statusText.indexOf(failedSignals[k]) !== -1) {
      return 'failed';
    }
  }

  if (statusText.indexOf('all test cases passed') !== -1) {
    return 'accepted';
  }

  if (statusText.indexOf('accepted') !== -1 && statusText.indexOf('acceptance rate') === -1) {
    return 'accepted';
  }

  var acceptedRegex = /\baccepted\b(?!\s*rate)/i;
  var acceptanceRegex = /\bacceptance\b/i;
  var acceptedWithContext =
    /\baccepted\b[^]{0,140}\b(runtime|memory|beats|testcase|testcases|cases\s+passed)\b/i.test(
      statusText
    ) ||
    /\b(runtime|memory|beats|testcase|testcases|cases\s+passed)\b[^]{0,140}\baccepted\b/i.test(
      statusText
    );

  if (
    acceptedWithContext ||
    (acceptedRegex.test(statusText) && !acceptanceRegex.test(statusText))
  ) {
    return 'accepted';
  }

  return 'unknown';
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

var autoSaveState = {
  working: false,
  lastKey: '',
  armed: false,
  armedAt: 0,
  seenPendingAfterSubmit: false,
  preSubmitStatus: 'unknown',
  lastObservedStatus: 'unknown',
};

var AUTO_SAVE_DEBUG = true;

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

function debugAutoSave(stage, data) {
  if (!AUTO_SAVE_DEBUG) {
    return;
  }

  var payload = {
    source: 'content',
    stage: stage,
    details: data || {},
    at: new Date().toISOString(),
    url: window.location.href,
  };

  console.log('[leet-questions][autosave]', payload);
  runtimeSend({ type: 'autosaveDebug', payload: payload });
}

async function tryAutoSave() {
  if (autoSaveState.working || !autoSaveState.armed || !isLikelyProblemPage()) {
    return;
  }

  if (!autoSaveState.armedAt || Date.now() - autoSaveState.armedAt > 3 * 60 * 1000) {
    debugAutoSave('disarmed-timeout', {
      armedAt: autoSaveState.armedAt,
    });
    autoSaveState.armed = false;
    return;
  }

  var pageText = normalizeText(document.body ? document.body.innerText : '').toLowerCase();
  var looksPending =
    pageText.indexOf('submitting') !== -1 ||
    pageText.indexOf('judging') !== -1 ||
    pageText.indexOf('running') !== -1;
  if (looksPending) {
    autoSaveState.seenPendingAfterSubmit = true;
  }

  var currentStatus = getSubmissionStatusFromPage();
  if (currentStatus !== autoSaveState.lastObservedStatus) {
    autoSaveState.lastObservedStatus = currentStatus;
    debugAutoSave('status-changed', {
      status: currentStatus,
      seenPendingAfterSubmit: autoSaveState.seenPendingAfterSubmit,
      preSubmitStatus: autoSaveState.preSubmitStatus,
    });
  }

  if (currentStatus === 'failed') {
    // Wrong/failed submissions should not be saved.
    debugAutoSave('disarmed-failed', {
      preSubmitStatus: autoSaveState.preSubmitStatus,
    });
    autoSaveState.armed = false;
    return;
  }

  if (currentStatus !== 'accepted') {
    return;
  }

  // Avoid stale "Accepted" state from a previous run. We require
  // that either a pending phase was observed or the pre-submit state
  // was not already accepted.
  if (
    !autoSaveState.seenPendingAfterSubmit &&
    autoSaveState.preSubmitStatus === 'accepted' &&
    Date.now() - autoSaveState.armedAt < 120000
  ) {
    debugAutoSave('skip-stale-accepted', {
      preSubmitStatus: autoSaveState.preSubmitStatus,
      seenPendingAfterSubmit: autoSaveState.seenPendingAfterSubmit,
      ageMs: Date.now() - autoSaveState.armedAt,
    });
    return;
  }

  autoSaveState.working = true;
  try {
    var payload = await getProblemData();
    if (!payload || !payload.ok) {
      debugAutoSave('collect-failed', {
        payloadOk: Boolean(payload && payload.ok),
      });
      return;
    }

    var dedupeKey = [
      payload.data.slug,
      payload.data.language,
      fastHash(payload.data.code || ''),
    ].join('|');
    if (dedupeKey === autoSaveState.lastKey) {
      debugAutoSave('skip-duplicate', {
        slug: payload.data.slug,
        language: payload.data.language,
      });
      return;
    }

    autoSaveState.lastKey = dedupeKey;
    payload.data.autoTriggered = true;
    payload.data.submissionAccepted = true;
    debugAutoSave('save-start', {
      slug: payload.data.slug,
      language: payload.data.language,
      codeLength: (payload.data.code || '').length,
    });
    var response = await runtimeSend({ type: 'saveProblemToGithub', payload: payload.data });
    if (!response || !response.ok) {
      debugAutoSave('save-failed', {
        error: response && response.error ? response.error : 'Unknown save error',
      });
      console.warn(
        'Auto-save failed:',
        response && response.error ? response.error : 'Unknown save error'
      );

      if (
        response &&
        response.error &&
        /manual save is disabled|not accepted|no solution code detected|unsupported language/i.test(
          response.error
        )
      ) {
        autoSaveState.armed = false;
      }
      return;
    }

    debugAutoSave('save-success', {
      readmePath: response.result ? response.result.readmePath : null,
      codePath: response.result ? response.result.codePath : null,
    });
    autoSaveState.armed = false;
  } catch (error) {
    debugAutoSave('save-exception', {
      error: error && error.message ? error.message : String(error),
    });
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
        autoSaveState.armedAt = Date.now();
        autoSaveState.seenPendingAfterSubmit = false;
        autoSaveState.preSubmitStatus = getSubmissionStatusFromPage();
        autoSaveState.lastObservedStatus = autoSaveState.preSubmitStatus;
        debugAutoSave('submit-armed-click', {
          preSubmitStatus: autoSaveState.preSubmitStatus,
        });
      }
    },
    true
  );

  document.addEventListener(
    'keydown',
    function (event) {
      if (!isLikelyProblemPage()) {
        return;
      }

      var isSubmitShortcut = (event.ctrlKey || event.metaKey) && event.key === 'Enter';
      if (!isSubmitShortcut) {
        return;
      }

      autoSaveState.armed = true;
      autoSaveState.armedAt = Date.now();
      autoSaveState.seenPendingAfterSubmit = false;
      autoSaveState.preSubmitStatus = getSubmissionStatusFromPage();
      autoSaveState.lastObservedStatus = autoSaveState.preSubmitStatus;
      debugAutoSave('submit-armed-shortcut', {
        preSubmitStatus: autoSaveState.preSubmitStatus,
      });
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
