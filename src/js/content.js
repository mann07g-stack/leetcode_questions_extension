function pickFirstText(selectors) {
  for (var i = 0; i < selectors.length; i += 1) {
    var el = null;
    try {
      el = document.querySelector(selectors[i]);
    } catch {
      continue;
    }
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

function getPushIconSvgMarkup() {
  return (
    '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M12 2l4 4h-3v7h-2V6H8l4-4zm-7 13h2v5h10v-5h2v7H5v-7z"></path>' +
    '</svg>'
  );
}

function findManualPushAnchor() {
  var selectors = [
    '[data-e2e-locator="console-submit-button"]',
    '[data-cy="submit-code-btn"]',
    'button[data-e2e-locator*="submit"]',
    'button:has(svg)',
  ];

  for (var i = 0; i < selectors.length; i += 1) {
    try {
      var node = document.querySelector(selectors[i]);
      if (node && node.parentElement) {
        return node.parentElement;
      }
    } catch {
      // Ignore invalid selector support issues in some pages.
    }
  }

  return null;
}

function setManualPushButtonState(state, message) {
  var btn = document.getElementById('leethubManualPushBtn');
  if (!btn) {
    return;
  }

  if (state === 'working') {
    btn.disabled = true;
    btn.style.opacity = '0.8';
    btn.style.borderColor = '#6ca7ff';
    btn.title = message || 'Pushing to GitHub...';
    return;
  }

  if (state === 'success') {
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.borderColor = '#40b36b';
    btn.title = message || 'Push successful';
    return;
  }

  if (state === 'error') {
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.borderColor = '#d9534f';
    btn.title = message || 'Push failed';
    return;
  }

  btn.disabled = false;
  btn.style.opacity = '1';
  btn.style.borderColor = 'rgba(130, 149, 197, 0.35)';
  btn.title = message || 'Push accepted solution to GitHub';
}

async function runManualPush() {
  setManualPushButtonState('working');

  try {
    var status = getSubmissionStatusFromPage();
    if (status !== 'accepted') {
      setManualPushButtonState('error', 'Latest result is not Accepted');
      debugAutoSave('manual-push-blocked', { status: status });
      return;
    }

    var payload = await getProblemData();
    if (!payload || !payload.ok || !payload.data) {
      setManualPushButtonState('error', 'Could not collect problem data');
      debugAutoSave('manual-push-collect-failed', {
        payloadOk: Boolean(payload && payload.ok),
      });
      return;
    }

    payload.data.autoTriggered = true;
    payload.data.submissionAccepted = true;

    var response = await runtimeSend({
      type: 'saveProblemToGithub',
      payload: payload.data,
    });

    if (!response || !response.ok) {
      setManualPushButtonState(
        'error',
        response && response.error ? response.error : 'Push failed'
      );
      debugAutoSave('manual-push-failed', {
        error: response && response.error ? response.error : 'Unknown push error',
      });
      return;
    }

    setManualPushButtonState('success', 'Accepted solution pushed');
    debugAutoSave('manual-push-success', {
      codePath: response.result ? response.result.codePath : null,
    });
  } catch (error) {
    setManualPushButtonState('error', error && error.message ? error.message : 'Push failed');
    debugAutoSave('manual-push-exception', {
      error: error && error.message ? error.message : String(error),
    });
  } finally {
    setTimeout(function () {
      setManualPushButtonState('idle');
    }, 2200);
  }
}

function ensureManualPushButton() {
  if (!isLikelyProblemPage()) {
    return;
  }

  var existing = document.getElementById('leethubManualPushBtn');
  if (existing) {
    return;
  }

  var anchor = findManualPushAnchor();
  if (!anchor) {
    return;
  }

  var btn = document.createElement('button');
  btn.id = 'leethubManualPushBtn';
  btn.type = 'button';
  btn.innerHTML = 'Push ' + getPushIconSvgMarkup();
  btn.style.display = 'inline-flex';
  btn.style.alignItems = 'center';
  btn.style.gap = '6px';
  btn.style.marginRight = '8px';
  btn.style.padding = '6px 10px';
  btn.style.borderRadius = '8px';
  btn.style.border = '1px solid rgba(130, 149, 197, 0.35)';
  btn.style.background = 'rgba(20, 35, 68, 0.92)';
  btn.style.color = '#e7efff';
  btn.style.fontSize = '12px';
  btn.style.cursor = 'pointer';
  btn.style.zIndex = '10';
  btn.title = 'Push accepted solution to GitHub';
  btn.addEventListener('click', function () {
    runManualPush().catch(function (error) {
      debugAutoSave('manual-push-handler-error', {
        error: error && error.message ? error.message : String(error),
      });
    });
  });

  anchor.insertBefore(btn, anchor.firstChild);
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
    var ariaLabelSources = [];
    try {
      ariaLabelSources = document.querySelectorAll(
        '[aria-label*="language"], [aria-label*="Language"], [aria-label*="LANGUAGE"]'
      );
    } catch {
      ariaLabelSources = [];
    }
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

function getCookieValue(name) {
  var escapedName = String(name || '').replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
  var match = document.cookie.match(new RegExp('(?:^|; )' + escapedName + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : '';
}

function htmlToText(html) {
  var source = String(html || '');
  if (!source) {
    return '';
  }
  try {
    var doc = new DOMParser().parseFromString(source, 'text/html');
    return normalizeText((doc.body && doc.body.innerText) || doc.documentElement.textContent || '');
  } catch {
    return normalizeText(source);
  }
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function fetchJsonWithSession(url, method, body) {
  var csrf = getCookieValue('csrftoken');
  var headers = {
    accept: 'application/json',
  };

  if (csrf) {
    headers['x-csrftoken'] = csrf;
    headers['x-requested-with'] = 'XMLHttpRequest';
  }

  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  var response = await fetch(url, {
    method: method || 'GET',
    credentials: 'include',
    headers: headers,
    referrer: window.location.origin + '/submissions/',
    referrerPolicy: 'strict-origin-when-cross-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    var error = new Error('HTTP ' + response.status);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

async function fetchProblemSubmissionsBySlug(slug) {
  var safeSlug = String(slug || '').trim();
  if (!safeSlug) {
    return [];
  }

  var paths = [
    '/api/submissions/' + safeSlug + '/?offset=0&limit=20',
    '/api/submissions/' + safeSlug + '?offset=0&limit=20',
  ];
  for (var i = 0; i < paths.length; i += 1) {
    try {
      var json = await fetchJsonWithSession(paths[i], 'GET');
      var dump = Array.isArray(json && json.submissions_dump) ? json.submissions_dump : [];
      if (dump.length) {
        return dump;
      }
    } catch {
      // Try next path variant.
    }
  }

  return [];
}

async function fetchSubmissionListPageGraphql(offset, limit, lastKey) {
  var body = {
    operationName: 'submissionList',
    query:
      'query submissionList($offset: Int!, $limit: Int!, $lastKey: String) {' +
      ' submissionList(offset: $offset, limit: $limit, lastKey: $lastKey) {' +
      '   hasNext lastKey submissions {' +
      '     id title titleSlug statusDisplay lang timestamp' +
      '   }' +
      ' }' +
      '}',
    variables: {
      offset: Number(offset) || 0,
      limit: Number(limit) || 20,
      lastKey: lastKey || null,
    },
  };

  return fetchJsonWithSession('/graphql/', 'POST', body);
}

async function fetchAcceptedSubmissionIndexGraphql(upperBound) {
  var acceptedBySlug = {};
  var offset = 0;
  var limit = 20;
  var lastKey = null;
  var hasNext = true;
  var safety = 0;

  while (hasNext && offset < upperBound && safety < 600) {
    safety += 1;

    var json = await fetchSubmissionListPageGraphql(offset, limit, lastKey);
    var root = json && json.data ? json.data.submissionList : null;
    var submissions = Array.isArray(root && root.submissions) ? root.submissions : [];
    if (!submissions.length) {
      break;
    }

    for (var i = 0; i < submissions.length; i += 1) {
      var item = submissions[i] || {};
      var statusText = String(item.statusDisplay || item.status_display || '').toLowerCase();
      if (statusText !== 'accepted' && statusText !== 'ac') {
        continue;
      }

      var slug = String(item.titleSlug || item.title_slug || '').trim();
      if (!slug) {
        continue;
      }

      var previous = acceptedBySlug[slug];
      var currentTimestamp = Number(item.timestamp || 0);
      if (!previous || currentTimestamp > Number(previous.timestamp || 0)) {
        acceptedBySlug[slug] = {
          id: item.id,
          slug: slug,
          title: item.title || slug,
          timestamp: currentTimestamp,
          language: item.lang || '',
        };
      }
    }

    offset += submissions.length;
    hasNext = Boolean(root && root.hasNext);
    lastKey = root && root.lastKey ? root.lastKey : null;
    if (!hasNext && submissions.length < limit) {
      break;
    }

    await sleep(50);
  }

  return Object.keys(acceptedBySlug).map(function (slug) {
    return acceptedBySlug[slug];
  });
}

async function fetchAcceptedSubmissionIndexFallback(upperBound) {
  var acceptedBySlug = {};
  var json = await fetchJsonWithSession('/api/problems/all/', 'GET');
  var pairs = Array.isArray(json && json.stat_status_pairs) ? json.stat_status_pairs : [];
  var solved = [];

  for (var i = 0; i < pairs.length; i += 1) {
    var pair = pairs[i] || {};
    if (String(pair.status || '').toLowerCase() !== 'ac') {
      continue;
    }

    var stat = pair.stat || {};
    var slug = String(stat.question__title_slug || '').trim();
    if (!slug) {
      continue;
    }

    solved.push({
      slug: slug,
      title: stat.question__title || slug,
    });

    if (solved.length >= upperBound) {
      break;
    }
  }

  for (var j = 0; j < solved.length; j += 1) {
    var solvedEntry = solved[j];
    var submissions = await fetchProblemSubmissionsBySlug(solvedEntry.slug);
    for (var k = 0; k < submissions.length; k += 1) {
      var item = submissions[k] || {};
      if (String(item.status_display || '').toLowerCase() !== 'accepted') {
        continue;
      }

      var previous = acceptedBySlug[solvedEntry.slug];
      var ts = Number(item.timestamp || 0);
      if (!previous || ts > Number(previous.timestamp || 0)) {
        acceptedBySlug[solvedEntry.slug] = {
          id: item.id,
          slug: solvedEntry.slug,
          title: item.title || solvedEntry.title,
          timestamp: ts,
          language: item.lang || '',
        };
      }
    }

    await sleep(60);
  }

  return Object.keys(acceptedBySlug).map(function (slug) {
    return acceptedBySlug[slug];
  });
}

async function fetchAcceptedSubmissionIndex(maxToScan) {
  var limit = 20;
  var offset = 0;
  var upperBound = Number(maxToScan) > 0 ? Number(maxToScan) : 2000;
  var acceptedBySlug = {};

  try {
    while (offset < upperBound) {
      var url = '/api/submissions/?offset=' + offset + '&limit=' + limit;
      var json = await fetchJsonWithSession(url, 'GET');
      var dump = Array.isArray(json && json.submissions_dump) ? json.submissions_dump : [];
      if (!dump.length) {
        break;
      }

      for (var i = 0; i < dump.length; i += 1) {
        var item = dump[i] || {};
        if (String(item.status_display || '').toLowerCase() !== 'accepted') {
          continue;
        }
        var slug = String(item.title_slug || '').trim();
        if (!slug) {
          continue;
        }

        var previous = acceptedBySlug[slug];
        var currentTimestamp = Number(item.timestamp || 0);
        if (!previous || currentTimestamp > Number(previous.timestamp || 0)) {
          acceptedBySlug[slug] = {
            id: item.id,
            slug: slug,
            title: item.title || slug,
            timestamp: currentTimestamp,
            language: item.lang || '',
          };
        }
      }

      offset += dump.length;
      if (dump.length < limit || json.has_next === false) {
        break;
      }
    }
  } catch (error) {
    if (Number(error && error.status) === 403) {
      debugAutoSave('bulk-sync-index-403-fallback', {
        message: 'Primary submissions index blocked, trying GraphQL submissions fallback.',
      });

      try {
        return await fetchAcceptedSubmissionIndexGraphql(upperBound);
      } catch (graphError) {
        debugAutoSave('bulk-sync-graphql-fallback-failed', {
          error: graphError && graphError.message ? graphError.message : String(graphError),
          message: 'GraphQL fallback failed, using solved-problems fallback.',
        });
        return fetchAcceptedSubmissionIndexFallback(upperBound);
      }
    }
    throw new Error(
      'Failed to fetch submissions index: ' +
        (error && error.message ? error.message : 'Unknown error')
    );
  }

  return Object.keys(acceptedBySlug).map(function (slug) {
    return acceptedBySlug[slug];
  });
}

async function fetchSubmissionDetails(submissionId) {
  var csrf = getCookieValue('csrftoken');
  var query = {
    operationName: 'submissionDetails',
    query:
      'query submissionDetails($submissionId: Int!) {' +
      ' submissionDetails(submissionId: $submissionId) {' +
      '   code runtimeDisplay memoryDisplay timestamp' +
      '   lang { name verboseName }' +
      '   question { title titleSlug content difficulty }' +
      ' }' +
      '}',
    variables: { submissionId: Number(submissionId) },
  };

  var headers = { 'content-type': 'application/json' };
  if (csrf) {
    headers['x-csrftoken'] = csrf;
    headers['x-requested-with'] = 'XMLHttpRequest';
  }

  var response = await fetch('/graphql/', {
    method: 'POST',
    credentials: 'include',
    headers: headers,
    body: JSON.stringify(query),
  });

  if (!response.ok) {
    throw new Error('Failed to fetch submission details: HTTP ' + response.status);
  }

  var json = await response.json();
  var details = json && json.data ? json.data.submissionDetails : null;
  if (!details || !details.code) {
    throw new Error('Submission details missing solution code.');
  }

  return details;
}

async function resolveSubmissionId(indexEntry) {
  var directId = Number(indexEntry && indexEntry.id);
  if (Number.isFinite(directId) && directId > 0) {
    return directId;
  }

  var slug = String((indexEntry && indexEntry.slug) || '').trim();
  if (!slug) {
    throw new Error('Missing submission id and slug.');
  }

  var submissions = await fetchProblemSubmissionsBySlug(slug);
  for (var i = 0; i < submissions.length; i += 1) {
    var item = submissions[i] || {};
    if (String(item.status_display || '').toLowerCase() !== 'accepted') {
      continue;
    }

    var fallbackId = Number(item.id || item.submission_id || 0);
    if (Number.isFinite(fallbackId) && fallbackId > 0) {
      return fallbackId;
    }
  }

  throw new Error('Could not resolve accepted submission id for slug: ' + slug);
}

async function fetchSubmissionDetailsWithRetry(indexEntry, maxAttempts, baseDelayMs) {
  var attempts = Math.max(1, Number(maxAttempts) || 3);
  var baseDelay = Math.max(50, Number(baseDelayMs) || 250);
  var lastError = null;
  for (var attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      var submissionId = await resolveSubmissionId(indexEntry);
      return await fetchSubmissionDetails(submissionId);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(baseDelay * attempt);
      }
    }
  }

  throw new Error(
    'Failed to fetch submission details after retries: ' +
      (lastError && lastError.message ? lastError.message : 'Unknown error')
  );
}

function buildProblemPayloadFromAccepted(indexEntry, details) {
  var question = details && details.question ? details.question : {};
  var rawStatement = question.content || '';
  var languageNode = details && details.lang ? details.lang : {};
  var language =
    languageNode.verboseName ||
    languageNode.name ||
    indexEntry.language ||
    findLanguage() ||
    'Unknown';

  return {
    title: normalizeText(
      question.title || indexEntry.title || indexEntry.slug || 'unknown-problem'
    ),
    slug: question.titleSlug || indexEntry.slug,
    url: 'https://leetcode.com/problems/' + (question.titleSlug || indexEntry.slug) + '/',
    difficulty: question.difficulty || 'Unknown',
    statement: htmlToText(rawStatement) || 'Statement was not detected on the current page.',
    language: language,
    code: String(details.code || ''),
    submissionTimestamp: Number(details.timestamp || indexEntry.timestamp || 0),
    savedAt: new Date().toISOString(),
    autoTriggered: true,
    submissionAccepted: true,
  };
}

async function syncAcceptedProfileSubmissions(maxToScan, startCursor, batchSize) {
  if (!/leetcode\.com$/.test(window.location.hostname)) {
    throw new Error('Open leetcode.com before running profile sync.');
  }

  var accepted = await fetchAcceptedSubmissionIndex(maxToScan);
  var cursor = Math.max(0, Number(startCursor) || 0);
  var safeBatchSize = Math.max(1, Number(batchSize) || 100);
  var batchAccepted = accepted.slice(cursor, cursor + safeBatchSize);
  var batchEnd = cursor + batchAccepted.length;
  var hasMore = batchEnd < accepted.length;
  var nextCursor = hasMore ? batchEnd : 0;

  var result = {
    ok: true,
    totalAccepted: accepted.length,
    batchStart: cursor,
    batchEnd: batchEnd,
    batchSize: safeBatchSize,
    hasMore: hasMore,
    nextCursor: nextCursor,
    attempted: 0,
    prepared: 0,
    saved: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };
  var preparedProblems = [];

  debugAutoSave('bulk-sync-start', {
    totalAccepted: accepted.length,
    batchStart: cursor,
    batchEnd: batchEnd,
    batchSize: safeBatchSize,
  });

  var workerCursor = 0;
  var processed = 0;
  var workers = [];
  var failedCandidates = [];
  var workerCount = Math.min(
    4,
    Math.max(2, Math.floor((window.navigator.hardwareConcurrency || 6) / 3))
  );

  function runDetailsWorker() {
    return new Promise(function (resolve) {
      (async function next() {
        if (workerCursor >= batchAccepted.length) {
          resolve();
          return;
        }

        var index = workerCursor;
        workerCursor += 1;
        var entry = batchAccepted[index];
        result.attempted += 1;

        try {
          var details = await fetchSubmissionDetailsWithRetry(entry, 3, 250);
          var payload = buildProblemPayloadFromAccepted(entry, details);

          if (!payload.code || !payload.code.trim()) {
            throw new Error('Empty code for accepted submission.');
          }

          preparedProblems.push(payload);
          result.prepared += 1;
        } catch (itemError) {
          failedCandidates.push({
            slug: entry.slug,
            entry: entry,
            error: itemError && itemError.message ? itemError.message : String(itemError),
          });
        }

        processed += 1;
        if (processed % 20 === 0 || processed === batchAccepted.length) {
          debugAutoSave('bulk-sync-progress', {
            processed: processed,
            total: batchAccepted.length,
            prepared: result.prepared,
            skipped: result.skipped,
            failed: result.failed,
          });
        }

        next();
      })();
    });
  }

  for (var w = 0; w < workerCount; w += 1) {
    workers.push(runDetailsWorker());
  }
  await Promise.all(workers);

  if (failedCandidates.length) {
    debugAutoSave('bulk-sync-recovery-start', {
      failedCandidates: failedCandidates.length,
    });

    // Recovery pass is sequential to reduce throttling/rate-limit failures.
    for (var ri = 0; ri < failedCandidates.length; ri += 1) {
      var failedItem = failedCandidates[ri] || {};
      var failedEntry = failedItem.entry || null;
      if (!failedEntry) {
        result.failed += 1;
        result.failures.push({
          slug: failedItem.slug || 'unknown-problem',
          error: failedItem.error || 'Unknown sync failure.',
        });
        continue;
      }

      try {
        var recoveryDetails = await fetchSubmissionDetailsWithRetry(failedEntry, 5, 500);
        var recoveryPayload = buildProblemPayloadFromAccepted(failedEntry, recoveryDetails);

        if (!recoveryPayload.code || !recoveryPayload.code.trim()) {
          throw new Error('Empty code for accepted submission after recovery.');
        }

        preparedProblems.push(recoveryPayload);
        result.prepared += 1;
      } catch (recoveryError) {
        result.failed += 1;
        result.failures.push({
          slug: failedItem.slug || failedEntry.slug || 'unknown-problem',
          error:
            recoveryError && recoveryError.message
              ? recoveryError.message
              : failedItem.error || 'Unknown sync failure.',
        });
      }

      // Small delay avoids burst failures against submission details endpoint.
      await sleep(180);
    }
  }

  if (preparedProblems.length) {
    debugAutoSave('bulk-sync-commit-start', {
      prepared: preparedProblems.length,
    });

    // Avoid oversized runtime payloads for very large profiles.
    var chunkSize = 200;
    for (var start = 0; start < preparedProblems.length; start += chunkSize) {
      var chunk = preparedProblems.slice(start, start + chunkSize);
      var bulkResponse = await runtimeSend({
        type: 'bulkSaveProblemsToGithub',
        payload: {
          problems: chunk,
        },
      });

      if (!bulkResponse || !bulkResponse.ok) {
        throw new Error(
          (bulkResponse && bulkResponse.error) || 'Bulk commit failed for accepted submissions.'
        );
      }

      var bulkResult = bulkResponse.result || {};
      result.saved += Number(bulkResult.saved) || 0;
      result.skipped += Number(bulkResult.skipped) || 0;
      result.failed += Number(bulkResult.failed) || 0;
      if (Array.isArray(bulkResult.failures) && bulkResult.failures.length) {
        result.failures = result.failures.concat(bulkResult.failures);
      }
    }
  }

  debugAutoSave('bulk-sync-complete', {
    totalAccepted: result.totalAccepted,
    batchStart: result.batchStart,
    batchEnd: result.batchEnd,
    hasMore: result.hasMore,
    nextCursor: result.nextCursor,
    prepared: result.prepared,
    saved: result.saved,
    skipped: result.skipped,
    failed: result.failed,
  });

  return result;
}

var _leetQuestionsRoot = typeof globalThis !== 'undefined' ? globalThis : window;

if (!_leetQuestionsRoot.__leetQuestionsAutoSaveState) {
  _leetQuestionsRoot.__leetQuestionsAutoSaveState = {
    working: false,
    lastKey: '',
    armed: false,
    armedAt: 0,
    seenPendingAfterSubmit: false,
    preSubmitStatus: 'unknown',
    lastObservedStatus: 'unknown',
  };
}

var autoSaveState = _leetQuestionsRoot.__leetQuestionsAutoSaveState;
var AUTO_SAVE_DEBUG = true;

function getSafeRuntime() {
  try {
    if (typeof chrome === 'undefined' || !chrome || !chrome.runtime) {
      return null;
    }
    var runtime = chrome.runtime;
    if (!runtime || !runtime.id) {
      return null;
    }
    return runtime;
  } catch {
    return null;
  }
}

function runtimeSend(message) {
  return new Promise(function (resolve) {
    try {
      var runtime = getSafeRuntime();

      if (!runtime || typeof runtime.sendMessage !== 'function') {
        resolve({ ok: false, error: 'Extension runtime unavailable.' });
        return;
      }

      // Debug events should never block autosave flow.
      if (message && message.type === 'autosaveDebug') {
        try {
          runtime.sendMessage(message);
          resolve({ ok: true, fireAndForget: true });
        } catch (debugSendError) {
          resolve({
            ok: false,
            error:
              debugSendError && debugSendError.message
                ? debugSendError.message
                : 'Failed to send debug message.',
          });
        }
        return;
      }

      var settled = false;
      function finish(result) {
        if (!settled) {
          settled = true;
          resolve(result);
        }
      }

      // Prevent hanging forever if callback is never delivered.
      var timeoutMs = 4000;
      if (message && message.type === 'saveProblemToGithub') {
        timeoutMs = 2 * 60 * 1000;
      }
      if (message && message.type === 'bulkSaveProblemsToGithub') {
        timeoutMs = 20 * 60 * 1000;
      }

      function sendAttempt(allowRetry) {
        var timeoutId = setTimeout(function () {
          finish({ ok: false, error: 'Runtime message timeout.' });
        }, timeoutMs);

        function onRuntimeResponse(response) {
          try {
            clearTimeout(timeoutId);

            var lastError = chrome && chrome.runtime ? chrome.runtime.lastError : null;
            if (lastError) {
              var errorMessage = lastError.message || 'Extension runtime error.';
              var isTransient =
                /receiving end does not exist|extension context invalidated|could not establish connection/i.test(
                  String(errorMessage)
                );
              if (allowRetry && isTransient) {
                setTimeout(function () {
                  sendAttempt(false);
                }, 150);
                return;
              }
              finish({ ok: false, error: errorMessage });
              return;
            }

            finish(response || {});
          } catch (callbackError) {
            finish({
              ok: false,
              error:
                callbackError && callbackError.message
                  ? callbackError.message
                  : 'Failed to process runtime callback.',
            });
          }
        }

        runtime.sendMessage(message, onRuntimeResponse);
      }

      sendAttempt(true);
    } catch (error) {
      resolve({
        ok: false,
        error: error && error.message ? error.message : 'Failed to send runtime message.',
      });
    }
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
  // Mirror LeetHub 3.0 style: guard runtime before extension API usage.
  var runtime = getSafeRuntime();
  if (!runtime) {
    return;
  }

  runtimeSend({ type: 'autosaveDebug', payload: payload });
}

function isNonRetriableAutoSaveError(errorMessage) {
  var message = String(errorMessage || '').toLowerCase();
  if (!message) {
    return false;
  }

  return /manual save is disabled|not accepted|no solution code detected|unsupported language|missing github token or repository|save settings in popup|connect github first|bad credentials|requires authentication|permission denied|resource not accessible/.test(
    message
  );
}

function isTransientRuntimeAutoSaveError(errorMessage) {
  var message = String(errorMessage || '').toLowerCase();
  if (!message) {
    return false;
  }

  return /runtime message timeout|extension runtime unavailable|receiving end does not exist|extension context invalidated|could not establish connection/.test(
    message
  );
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

  autoSaveState.working = true;
  try {
    var payload = await getProblemData();
    if (!payload || !payload.ok) {
      debugAutoSave('collect-failed', {
        payloadOk: Boolean(payload && payload.ok),
      });
      return;
    }

    var problemData = payload && payload.data ? payload.data : null;
    if (!problemData || typeof problemData !== 'object') {
      debugAutoSave('collect-failed', {
        reason: 'Missing problem payload data',
      });
      return;
    }

    problemData.slug = problemData.slug || slugFromUrl(window.location.href);
    problemData.language = problemData.language || 'Unknown';
    problemData.code = String(problemData.code || '');

    var dedupeKey = [problemData.slug, problemData.language, fastHash(problemData.code)].join('|');

    // If submit started from an already-Accepted page and we did not observe
    // a pending phase, only skip when content is unchanged.
    if (
      !autoSaveState.seenPendingAfterSubmit &&
      autoSaveState.preSubmitStatus === 'accepted' &&
      dedupeKey === autoSaveState.lastKey
    ) {
      debugAutoSave('skip-stale-accepted', {
        preSubmitStatus: autoSaveState.preSubmitStatus,
        seenPendingAfterSubmit: autoSaveState.seenPendingAfterSubmit,
        dedupeUnchanged: true,
      });
      return;
    }

    if (dedupeKey === autoSaveState.lastKey) {
      debugAutoSave('skip-duplicate', {
        slug: problemData.slug,
        language: problemData.language,
      });
      return;
    }

    problemData.autoTriggered = true;
    problemData.submissionAccepted = true;
    debugAutoSave('save-start', {
      slug: problemData.slug,
      language: problemData.language,
      codeLength: problemData.code.length,
    });
    var response = await runtimeSend({ type: 'saveProblemToGithub', payload: problemData });
    if (!response || !response.ok) {
      if (autoSaveState.lastKey === dedupeKey) {
        // Keep retries possible when save fails due to transient/runtime issues.
        autoSaveState.lastKey = '';
      }
      var saveErrorMessage = response && response.error ? response.error : 'Unknown save error';
      var shouldDisarm = isNonRetriableAutoSaveError(saveErrorMessage);
      var isTransientRuntimeError = isTransientRuntimeAutoSaveError(saveErrorMessage);
      debugAutoSave('save-failed', {
        error: saveErrorMessage,
        nonRetriable: shouldDisarm,
        transientRuntime: isTransientRuntimeError,
      });
      if (shouldDisarm) {
        console.info('Auto-save skipped:', saveErrorMessage);
      } else if (isTransientRuntimeError) {
        console.info('Auto-save retry pending:', saveErrorMessage);
      } else {
        console.warn('Auto-save failed:', saveErrorMessage);
      }

      if (shouldDisarm) {
        autoSaveState.armed = false;
      }
      return;
    }

    debugAutoSave('save-success', {
      readmePath: response.result ? response.result.readmePath : null,
      codePath: response.result ? response.result.codePath : null,
    });
    autoSaveState.lastKey = dedupeKey;
    autoSaveState.armed = false;
  } catch (error) {
    debugAutoSave('save-exception', {
      error: error && error.message ? error.message : String(error),
      stack: error && error.stack ? String(error.stack) : '',
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

  var element = null;
  if (typeof target.closest === 'function') {
    element = target.closest('button, [role="button"]');
  } else if (target.parentElement && typeof target.parentElement.closest === 'function') {
    element = target.parentElement.closest('button, [role="button"]');
  }

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

  if (_leetQuestionsRoot.__leetQuestionsWatcherStarted) {
    return;
  }
  _leetQuestionsRoot.__leetQuestionsWatcherStarted = true;

  ensureManualPushButton();

  document.addEventListener(
    'click',
    function (event) {
      try {
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
      } catch (error) {
        debugAutoSave('submit-click-handler-error', {
          error: error && error.message ? error.message : String(error),
        });
      }
    },
    true
  );

  document.addEventListener(
    'keydown',
    function (event) {
      try {
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
      } catch (error) {
        debugAutoSave('submit-shortcut-handler-error', {
          error: error && error.message ? error.message : String(error),
        });
      }
    },
    true
  );

  var observer = new MutationObserver(function () {
    ensureManualPushButton();
    tryAutoSave().catch(function (error) {
      debugAutoSave('observer-tryAutoSave-error', {
        error: error && error.message ? error.message : String(error),
      });
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  setInterval(function () {
    tryAutoSave().catch(function (error) {
      debugAutoSave('interval-tryAutoSave-error', {
        error: error && error.message ? error.message : String(error),
      });
    });
  }, 2500);
}

// Safe wrapper to guard against extension reload during message handling.
function setupMessageListener() {
  try {
    var runtime = getSafeRuntime();
    if (!runtime || !runtime.onMessage || typeof runtime.onMessage.addListener !== 'function') {
      console.warn('[leet-questions] chrome.runtime.onMessage not available');
      return;
    }

    runtime.onMessage.addListener(function (request, sender, sendResponse) {
      try {
        if (!request || !request.type) {
          return;
        }

        if (request.type === 'bulkSyncAcceptedProfile') {
          var payload = request.payload || {};
          syncAcceptedProfileSubmissions(payload.maxToScan, payload.startCursor, payload.batchSize)
            .then(function (result) {
              sendResponse({ ok: true, result: result });
            })
            .catch(function (error) {
              sendResponse({
                ok: false,
                error:
                  error && error.message
                    ? error.message
                    : 'Failed to sync accepted profile submissions.',
              });
            });
          return true;
        }

        if (request.type !== 'collectProblemData') {
          return;
        }

        getProblemData()
          .then(function (payload) {
            try {
              if (typeof sendResponse === 'function') {
                sendResponse(payload);
              }
            } catch (sendError) {
              console.warn('[leet-questions] Failed to send response:', sendError.message);
            }
          })
          .catch(function (error) {
            try {
              if (typeof sendResponse === 'function') {
                sendResponse({
                  ok: false,
                  error: error && error.message ? error.message : 'Failed to collect problem data.',
                });
              }
            } catch (sendError) {
              console.warn('[leet-questions] Failed to send error response:', sendError.message);
            }
          });

        return true;
      } catch (handlerError) {
        console.warn('[leet-questions] Message listener error:', handlerError.message);
      }
    });
  } catch (setupError) {
    console.warn('[leet-questions] Failed to setup message listener:', setupError.message);
  }
}

setupMessageListener();

if (isLikelyProblemPage()) {
  startAcceptedWatcher();
}
