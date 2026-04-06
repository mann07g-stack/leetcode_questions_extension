function getStorage(keys) {
  return new Promise(function (resolve) {
    chrome.storage.sync.get(keys, function (data) {
      resolve(data || {});
    });
  });
}

function setStorage(values) {
  return new Promise(function (resolve) {
    chrome.storage.sync.set(values, function () {
      resolve();
    });
  });
}

var GITHUB_OAUTH_CLIENT_ID = '';
var GITHUB_OAUTH_CLIENT_SECRET = '';
var AUTO_SAVE_DEBUG = true;

function toFormBody(payload) {
  var keys = Object.keys(payload || {});
  var parts = [];
  for (var i = 0; i < keys.length; i += 1) {
    var key = keys[i];
    parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(payload[key]));
  }
  return parts.join('&');
}

function getQueryParam(url, key) {
  var encoded = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var match = url.match(new RegExp('[?&]' + encoded + '=([^&#]+)'));
  return match && match[1] ? decodeURIComponent(match[1]) : '';
}

function createOAuthState() {
  return String(Date.now()) + '-' + Math.random().toString(36).slice(2);
}

async function getOAuthConfig() {
  var stored = await getStorage(['githubOAuthClientId', 'githubOAuthClientSecret']);
  return {
    clientId: stored.githubOAuthClientId || GITHUB_OAUTH_CLIENT_ID,
    clientSecret: stored.githubOAuthClientSecret || GITHUB_OAUTH_CLIENT_SECRET,
  };
}

async function ensureDefaultRepo(token, username) {
  // Find an existing LeetCode-named repo
  try {
    var repos = await listGithubRepos(token);
    if (Array.isArray(repos)) {
      for (var i = 0; i < repos.length; i++) {
        var rn = String(repos[i].name || '').toLowerCase();
        if (rn.indexOf('leetcode') !== -1) {
          return repos[i].full_name;
        }
      }
    }
  } catch {
    // Fall through to create
  }

  // Create a new public repo named "leetcode-solutions"
  try {
    var created = await createGithubRepo(token, 'leetcode-solutions', false);
    if (created && created.full_name) {
      return created.full_name;
    }
  } catch {
    // Repo may already exist; use fallback
  }

  return username ? username + '/leetcode-solutions' : 'leetcode-solutions';
}

async function getStats() {
  var state = await getStorage(['stats']);
  var stats = state.stats || {};
  return {
    total: Number(stats.total) || 0,
    easy: Number(stats.easy) || 0,
    medium: Number(stats.medium) || 0,
    hard: Number(stats.hard) || 0,
  };
}

async function incrementStats(difficulty) {
  var stats = await getStats();
  var diff = String(difficulty || '').toLowerCase();

  stats.total += 1;
  if (diff === 'easy') {
    stats.easy += 1;
  } else if (diff === 'medium') {
    stats.medium += 1;
  } else if (diff === 'hard') {
    stats.hard += 1;
  }

  await setStorage({ stats: stats });
  return stats;
}

async function appendAutoSaveDebug(entry) {
  if (!AUTO_SAVE_DEBUG) {
    return;
  }

  var state = await getStorage(['autoSaveDebugLog']);
  var log = Array.isArray(state.autoSaveDebugLog) ? state.autoSaveDebugLog : [];
  log.push(entry);
  if (log.length > 80) {
    log = log.slice(log.length - 80);
  }

  await setStorage({ autoSaveDebugLog: log });
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

function executeScriptInMainWorld(tabId, func) {
  return new Promise(function (resolve, reject) {
    try {
      if (
        typeof chrome === 'undefined' ||
        !chrome ||
        !chrome.scripting ||
        typeof chrome.scripting.executeScript !== 'function'
      ) {
        reject(new Error('Extension runtime unavailable for script execution.'));
        return;
      }
      var runtime = chrome.runtime;
      chrome.scripting.executeScript(
        {
          target: { tabId: tabId },
          world: 'MAIN',
          func: func,
        },
        function (results) {
          try {
            if (runtime && runtime.lastError) {
              reject(new Error(runtime.lastError.message));
              return;
            }
            if (!results || !results.length) {
              resolve('');
              return;
            }
            resolve(results[0].result || '');
          } catch (callbackError) {
            reject(callbackError);
          }
        }
      );
    } catch (error) {
      reject(error);
    }
  });
}

async function extractCodeFromTab(tabId) {
  if (!tabId) {
    return '';
  }

  try {
    var code = await executeScriptInMainWorld(tabId, function () {
      try {
        if (
          window.monaco &&
          window.monaco.editor &&
          typeof window.monaco.editor.getModels === 'function'
        ) {
          var models = window.monaco.editor.getModels();
          if (models && models.length && models[0] && typeof models[0].getValue === 'function') {
            return models[0].getValue() || '';
          }
        }

        var textarea = document.querySelector('textarea.inputarea');
        if (textarea && textarea.value) {
          return textarea.value;
        }

        return '';
      } catch {
        return '';
      }
    });

    return String(code || '');
  } catch {
    return '';
  }
}

async function extractLanguageFromTab(tabId) {
  if (!tabId) {
    return '';
  }

  try {
    var language = await executeScriptInMainWorld(tabId, function () {
      try {
        if (
          window.monaco &&
          window.monaco.editor &&
          typeof window.monaco.editor.getModels === 'function'
        ) {
          var models = window.monaco.editor.getModels();
          if (
            models &&
            models.length &&
            models[0] &&
            typeof models[0].getLanguageId === 'function'
          ) {
            var monacoLanguage = String(models[0].getLanguageId() || '').trim();
            if (monacoLanguage) {
              return monacoLanguage;
            }
          }
        }

        var selectors = [
          'button[data-cy="lang-select"]',
          'div[data-cy="lang-select"]',
          '[id*="headlessui-listbox-button"]',
          '[class*="language-select"] button',
          '[class*="lang-select"] button',
          '.select-language',
          '[role="button"][data-testid="lang"]',
        ];

        for (var i = 0; i < selectors.length; i += 1) {
          var node = null;
          try {
            node = document.querySelector(selectors[i]);
          } catch {
            node = null;
          }
          var text =
            node && (node.innerText || node.textContent)
              ? String(node.innerText || node.textContent).trim()
              : '';
          if (text) {
            return text;
          }
        }

        return '';
      } catch {
        return '';
      }
    });

    return String(language || '').trim();
  } catch {
    return '';
  }
}

async function resolveBestLanguage(existingLanguage, tabId) {
  var current = String(existingLanguage || '').trim();
  var liveLanguage = await extractLanguageFromTab(tabId);
  if (liveLanguage && liveLanguage.toLowerCase() !== 'unknown') {
    return liveLanguage;
  }

  return current || 'Unknown';
}

async function resolveBestCode(existingCode, tabId) {
  var current = String(existingCode || '');

  if (!tabId) {
    return current;
  }

  var live = await extractCodeFromTab(tabId);
  var liveTrimmed = String(live || '').trim();
  var currentTrimmed = current.trim();

  if (!liveTrimmed) {
    return current;
  }

  if (!currentTrimmed) {
    return live;
  }

  if (liveTrimmed === currentTrimmed) {
    return current;
  }

  // Prefer full editor model content from main world when lengths differ.
  if (live.length >= current.length) {
    return live;
  }

  // Even if character length is close, prefer the one with more lines.
  var liveLines = live.split('\n').length;
  var currentLines = current.split('\n').length;
  if (liveLines > currentLines) {
    return live;
  }

  return current;
}

function toBase64Unicode(input) {
  return btoa(unescape(encodeURIComponent(input)));
}

function normalizePathSegment(input) {
  return String(input || '')
    .trim()
    .replace(/[\\\\:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .toLowerCase();
}

function normalizeLanguage(input) {
  return String(input || '')
    .trim()
    .toLowerCase();
}

function titleCaseWords(input) {
  var text = String(input || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) {
    return '';
  }
  return text
    .split(' ')
    .map(function (part) {
      return part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : '';
    })
    .join(' ');
}

function getTodaysDate() {
  var now = new Date();
  var mm = String(now.getMonth() + 1).padStart(2, '0');
  var dd = String(now.getDate()).padStart(2, '0');
  var yyyy = String(now.getFullYear());
  return mm + '-' + dd + '-' + yyyy;
}

function getCurrentTime() {
  var now = new Date();
  var hh = String(now.getHours()).padStart(2, '0');
  var mm = String(now.getMinutes()).padStart(2, '0');
  var ss = String(now.getSeconds()).padStart(2, '0');
  return hh + '-' + mm + '-' + ss;
}

function applyCommitTemplate(template, context, fallback) {
  var base = String(template || '').trim();
  if (!base) {
    return fallback;
  }
  return base.replace(/\{(\w+)\}/g, function (match, key) {
    if (Object.prototype.hasOwnProperty.call(context, key)) {
      var value = context[key];
      return value === undefined || value === null ? '' : String(value);
    }
    return match;
  });
}

function planProblemFiles(problem, options) {
  var folder = String(options.folder || 'problems');
  var useDifficultyFolder = Boolean(options.useDifficultyFolder);
  var useLanguageFolder = Boolean(options.useLanguageFolder);
  var useTimestampFilename = Boolean(options.useTimestampFilename);
  var customCommitTemplate = String(options.customCommitTemplate || '');
  var fileExtensions = Array.isArray(options.fileExtensions) ? options.fileExtensions : [];

  var slug = normalizePathSegment(problem.slug || problem.title || 'problem');
  var baseParts = [];
  var folderRoot = folder.replace(/^\/+|\/+$/g, '');
  if (folderRoot) {
    baseParts.push(folderRoot);
  }
  if (useLanguageFolder) {
    baseParts.push(normalizePathSegment(titleCaseWords(problem.language || 'unknown')));
  }
  if (useDifficultyFolder) {
    baseParts.push(normalizePathSegment(titleCaseWords(problem.difficulty || 'unknown')));
  }
  baseParts.push(slug);
  var base = baseParts.join('/');

  var commitContext = {
    problemName: slug,
    difficulty: problem.difficulty || 'Unknown',
    language: problem.language || 'Unknown',
    date: getTodaysDate(),
    time: getCurrentTime(),
    url: problem.url || '',
  };

  var readmeCommitMessage = 'docs: save ' + problem.title;
  var codeCommitMessage = applyCommitTemplate(
    customCommitTemplate,
    commitContext,
    'code: save ' + problem.title + ' solution'
  );

  var readmePath = base + '/README.md';
  var codeFileName = 'solution';
  if (useTimestampFilename) {
    codeFileName = 'solution-' + getTodaysDate() + '-' + getCurrentTime();
  }
  var normalizedExtensions = [];
  for (var i = 0; i < fileExtensions.length; i += 1) {
    var candidate = String(fileExtensions[i] || '').trim();
    if (!candidate) {
      continue;
    }
    if (candidate.charAt(0) !== '.') {
      candidate = '.' + candidate;
    }
    if (normalizedExtensions.indexOf(candidate) === -1) {
      normalizedExtensions.push(candidate);
    }
  }

  if (!normalizedExtensions.length) {
    normalizedExtensions.push('.txt');
  }

  var codeEntries = [];
  for (var j = 0; j < normalizedExtensions.length; j += 1) {
    codeEntries.push({
      extension: normalizedExtensions[j],
      path: base + '/' + codeFileName + normalizedExtensions[j],
      content: problem.code,
    });
  }

  return {
    slug: slug,
    readmePath: readmePath,
    codePath: codeEntries[0].path,
    codePaths: codeEntries,
    readmeContent: buildMarkdown(problem),
    codeContent: problem.code,
    readmeCommitMessage: readmeCommitMessage,
    codeCommitMessage: codeCommitMessage,
  };
}

function languageToExtension(language) {
  var map = {
    c: '.c',
    cpp: '.cpp',
    cpp14: '.cpp',
    cpp17: '.cpp',
    cpp20: '.cpp',
    java: '.java',
    python: '.py',
    python2: '.py',
    python3: '.py',
    py: '.py',
    javascript: '.js',
    js: '.js',
    javascriptes5: '.js',
    javascriptes6: '.js',
    typescript: '.ts',
    ts: '.ts',
    go: '.go',
    golang: '.go',
    kotlin: '.kt',
    rust: '.rs',
    ruby: '.rb',
    swift: '.swift',
    php: '.php',
    scala: '.scala',
    csharp: '.cs',
    cs: '.cs',
    mysql: '.sql',
    sql: '.sql',
    mssql: '.sql',
    oracle: '.sql',
    plpgsql: '.sql',
    postgres: '.sql',
    postgresql: '.sql',
    r: '.r',
    dart: '.dart',
    bash: '.sh',
    shell: '.sh',
    sh: '.sh',
    elixir: '.ex',
    erlang: '.erl',
    clojure: '.clj',
    lisp: '.lisp',
    scheme: '.scm',
    racket: '.rkt',
    lua: '.lua',
    perl: '.pl',
    haskell: '.hs',
    ocaml: '.ml',
    fsharp: '.fs',
    groovy: '.groovy',
    solidity: '.sol',
    vb: '.vb',
    visualbasic: '.vb',
  };

  var normalized = normalizeLanguage(language)
    .replace(/c\+\+/g, 'cpp')
    .replace(/c#/g, 'csharp')
    .replace(/f#/g, 'fsharp')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .trim();

  return map[normalized] || null;
}

function resolveFileExtensions(language, code) {
  var rawLanguage = String(language || '')
    .toLowerCase()
    .trim();

  var extension = languageToExtension(rawLanguage);
  if (!extension) {
    var simplified = rawLanguage
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[^a-z0-9+#]+/g, ' ')
      .trim();
    if (simplified) {
      var parts = simplified.split(/\s+/);
      for (var i = 0; i < parts.length; i += 1) {
        extension = languageToExtension(parts[i]);
        if (extension) {
          break;
        }
      }
    }
  }

  if (!extension) {
    extension = inferExtensionFromCode(code) || '.code';
  }

  return [extension];
}

function inferExtensionFromCode(code) {
  var text = String(code || '').trim();
  if (!text) {
    return null;
  }

  if (/^\s*def\s+\w+\s*\(|^\s*class\s+\w+\s*[:(]/m.test(text)) {
    return '.py';
  }
  if (/^\s*(SELECT|WITH|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(text)) {
    return '.sql';
  }
  if (/^\s*#include\s*<|\bstd::\w+/m.test(text)) {
    return '.cpp';
  }
  if (/^\s*public\s+class\b|\bSystem\.out\.println\b/m.test(text)) {
    return '.java';
  }
  if (/^\s*function\s+\w+\s*\(|\bconsole\.log\(|=>/m.test(text)) {
    return '.js';
  }
  if (/^\s*package\s+main\b|\bfmt\.Println\(/m.test(text)) {
    return '.go';
  }

  return null;
}

function buildMarkdown(problem) {
  var lines = [];
  lines.push('# ' + problem.title);
  lines.push('');
  lines.push('- Difficulty: ' + problem.difficulty);
  lines.push('- Language: ' + (problem.language || 'Unknown'));
  lines.push('- URL: ' + problem.url);
  lines.push('- Saved At: ' + problem.savedAt);
  lines.push('');
  lines.push('## Problem Statement');
  lines.push('');
  lines.push(problem.statement || 'N/A');
  lines.push('');
  return lines.join('\n');
}

async function githubRequest(url, options) {
  var response = await fetch(url, options);
  var text = await response.text();
  var json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { response: response, json: json };
}

async function githubApiWithToken(token, url, method, body) {
  var options = {
    method: method || 'GET',
    headers: {
      Authorization: 'token ' + token,
      Accept: 'application/vnd.github+json',
    },
  };

  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  var result = await githubRequest(url, options);
  if (!result.response.ok) {
    var message = result.json && result.json.message ? result.json.message : 'GitHub API error';
    throw new Error('GitHub API error (' + result.response.status + '): ' + message);
  }

  return result.json;
}

async function getGithubUser(token) {
  return githubApiWithToken(token, 'https://api.github.com/user', 'GET');
}

async function listGithubRepos(token) {
  return githubApiWithToken(
    token,
    'https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member',
    'GET'
  );
}

async function createGithubRepo(token, name, isPrivate) {
  return githubApiWithToken(token, 'https://api.github.com/user/repos', 'POST', {
    name: name,
    private: Boolean(isPrivate),
    auto_init: true,
    description: 'LeetCode progress repository created by LeetCode Questions Extension',
  });
}

async function exchangeCodeForAccessToken(code, redirectUri, oauthConfig) {
  var tokenResponse = await githubRequest('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: toFormBody({
      client_id: oauthConfig.clientId,
      client_secret: oauthConfig.clientSecret,
      code: code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenResponse.response.ok) {
    var tokenHttpError =
      tokenResponse.json && tokenResponse.json.error_description
        ? tokenResponse.json.error_description
        : 'Failed to exchange GitHub authorization code.';
    throw new Error(tokenHttpError);
  }

  var tokenPayload = tokenResponse.json || {};
  if (!tokenPayload.access_token) {
    var tokenError =
      tokenPayload.error_description ||
      tokenPayload.error ||
      'GitHub did not return an access token.';
    throw new Error(tokenError);
  }

  return tokenPayload.access_token;
}

var OAUTH_REDIRECT_URI = 'https://github.com/';

async function startGithubOAuthFlow() {
  var oauthConfig = await getOAuthConfig();
  if (!oauthConfig.clientId || !oauthConfig.clientSecret) {
    throw new Error(
      'OAuth credentials missing. Expand "OAuth App Setup" in the popup to configure.'
    );
  }

  var state = createOAuthState();

  var authorizeUrl =
    'https://github.com/login/oauth/authorize' +
    '?client_id=' +
    encodeURIComponent(oauthConfig.clientId) +
    '&redirect_uri=' +
    encodeURIComponent(OAUTH_REDIRECT_URI) +
    '&scope=' +
    encodeURIComponent('repo') +
    '&state=' +
    encodeURIComponent(state);

  return new Promise(function (resolve, reject) {
    try {
      if (
        typeof chrome === 'undefined' ||
        !chrome ||
        !chrome.tabs ||
        typeof chrome.tabs.create !== 'function'
      ) {
        reject(new Error('Extension runtime unavailable for tab creation.'));
        return;
      }
      var runtime = chrome.runtime;
      chrome.tabs.create({ url: authorizeUrl, active: true }, function (tab) {
        try {
          if (!runtime || (runtime.lastError && runtime.lastError.message) || !tab) {
            reject(new Error('Failed to open GitHub authorization tab.'));
            return;
          }
          setStorage({
            githubOAuthPending: true,
            githubOAuthState: state,
            githubOAuthTabId: tab.id,
            githubOAuthClientId: oauthConfig.clientId,
            githubOAuthClientSecret: oauthConfig.clientSecret,
          })
            .then(function () {
              resolve({ started: true, awaitingCallback: true });
            })
            .catch(reject);
        } catch (callbackError) {
          reject(callbackError);
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function upsertGithubFile(params) {
  var headers = {
    Authorization: 'token ' + params.token,
    Accept: 'application/vnd.github+json',
  };

  var encodedPath = params.path.split('/').map(encodeURIComponent).join('/');
  var apiUrl = 'https://api.github.com/repos/' + params.repo + '/contents/' + encodedPath;

  var existing = await githubRequest(apiUrl + '?ref=' + encodeURIComponent(params.branch), {
    method: 'GET',
    headers: headers,
  });

  var existed = existing.response.ok && existing.json && existing.json.sha;

  var payload = {
    message: params.message,
    content: toBase64Unicode(params.content),
    branch: params.branch,
  };

  if (existing.response.ok && existing.json && existing.json.sha) {
    payload.sha = existing.json.sha;
  }

  var writeResult = await githubRequest(apiUrl, {
    method: 'PUT',
    headers: {
      Authorization: headers.Authorization,
      Accept: headers.Accept,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!writeResult.response.ok) {
    var message =
      writeResult.json && writeResult.json.message ? writeResult.json.message : 'GitHub API error';
    throw new Error('GitHub API error (' + writeResult.response.status + '): ' + message);
  }

  return {
    created: !existed,
  };
}

async function saveProblemToGithub(problem, tabId) {
  var config = await getStorage([
    'githubToken',
    'githubRepo',
    'githubBranch',
    'githubFolder',
    'useDifficultyFolder',
    'useLanguageFolder',
    'useTimestampFilename',
    'custom_commit_message',
  ]);
  var token = config.githubToken;
  var repo = config.githubRepo;
  var branch = config.githubBranch || 'main';
  var folder = config.githubFolder || 'problems';
  var useDifficultyFolder = Boolean(config.useDifficultyFolder);
  var useLanguageFolder = Boolean(config.useLanguageFolder);
  var useTimestampFilename = Boolean(config.useTimestampFilename);
  var customCommitTemplate = config.custom_commit_message || '';

  if (!token || !repo) {
    throw new Error('Missing GitHub token or repository. Save settings in popup.');
  }

  var finalProblem = Object.assign({}, problem);

  if (!finalProblem.autoTriggered) {
    throw new Error('Manual save is disabled. Submit on LeetCode and auto-save will run.');
  }

  if (!finalProblem.submissionAccepted) {
    throw new Error('Latest submission is not accepted. Only accepted submissions are saved.');
  }

  finalProblem.code = await resolveBestCode(finalProblem.code, tabId);
  finalProblem.language = await resolveBestLanguage(finalProblem.language, tabId);

  if (!finalProblem.code || !finalProblem.code.trim()) {
    throw new Error('No solution code detected. Submission was not saved.');
  }

  var fileExtensions = resolveFileExtensions(finalProblem.language, finalProblem.code);

  if (finalProblem && finalProblem.autoTriggered) {
    var autoState = await getStorage(['lastAutoSaveKey']);
    var autoKey = [
      normalizePathSegment(finalProblem.slug || ''),
      normalizeLanguage(finalProblem.language || ''),
      fastHash(finalProblem.code || ''),
    ].join('|');

    if (autoState.lastAutoSaveKey === autoKey) {
      return {
        readmePath: null,
        codePath: null,
        skipped: true,
        reason: 'Duplicate auto-save ignored.',
        stats: await getStats(),
      };
    }

    await setStorage({ lastAutoSaveKey: autoKey });
  }

  var filePlan = planProblemFiles(finalProblem, {
    folder: folder,
    useDifficultyFolder: useDifficultyFolder,
    useLanguageFolder: useLanguageFolder,
    useTimestampFilename: useTimestampFilename,
    customCommitTemplate: customCommitTemplate,
    fileExtensions: fileExtensions,
  });

  var readmeWrite = await upsertGithubFile({
    token: token,
    repo: repo,
    branch: branch,
    path: filePlan.readmePath,
    content: filePlan.readmeContent,
    message: filePlan.readmeCommitMessage,
  });

  for (var codeIndex = 0; codeIndex < filePlan.codePaths.length; codeIndex += 1) {
    var codeEntry = filePlan.codePaths[codeIndex];
    await upsertGithubFile({
      token: token,
      repo: repo,
      branch: branch,
      path: codeEntry.path,
      content: codeEntry.content,
      message: filePlan.codeCommitMessage,
    });
  }

  var stats = await getStats();
  if (readmeWrite && readmeWrite.created) {
    stats = await incrementStats(finalProblem.difficulty);
  }

  return {
    readmePath: filePlan.readmePath,
    codePath: filePlan.codePath,
    codePaths: filePlan.codePaths.map(function (entry) {
      return entry.path;
    }),
    stats: stats,
  };
}

async function getBranchHeadCommitSha(token, repo, branch) {
  var ref = await githubApiWithToken(
    token,
    'https://api.github.com/repos/' + repo + '/git/ref/heads/' + encodeURIComponent(branch),
    'GET'
  );
  if (!ref || !ref.object || !ref.object.sha) {
    throw new Error('Could not resolve branch head for ' + branch + '.');
  }
  return ref.object.sha;
}

async function getCommitTreeSha(token, repo, commitSha) {
  var commit = await githubApiWithToken(
    token,
    'https://api.github.com/repos/' + repo + '/git/commits/' + encodeURIComponent(commitSha),
    'GET'
  );
  if (!commit || !commit.tree || !commit.tree.sha) {
    throw new Error('Could not resolve commit tree.');
  }
  return commit.tree.sha;
}

async function getTreePaths(token, repo, treeSha) {
  var treeData = await githubApiWithToken(
    token,
    'https://api.github.com/repos/' +
      repo +
      '/git/trees/' +
      encodeURIComponent(treeSha) +
      '?recursive=1',
    'GET'
  );
  var tree = Array.isArray(treeData && treeData.tree) ? treeData.tree : [];
  var paths = {};
  for (var i = 0; i < tree.length; i += 1) {
    var item = tree[i] || {};
    if (item.path) {
      paths[item.path] = true;
    }
  }
  return paths;
}

async function createGitBlob(token, repo, content) {
  var blob = await githubApiWithToken(
    token,
    'https://api.github.com/repos/' + repo + '/git/blobs',
    'POST',
    {
      content: String(content || ''),
      encoding: 'utf-8',
    }
  );
  if (!blob || !blob.sha) {
    throw new Error('Failed to create Git blob.');
  }
  return blob.sha;
}

async function mapWithConcurrency(items, limit, mapper) {
  var queue = Array.isArray(items) ? items.slice() : [];
  var maxWorkers = Math.max(1, Number(limit) || 1);
  var results = [];
  var workers = [];

  function worker() {
    return new Promise(function (resolve) {
      (function next() {
        if (!queue.length) {
          resolve();
          return;
        }
        var item = queue.shift();
        Promise.resolve()
          .then(function () {
            return mapper(item);
          })
          .then(function (result) {
            results.push(result);
            next();
          })
          .catch(function (error) {
            results.push({ error: error });
            next();
          });
      })();
    });
  }

  for (var i = 0; i < maxWorkers; i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

async function bulkSaveProblemsToGithub(problems) {
  var config = await getStorage([
    'githubToken',
    'githubRepo',
    'githubBranch',
    'githubFolder',
    'useDifficultyFolder',
    'useLanguageFolder',
    'useTimestampFilename',
    'custom_commit_message',
  ]);

  var token = config.githubToken;
  var repo = config.githubRepo;
  var branch = config.githubBranch || 'main';
  var folder = config.githubFolder || 'problems';
  var useDifficultyFolder = Boolean(config.useDifficultyFolder);
  var useLanguageFolder = Boolean(config.useLanguageFolder);
  var useTimestampFilename = Boolean(config.useTimestampFilename);
  var customCommitTemplate = config.custom_commit_message || '';

  if (!token || !repo) {
    throw new Error('Missing GitHub token or repository. Save settings in popup.');
  }

  if (!Array.isArray(problems) || !problems.length) {
    return {
      committed: false,
      total: 0,
      saved: 0,
      skipped: 0,
      failed: 0,
      failures: [],
      stats: await getStats(),
    };
  }

  var parentCommitSha = await getBranchHeadCommitSha(token, repo, branch);
  var baseTreeSha = await getCommitTreeSha(token, repo, parentCommitSha);
  var existingPaths = await getTreePaths(token, repo, baseTreeSha);

  var seenProblemKeys = {};
  var plannedByPath = {};
  var newReadmeDifficulties = [];
  var plannedProblemCount = 0;
  var failures = [];
  var skipped = 0;
  var failed = 0;

  for (var i = 0; i < problems.length; i += 1) {
    var problem = Object.assign({}, problems[i] || {});
    try {
      if (!problem.autoTriggered) {
        skipped += 1;
        continue;
      }
      if (!problem.submissionAccepted) {
        skipped += 1;
        continue;
      }
      if (!problem.code || !String(problem.code).trim()) {
        skipped += 1;
        continue;
      }

      var key = [
        normalizePathSegment(problem.slug || ''),
        normalizeLanguage(problem.language || ''),
        fastHash(problem.code || ''),
      ].join('|');
      if (seenProblemKeys[key]) {
        skipped += 1;
        continue;
      }
      seenProblemKeys[key] = true;

      var fileExtensions = resolveFileExtensions(problem.language, problem.code);

      var plan = planProblemFiles(problem, {
        folder: folder,
        useDifficultyFolder: useDifficultyFolder,
        useLanguageFolder: useLanguageFolder,
        useTimestampFilename: useTimestampFilename,
        customCommitTemplate: customCommitTemplate,
        fileExtensions: fileExtensions,
      });

      plannedByPath[plan.readmePath] = {
        path: plan.readmePath,
        content: plan.readmeContent,
      };
      for (var cp = 0; cp < plan.codePaths.length; cp += 1) {
        var codeEntry = plan.codePaths[cp];
        plannedByPath[codeEntry.path] = {
          path: codeEntry.path,
          content: codeEntry.content,
        };
      }
      plannedProblemCount += 1;

      if (!existingPaths[plan.readmePath]) {
        newReadmeDifficulties.push(String(problem.difficulty || 'Unknown').toLowerCase());
      }
    } catch (error) {
      failed += 1;
      failures.push({
        slug: problem.slug || 'unknown-problem',
        error: error && error.message ? error.message : String(error),
      });
    }
  }

  var plannedEntries = Object.keys(plannedByPath).map(function (path) {
    return plannedByPath[path];
  });

  if (!plannedEntries.length) {
    return {
      committed: false,
      total: problems.length,
      saved: 0,
      skipped: skipped,
      failed: failed,
      failures: failures,
      stats: await getStats(),
    };
  }

  var blobRecords = await mapWithConcurrency(plannedEntries, 8, async function (entry) {
    var sha = await createGitBlob(token, repo, entry.content);
    return {
      path: entry.path,
      sha: sha,
    };
  });

  var tree = [];
  for (var j = 0; j < blobRecords.length; j += 1) {
    var record = blobRecords[j];
    if (!record || !record.sha || !record.path) {
      failed += 1;
      continue;
    }
    tree.push({
      path: record.path,
      mode: '100644',
      type: 'blob',
      sha: record.sha,
    });
  }

  if (!tree.length) {
    return {
      committed: false,
      total: problems.length,
      saved: 0,
      skipped: skipped,
      failed: failed,
      failures: failures,
      stats: await getStats(),
    };
  }

  var newTree = await githubApiWithToken(
    token,
    'https://api.github.com/repos/' + repo + '/git/trees',
    'POST',
    {
      base_tree: baseTreeSha,
      tree: tree,
    }
  );

  var commitMessage = 'bulk: sync ' + String(plannedProblemCount) + ' accepted LeetCode solutions';
  var newCommit = await githubApiWithToken(
    token,
    'https://api.github.com/repos/' + repo + '/git/commits',
    'POST',
    {
      message: commitMessage,
      tree: newTree.sha,
      parents: [parentCommitSha],
    }
  );

  await githubApiWithToken(
    token,
    'https://api.github.com/repos/' + repo + '/git/refs/heads/' + encodeURIComponent(branch),
    'PATCH',
    {
      sha: newCommit.sha,
      force: false,
    }
  );

  if (newReadmeDifficulties.length) {
    var stats = await getStats();
    for (var k = 0; k < newReadmeDifficulties.length; k += 1) {
      var diff = newReadmeDifficulties[k];
      stats.total += 1;
      if (diff === 'easy') {
        stats.easy += 1;
      } else if (diff === 'medium') {
        stats.medium += 1;
      } else if (diff === 'hard') {
        stats.hard += 1;
      }
    }
    await setStorage({ stats: stats });
  }

  await setStorage({
    lastAutoSaveStatus: {
      ok: true,
      at: new Date().toISOString(),
      message: 'Bulk sync committed successfully.',
    },
  });

  return {
    committed: true,
    commitSha: newCommit.sha,
    total: problems.length,
    saved: plannedProblemCount,
    skipped: skipped,
    failed: failed,
    failures: failures,
    stats: await getStats(),
  };
}

// Safe wrapper to guard against extension reload during message handling
function setupBackgroundMessageListener() {
  try {
    var runtime = typeof chrome !== 'undefined' && chrome && chrome.runtime ? chrome.runtime : null;
    if (!runtime || !runtime.onMessage || typeof runtime.onMessage.addListener !== 'function') {
      console.warn('[leet-questions] chrome.runtime.onMessage not available in background');
      return;
    }
    runtime.onMessage.addListener(function (request, sender, sendResponse) {
      try {
        if (!request || !request.type) {
          return;
        }

        if (request.type === 'autosaveDebug') {
          var incoming = request.payload || {};
          appendAutoSaveDebug({
            source: incoming.source || 'unknown',
            stage: incoming.stage || 'unknown',
            details: incoming.details || {},
            at: incoming.at || new Date().toISOString(),
            url: incoming.url || '',
          })
            .then(function () {
              sendResponse({ ok: true });
            })
            .catch(function (error) {
              sendResponse({ ok: false, error: error.message || 'Failed to append debug log.' });
            });
          return true;
        }

        if (request.type === 'getAutoSaveDebugInfo') {
          getStorage(['lastAutoSaveStatus', 'autoSaveDebugLog'])
            .then(function (state) {
              var logs = Array.isArray(state.autoSaveDebugLog) ? state.autoSaveDebugLog : [];
              sendResponse({
                ok: true,
                status: state.lastAutoSaveStatus || null,
                latest: logs.length ? logs[logs.length - 1] : null,
                logs: logs,
              });
            })
            .catch(function (error) {
              sendResponse({ ok: false, error: error.message || 'Failed to load debug info.' });
            });
          return true;
        }

        if (request.type === 'clearAutoSaveDebugLog') {
          setStorage({ autoSaveDebugLog: [] })
            .then(function () {
              sendResponse({ ok: true });
            })
            .catch(function (error) {
              sendResponse({ ok: false, error: error.message || 'Failed to clear debug log.' });
            });
          return true;
        }

        if (request.type === 'getOAuthRedirectUrl') {
          sendResponse({ ok: true, redirectUrl: OAUTH_REDIRECT_URI });
          return;
        }

        if (request.type === 'getAuthStatus') {
          getStorage(['githubToken', 'githubUsername'])
            .then(function (state) {
              sendResponse({
                ok: true,
                connected: Boolean(state.githubToken),
                username: state.githubUsername || '',
              });
            })
            .catch(function (error) {
              sendResponse({ ok: false, error: error.message || 'Failed to load auth status.' });
            });
          return true;
        }

        if (request.type === 'startGithubAuth') {
          startGithubOAuthFlow()
            .then(function (result) {
              sendResponse({ ok: true, result: result });
            })
            .catch(function (error) {
              sendResponse({ ok: false, error: error.message || 'GitHub connection failed.' });
            });
          return true;
        }

        if (request.type === 'saveOAuthConfig') {
          var cfg = request.payload || {};
          var updates = {};
          if (cfg.clientId) updates.githubOAuthClientId = String(cfg.clientId).trim();
          if (cfg.clientSecret) updates.githubOAuthClientSecret = String(cfg.clientSecret).trim();
          setStorage(updates)
            .then(function () {
              sendResponse({ ok: true });
            })
            .catch(function (error) {
              sendResponse({ ok: false, error: error.message || 'Failed to save OAuth config.' });
            });
          return true;
        }

        if (request.type === 'clearGithubAuth') {
          setStorage({
            githubToken: '',
            githubUsername: '',
            githubRepo: '',
          })
            .then(function () {
              sendResponse({ ok: true });
            })
            .catch(function (error) {
              sendResponse({ ok: false, error: error.message || 'Failed to clear auth.' });
            });
          return true;
        }

        if (request.type === 'listUserRepos') {
          getStorage(['githubToken'])
            .then(function (state) {
              if (!state.githubToken) {
                throw new Error('Connect GitHub first.');
              }
              return listGithubRepos(state.githubToken);
            })
            .then(function (repos) {
              var normalized = Array.isArray(repos)
                ? repos.map(function (repo) {
                    return {
                      name: repo.name,
                      full_name: repo.full_name,
                      private: Boolean(repo.private),
                    };
                  })
                : [];

              sendResponse({ ok: true, repos: normalized });
            })
            .catch(function (error) {
              sendResponse({ ok: false, error: error.message || 'Failed to list repositories.' });
            });
          return true;
        }

        if (request.type === 'createUserRepo') {
          var payload = request.payload || {};
          var repoName = String(payload.name || '').trim();
          if (!repoName) {
            sendResponse({ ok: false, error: 'Repository name is required.' });
            return;
          }

          getStorage(['githubToken'])
            .then(function (state) {
              if (!state.githubToken) {
                throw new Error('Connect GitHub first.');
              }

              return createGithubRepo(state.githubToken, repoName, Boolean(payload.isPrivate));
            })
            .then(function (repo) {
              return setStorage({ githubRepo: repo.full_name }).then(function () {
                return repo;
              });
            })
            .then(function (repo) {
              sendResponse({
                ok: true,
                repo: {
                  name: repo.name,
                  full_name: repo.full_name,
                  private: Boolean(repo.private),
                },
              });
            })
            .catch(function (error) {
              sendResponse({ ok: false, error: error.message || 'Failed to create repository.' });
            });
          return true;
        }

        if (request.type === 'getStats') {
          getStats()
            .then(function (stats) {
              sendResponse({ ok: true, stats: stats });
            })
            .catch(function (error) {
              sendResponse({ ok: false, error: error.message || 'Failed to load stats.' });
            });
          return true;
        }

        if (request.type === 'saveProblemToGithub') {
          var tabId = sender && sender.tab ? sender.tab.id : null;

          saveProblemToGithub(request.payload, tabId)
            .then(function (result) {
              if (request.payload && request.payload.autoTriggered) {
                setStorage({
                  lastAutoSaveStatus: {
                    ok: true,
                    at: new Date().toISOString(),
                    message: 'Auto-save successful.',
                  },
                });
                appendAutoSaveDebug({
                  source: 'background',
                  stage: 'save-success',
                  details: {
                    slug: request.payload.slug || '',
                    language: request.payload.language || '',
                    readmePath: result.readmePath || null,
                    codePath: result.codePath || null,
                  },
                  at: new Date().toISOString(),
                  url: request.payload.url || '',
                });
              }
              try {
                if (typeof sendResponse === 'function') {
                  sendResponse({ ok: true, result: result });
                }
              } catch (sendError) {
                console.warn('[leet-questions] Failed to send save response:', sendError.message);
              }
            })
            .catch(function (error) {
              if (request.payload && request.payload.autoTriggered) {
                setStorage({
                  lastAutoSaveStatus: {
                    ok: false,
                    at: new Date().toISOString(),
                    message: error.message || 'Failed to save problem.',
                  },
                });
                appendAutoSaveDebug({
                  source: 'background',
                  stage: 'save-failed',
                  details: {
                    slug: request.payload.slug || '',
                    language: request.payload.language || '',
                    error: error.message || 'Failed to save problem.',
                  },
                  at: new Date().toISOString(),
                  url: request.payload.url || '',
                });
              }
              try {
                if (typeof sendResponse === 'function') {
                  sendResponse({ ok: false, error: error.message || 'Failed to save problem.' });
                }
              } catch (sendError) {
                console.warn('[leet-questions] Failed to send error response:', sendError.message);
              }
            });

          return true;
        }

        if (request.type === 'bulkSaveProblemsToGithub') {
          bulkSaveProblemsToGithub(request.payload && request.payload.problems)
            .then(function (result) {
              appendAutoSaveDebug({
                source: 'background',
                stage: 'bulk-save-success',
                details: {
                  saved: result.saved || 0,
                  skipped: result.skipped || 0,
                  failed: result.failed || 0,
                  commitSha: result.commitSha || null,
                },
                at: new Date().toISOString(),
                url: '',
              });
              sendResponse({ ok: true, result: result });
            })
            .catch(function (error) {
              appendAutoSaveDebug({
                source: 'background',
                stage: 'bulk-save-failed',
                details: {
                  error: error && error.message ? error.message : 'Bulk save failed.',
                },
                at: new Date().toISOString(),
                url: '',
              });
              sendResponse({ ok: false, error: error.message || 'Bulk save failed.' });
            });
          return true;
        }
      } catch (handlerError) {
        console.warn('[leet-questions] Message listener error:', handlerError.message);
      }
    });
  } catch (setupError) {
    console.warn(
      '[leet-questions] Failed to setup background message listener:',
      setupError.message
    );
  }
}

setupBackgroundMessageListener();

// Global handler: catches GitHub OAuth redirect in the real tab
function setupTabsUpdateListener() {
  try {
    var tabs = typeof chrome !== 'undefined' && chrome && chrome.tabs ? chrome.tabs : null;
    if (!tabs || !tabs.onUpdated || typeof tabs.onUpdated.addListener !== 'function') {
      console.warn('[leet-questions] chrome.tabs.onUpdated not available in background');
      return;
    }
    tabs.onUpdated.addListener(function (tabId, changeInfo) {
      try {
        var url = changeInfo.url || '';
        if (!url || url.indexOf(OAUTH_REDIRECT_URI) !== 0 || url.indexOf('code=') === -1) {
          return;
        }

        getStorage([
          'githubOAuthPending',
          'githubOAuthState',
          'githubOAuthTabId',
          'githubOAuthClientId',
          'githubOAuthClientSecret',
        ])
          .then(function (stored) {
            if (!stored.githubOAuthPending || stored.githubOAuthTabId !== tabId) {
              return;
            }

            var code = getQueryParam(url, 'code');
            var returnedState = getQueryParam(url, 'state');
            var error = getQueryParam(url, 'error');

            // Immediately clear pending so we don't re-process
            setStorage({ githubOAuthPending: false, githubOAuthTabId: null });
            // Close the auth tab
            try {
              if (
                typeof chrome !== 'undefined' &&
                chrome &&
                chrome.tabs &&
                typeof chrome.tabs.remove === 'function'
              ) {
                chrome.tabs.remove(tabId, function () {
                  // Suppress errors silently (auth tab may be closed already)
                });
              }
            } catch (removeError) {
              console.warn('[leet-questions] Failed to remove auth tab:', removeError.message);
            }

            if (error || !code || returnedState !== stored.githubOAuthState) {
              return;
            }

            var oauthConfig = {
              clientId: stored.githubOAuthClientId || GITHUB_OAUTH_CLIENT_ID,
              clientSecret: stored.githubOAuthClientSecret || GITHUB_OAUTH_CLIENT_SECRET,
            };

            exchangeCodeForAccessToken(code, OAUTH_REDIRECT_URI, oauthConfig)
              .then(function (token) {
                return getGithubUser(token).then(function (user) {
                  var username = user && user.login ? user.login : '';
                  return ensureDefaultRepo(token, username).then(function (repo) {
                    return setStorage({
                      githubToken: token,
                      githubUsername: username,
                      githubRepo: repo,
                      githubBranch: 'main',
                      githubFolder: 'problems',
                    });
                  });
                });
              })
              .catch(function (err) {
                console.warn(
                  'LeetHub: OAuth completion error:',
                  err && err.message ? err.message : err
                );
              });
          })
          .catch(function () {});
      } catch (listenerError) {
        console.warn('[leet-questions] Tabs updated listener error:', listenerError.message);
      }
    });
  } catch (setupError) {
    console.warn('[leet-questions] Failed to setup tabs listener:', setupError.message);
  }
}

setupTabsUpdateListener();
