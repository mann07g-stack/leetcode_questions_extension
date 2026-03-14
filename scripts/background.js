function getStorage(keys) {
  return new Promise(function (resolve) {
    chrome.storage.sync.get(keys, function (data) {
      resolve(data || {});
    });
  });
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

function languageToExtension(language) {
  var map = {
    c: '.c',
    cpp: '.cpp',
    'c++': '.cpp',
    java: '.java',
    python: '.py',
    python3: '.py',
    javascript: '.js',
    typescript: '.ts',
    go: '.go',
    kotlin: '.kt',
    rust: '.rs',
    ruby: '.rb',
    swift: '.swift',
    php: '.php',
    scala: '.scala',
    'c#': '.cs',
    csharp: '.cs',
    mysql: '.sql',
    mssql: '.sql',
    oracle: '.sql'
  };

  var key = normalizeLanguage(language).replace(/\s+/g, '');
  return map[key] || '.txt';
}

function buildMarkdown(problem) {
  var lines = [];
  lines.push('# ' + problem.title);
  lines.push('');
  lines.push('- Difficulty: ' + problem.difficulty);
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
  } catch (e) {
    json = { raw: text };
  }
  return { response: response, json: json };
}

async function upsertGithubFile(params) {
  var headers = {
    Authorization: 'Bearer ' + params.token,
    Accept: 'application/vnd.github+json'
  };

  var encodedPath = params.path.split('/').map(encodeURIComponent).join('/');
  var apiUrl = 'https://api.github.com/repos/' + params.repo + '/contents/' + encodedPath;

  var existing = await githubRequest(apiUrl + '?ref=' + encodeURIComponent(params.branch), {
    method: 'GET',
    headers: headers
  });

  var payload = {
    message: params.message,
    content: toBase64Unicode(params.content),
    branch: params.branch
  };

  if (existing.response.ok && existing.json && existing.json.sha) {
    payload.sha = existing.json.sha;
  }

  var writeResult = await githubRequest(apiUrl, {
    method: 'PUT',
    headers: {
      Authorization: headers.Authorization,
      Accept: headers.Accept,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!writeResult.response.ok) {
    var message = writeResult.json && writeResult.json.message ? writeResult.json.message : 'GitHub API error';
    throw new Error(message);
  }
}

async function saveProblemToGithub(problem) {
  var config = await getStorage(['githubToken', 'githubRepo', 'githubBranch', 'githubFolder']);
  var token = config.githubToken;
  var repo = config.githubRepo;
  var branch = config.githubBranch || 'main';
  var folder = config.githubFolder || 'problems';

  if (!token || !repo) {
    throw new Error('Missing GitHub token or repository. Save settings in popup.');
  }

  var slug = normalizePathSegment(problem.slug || problem.title || 'problem');
  var base = folder.replace(/^\/+|\/+$/g, '') + '/' + slug;
  var readmePath = base + '/README.md';
  var markdownContent = buildMarkdown(problem);

  await upsertGithubFile({
    token: token,
    repo: repo,
    branch: branch,
    path: readmePath,
    content: markdownContent,
    message: 'docs: save ' + problem.title
  });

  var codePath = null;
  if (problem.code && problem.code.trim()) {
    codePath = base + '/solution' + languageToExtension(problem.language);

    await upsertGithubFile({
      token: token,
      repo: repo,
      branch: branch,
      path: codePath,
      content: problem.code,
      message: 'code: save ' + problem.title + ' solution'
    });
  }

  return {
    readmePath: readmePath,
    codePath: codePath
  };
}

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (!request || request.type !== 'saveProblemToGithub') {
    return;
  }

  saveProblemToGithub(request.payload)
    .then(function (result) {
      sendResponse({ ok: true, result: result });
    })
    .catch(function (error) {
      sendResponse({ ok: false, error: error.message || 'Failed to save problem.' });
    });

  return true;
});
