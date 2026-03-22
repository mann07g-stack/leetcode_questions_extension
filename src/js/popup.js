function byId(id) {
  return document.getElementById(id);
}

function setStatus(message, isError) {
  var statusEl = byId('status');
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#ff7d90' : '#9fd6ff';
}

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

function queryActiveTab() {
  return new Promise(function (resolve) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      resolve(tabs && tabs[0] ? tabs[0] : null);
    });
  });
}

function sendTabMessage(tabId, message) {
  return new Promise(function (resolve, reject) {
    chrome.tabs.sendMessage(tabId, message, function (response) {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function injectContentScript(tabId) {
  return new Promise(function (resolve, reject) {
    chrome.scripting.executeScript(
      {
        target: { tabId: tabId },
        files: ['src/js/content.js'],
      },
      function () {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      }
    );
  });
}

function sendRuntimeMessage(message) {
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

function updateStatsUI(stats) {
  var safeStats = stats || {};
  byId('totalCount').textContent = String(safeStats.total || 0);
  byId('easyCount').textContent = String(safeStats.easy || 0);
  byId('mediumCount').textContent = String(safeStats.medium || 0);
  byId('hardCount').textContent = String(safeStats.hard || 0);
}

function updateDebugUI(info) {
  var debugEl = byId('debugStatus');
  if (!debugEl) {
    return;
  }

  if (!info || !info.ok) {
    debugEl.textContent = (info && info.error) || 'Could not load debug status.';
    return;
  }

  var latest = info.latest;
  var status = info.status;
  if (!latest && !status) {
    debugEl.textContent = 'No auto-save events yet.';
    return;
  }

  var stage = latest && latest.stage ? latest.stage : 'n/a';
  var details = latest && latest.details ? latest.details : {};
  var detailMessage = details.error || details.message || '';
  var statusMessage = status && status.message ? status.message : '';
  var at = (latest && latest.at) || (status && status.at) || '';

  var message = detailMessage || statusMessage;
  debugEl.textContent =
    'Stage: ' + stage + (message ? ' | ' + message : '') + (at ? ' | ' + at : '');
}

async function refreshAutoSaveDebug() {
  var info = await sendRuntimeMessage({ type: 'getAutoSaveDebugInfo' });
  updateDebugUI(info);
}

async function clearAutoSaveDebug() {
  var res = await sendRuntimeMessage({ type: 'clearAutoSaveDebugLog' });
  if (!res.ok) {
    setStatus(res.error || 'Failed to clear debug logs.', true);
    return;
  }
  await refreshAutoSaveDebug();
  setStatus('Auto-save debug log cleared.', false);
}

function setAuthState(connected, username) {
  var badge = byId('authBadge');
  var label = byId('authUser');

  if (connected) {
    badge.textContent = 'Connected';
    badge.className = 'pill pill-success';
    label.textContent = username ? 'Connected as ' + username : 'Connected to GitHub.';
    return;
  }

  badge.textContent = 'Not Connected';
  badge.className = 'pill pill-muted';
  label.textContent = 'Connect to continue.';
}

function clearRepoSelect() {
  var select = byId('repoSelect');
  select.innerHTML = '';
  var option = document.createElement('option');
  option.value = '';
  option.textContent = 'No repositories loaded';
  select.appendChild(option);
}

function populateRepoSelect(repos) {
  var select = byId('repoSelect');
  select.innerHTML = '';

  if (!repos || !repos.length) {
    clearRepoSelect();
    return;
  }

  for (var i = 0; i < repos.length; i += 1) {
    var repo = repos[i];
    var option = document.createElement('option');
    option.value = repo.full_name;
    option.textContent = repo.full_name + (repo.private ? ' (private)' : ' (public)');
    select.appendChild(option);
  }
}

async function refreshStats() {
  var response = await sendRuntimeMessage({ type: 'getStats' });
  if (response && response.ok && response.stats) {
    updateStatsUI(response.stats);
    return;
  }
  updateStatsUI({ total: 0, easy: 0, medium: 0, hard: 0 });
}

async function refreshAuthAndRepos() {
  var auth = await sendRuntimeMessage({ type: 'getAuthStatus' });
  if (!auth.ok) {
    setAuthState(false, '');
    clearRepoSelect();
    return;
  }

  setAuthState(Boolean(auth.connected), auth.username || '');
  if (!auth.connected) {
    clearRepoSelect();
    return;
  }

  var list = await sendRuntimeMessage({ type: 'listUserRepos' });
  if (!list.ok) {
    setStatus(list.error || 'Could not load repositories.', true);
    clearRepoSelect();
    return;
  }

  populateRepoSelect(list.repos || []);
}

function readSettingsFromUI() {
  return {
    githubToken: byId('token').value.trim(),
    githubRepo: byId('repo').value.trim(),
    githubBranch: byId('branch').value.trim() || 'main',
    githubFolder: byId('folder').value.trim() || 'problems',
  };
}

async function loadOAuthSetup() {
  byId('oauthRedirectUrl').value = 'https://github.com/';

  var saved = await getStorage(['githubOAuthClientId']);
  if (saved.githubOAuthClientId) {
    byId('oauthClientId').value = saved.githubOAuthClientId;
  }
}

async function handleSaveOAuthConfig() {
  var clientId = byId('oauthClientId').value.trim();
  var clientSecret = byId('oauthClientSecret').value.trim();

  if (!clientId || !clientSecret) {
    setStatus('Both Client ID and Client Secret are required.', true);
    return;
  }

  var res = await sendRuntimeMessage({
    type: 'saveOAuthConfig',
    payload: { clientId: clientId, clientSecret: clientSecret },
  });

  if (!res.ok) {
    setStatus(res.error || 'Failed to save OAuth config.', true);
    return;
  }

  setStatus('OAuth credentials saved. Click Connect GitHub.', false);
}

async function handleConnectGithub() {
  setStatus('Opening GitHub authorization in a new tab…', false);
  var response = await sendRuntimeMessage({ type: 'startGithubAuth' });
  if (!response.ok) {
    setStatus(response.error || 'GitHub connection failed.', true);
    return;
  }

  // Tab is open; poll every 2 s until background stores the token
  setStatus('Waiting for authorization… Approve on GitHub, then come back here.', false);
  var maxPolls = 90; // 3 minutes
  var pollsDone = 0;
  var pollTimer = setInterval(async function () {
    pollsDone += 1;
    if (pollsDone > maxPolls) {
      clearInterval(pollTimer);
      setStatus('Authorization timed out. Please try again.', true);
      return;
    }
    var auth = await sendRuntimeMessage({ type: 'getAuthStatus' });
    if (auth && auth.ok && auth.connected) {
      clearInterval(pollTimer);
      var saved = await getStorage(['githubRepo']);
      if (saved.githubRepo) {
        byId('repo').value = saved.githubRepo;
      }
      await refreshAuthAndRepos();
      setStatus('Connected as ' + (auth.username || 'GitHub user') + '!', false);
    }
  }, 2000);
}

async function handleDisconnectGithub() {
  var response = await sendRuntimeMessage({ type: 'clearGithubAuth' });
  if (!response.ok) {
    setStatus(response.error || 'Failed to disconnect.', true);
    return;
  }

  byId('token').value = '';
  setAuthState(false, '');
  clearRepoSelect();
  setStatus('Disconnected from GitHub.', false);
}

async function handleRefreshRepos() {
  var list = await sendRuntimeMessage({ type: 'listUserRepos' });
  if (!list.ok) {
    setStatus(list.error || 'Could not load repositories.', true);
    clearRepoSelect();
    return;
  }

  populateRepoSelect(list.repos || []);
  setStatus('Repository list updated.', false);
}

async function handleUseSelectedRepo() {
  var selected = byId('repoSelect').value;
  if (!selected) {
    setStatus('Select a repository first.', true);
    return;
  }

  byId('repo').value = selected;
  await setStorage({ githubRepo: selected });
  setStatus('Active repository set to ' + selected, false);
}

async function handleCreateRepo() {
  var name = byId('newRepoName').value.trim();
  var visibility = byId('newRepoVisibility').value;
  if (!name) {
    setStatus('Repository name is required.', true);
    return;
  }

  var response = await sendRuntimeMessage({
    type: 'createUserRepo',
    payload: {
      name: name,
      isPrivate: visibility !== 'public',
    },
  });

  if (!response.ok) {
    setStatus(response.error || 'Failed to create repository.', true);
    return;
  }

  byId('repo').value = response.repo.full_name;
  byId('newRepoName').value = '';
  await refreshAuthAndRepos();
  setStatus('Created and selected ' + response.repo.full_name, false);
}

async function handleSaveSettings() {
  var settings = readSettingsFromUI();
  var auth = await sendRuntimeMessage({ type: 'getAuthStatus' });
  var hasAuthToken = auth && auth.ok && auth.connected;

  if (!settings.githubRepo) {
    setStatus('Repository is required.', true);
    return;
  }

  if (!settings.githubToken && !hasAuthToken) {
    setStatus('Connect GitHub or paste a manual token.', true);
    return;
  }

  var payload = {
    githubRepo: settings.githubRepo,
    githubBranch: settings.githubBranch,
    githubFolder: settings.githubFolder,
  };
  if (settings.githubToken) {
    payload.githubToken = settings.githubToken;
  }

  await setStorage(payload);
  setStatus('Settings saved.', false);
}

async function handleSaveProblem() {
  setStatus('Manual save is disabled. Submit on LeetCode; accepted solutions auto-save only.', true);
}

async function init() {
  var saved = await getStorage(['githubToken', 'githubRepo', 'githubBranch', 'githubFolder']);

  byId('token').value = saved.githubToken || '';
  byId('repo').value = saved.githubRepo || '';
  byId('branch').value = saved.githubBranch || 'main';
  byId('folder').value = saved.githubFolder || 'problems';

  byId('connectGithub').addEventListener('click', handleConnectGithub);
  byId('disconnectGithub').addEventListener('click', handleDisconnectGithub);
  byId('refreshRepos').addEventListener('click', handleRefreshRepos);
  byId('useSelectedRepo').addEventListener('click', handleUseSelectedRepo);
  byId('createRepo').addEventListener('click', handleCreateRepo);
  byId('saveSettings').addEventListener('click', handleSaveSettings);
  byId('saveProblem').addEventListener('click', handleSaveProblem);
  byId('saveOAuthConfig').addEventListener('click', handleSaveOAuthConfig);
  byId('refreshDebug').addEventListener('click', refreshAutoSaveDebug);
  byId('clearDebug').addEventListener('click', clearAutoSaveDebug);

  byId('saveProblem').textContent = 'Auto-save Only';

  await loadOAuthSetup();
  await refreshStats();
  await refreshAuthAndRepos();
  await refreshAutoSaveDebug();
}

document.addEventListener('DOMContentLoaded', init);
