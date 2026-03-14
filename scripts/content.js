function pickFirstText(selectors) {
  for (var i = 0; i < selectors.length; i += 1) {
    var el = document.querySelector(selectors[i]);
    if (el && el.textContent && el.textContent.trim()) {
      return el.textContent.trim();
    }
  }
  return '';
}

function slugFromUrl(url) {
  var match = url.match(/\/problems\/([^/]+)\/?/);
  return match && match[1] ? match[1] : 'unknown-problem';
}

function findLanguage() {
  var languageText = pickFirstText([
    'button[data-cy="lang-select"]',
    'div[data-cy="lang-select"]',
    '[id*="headlessui-listbox-button"]',
    '[class*="language-select"] button',
    '[class*="lang-select"] button'
  ]);

  if (!languageText) {
    return 'Unknown';
  }

  return languageText.replace(/\s+/g, ' ').trim();
}

function extractCodeFromDom() {
  var fromTextarea = document.querySelector('textarea.inputarea');
  if (fromTextarea && fromTextarea.value && fromTextarea.value.trim()) {
    return fromTextarea.value;
  }

  var fromCodeBlock = document.querySelector('code');
  if (fromCodeBlock && fromCodeBlock.innerText && fromCodeBlock.innerText.trim()) {
    return fromCodeBlock.innerText;
  }

  return '';
}

function extractCodeFromPageContext() {
  return new Promise(function (resolve) {
    var requestId = 'leetcode-ext-' + Date.now() + '-' + Math.random().toString(36).slice(2);

    function handleMessage(event) {
      if (event.source !== window) {
        return;
      }

      var message = event.data;
      if (!message || message.source !== 'leetcode_questions_extension' || message.requestId !== requestId) {
        return;
      }

      window.removeEventListener('message', handleMessage);
      resolve(message.code || '');
    }

    window.addEventListener('message', handleMessage);

    var script = document.createElement('script');
    script.textContent = '(() => {' +
      'var extracted = "";' +
      'try {' +
      'if (window.monaco && window.monaco.editor && typeof window.monaco.editor.getModels === "function") {' +
      'var models = window.monaco.editor.getModels();' +
      'if (models && models.length && models[0] && typeof models[0].getValue === "function") {' +
      'extracted = models[0].getValue() || "";' +
      '}' +
      '}' +
      '} catch (e) {}' +
      'window.postMessage({' +
      'source: "leetcode_questions_extension",' +
      'requestId: "' + requestId + '",' +
      'code: extracted' +
      '}, "*");' +
      '})();';

    (document.documentElement || document.head || document.body).appendChild(script);
    script.remove();

    setTimeout(function () {
      window.removeEventListener('message', handleMessage);
      resolve('');
    }, 1500);
  });
}

async function getProblemData() {
  var url = window.location.href;
  if (url.indexOf('leetcode.com/problems/') === -1) {
    return { ok: false, error: 'Not on a LeetCode problem page.' };
  }

  var title = pickFirstText([
    'div.text-title-large a',
    '[data-cy="question-title"]',
    'h1'
  ]);

  var difficulty = pickFirstText([
    'div.text-difficulty-easy',
    'div.text-difficulty-medium',
    'div.text-difficulty-hard',
    '[class*="text-difficulty"]'
  ]);

  var statementEl = document.querySelector('[data-track-load="description_content"]') ||
    document.querySelector('.elfjS') ||
    document.querySelector('div[data-key="description-content"]');

  var statement = '';
  if (statementEl && statementEl.innerText) {
    statement = statementEl.innerText.trim();
  }

  var code = await extractCodeFromPageContext();
  if (!code) {
    code = extractCodeFromDom();
  }

  return {
    ok: true,
    data: {
      title: title || slugFromUrl(url),
      slug: slugFromUrl(url),
      url: url,
      difficulty: difficulty || 'Unknown',
      statement: statement || 'Statement was not detected on the current page.',
      language: findLanguage(),
      code: code || '',
      savedAt: new Date().toISOString()
    }
  };
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
