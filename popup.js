function setStatus(message, isError) {
  var statusEl = document.getElementById('status');
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#b42318' : '#1d2f55';
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

function sendRuntimeMessage(message) {
  return new Promise(function (resolve) {
    chrome.runtime.sendMessage(message, function (response) {
      resolve(response || {});
    });
  });
}

function readSettingsFromUI() {
  return {
    githubToken: document.getElementById('token').value.trim(),
    githubRepo: document.getElementById('repo').value.trim(),
    githubBranch: document.getElementById('branch').value.trim() || 'main',
    githubFolder: document.getElementById('folder').value.trim() || 'problems'
  };
}

async function handleSaveSettings() {
  var settings = readSettingsFromUI();
  if (!settings.githubToken || !settings.githubRepo) {
    setStatus('Token and repository are required.', true);
    return;
  }
  await setStorage(settings);
  setStatus('Settings saved.');
}

async function handleSaveProblem() {
  try {
    var tab = await queryActiveTab();
    if (!tab || !tab.id || !tab.url || tab.url.indexOf('leetcode.com/problems/') === -1) {
      setStatus('Open a LeetCode problem page first.', true);
      return;
    }

    var problem = await sendTabMessage(tab.id, { type: 'collectProblemData' });
    if (!problem || !problem.ok) {
      setStatus((problem && problem.error) || 'Could not read problem data from page.', true);
      return;
    }

    var result = await sendRuntimeMessage({
      type: 'saveProblemToGithub',
      payload: problem.data
    });

    if (!result.ok) {
      setStatus(result.error || 'GitHub save failed.', true);
      return;
    }

    var readmePath = result.result && result.result.readmePath ? result.result.readmePath : 'README path unavailable';
    var codePath = result.result && result.result.codePath ? result.result.codePath : null;
    if (codePath) {
      setStatus('Saved: ' + readmePath + ' and ' + codePath);
    } else {
      setStatus('Saved: ' + readmePath + ' (solution code not detected on page)');
    }
  } catch (error) {
    setStatus(error.message || 'Unexpected error.', true);
  }
}

async function init() {
  var saved = await getStorage(['githubToken', 'githubRepo', 'githubBranch', 'githubFolder']);
  document.getElementById('token').value = saved.githubToken || '';
  document.getElementById('repo').value = saved.githubRepo || '';
  document.getElementById('branch').value = saved.githubBranch || 'main';
  document.getElementById('folder').value = saved.githubFolder || 'problems';

  document.getElementById('saveSettings').addEventListener('click', handleSaveSettings);
  document.getElementById('saveProblem').addEventListener('click', handleSaveProblem);
}

document.addEventListener('DOMContentLoaded', init);
