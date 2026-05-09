(function () {
  'use strict';

  var apiBaseUrlEl = document.getElementById('apiBaseUrl');
  var googleSignInBtnEl = document.getElementById('googleSignInBtn');
  var saveConfigBtnEl = document.getElementById('saveConfigBtn');
  var loginSectionEl = document.getElementById('login-section');
  var mainSectionEl = document.getElementById('main-section');
  var userInfoEl = document.getElementById('user-info');
  var userAvatarEl = document.getElementById('user-avatar');
  var userNameEl = document.getElementById('user-name');
  var userEmailEl = document.getElementById('user-email');
  var signOutBtnEl = document.getElementById('sign-out-btn');
  var toastEl = document.getElementById('toast');
  var errorEl = document.getElementById('error');
  var instancesEl = document.getElementById('instances');
  var idToken = null;
  var userProfile = null;
  var googleInitializedForClientId = '';
  var toastTimer = null;

  var bootstrapConfig = { api_base_url: '', google_client_id: '' };
  var runtimeConfig = { api_url: '', google_client_id: '' };

  function showError(msg) {
    errorEl.textContent = msg || '';
    errorEl.classList.toggle('hidden', !msg);
  }

  function hideToast() {
    if (!toastEl) return;
    toastEl.classList.add('hidden');
    toastEl.classList.remove('success', 'error');
  }

  function showToast(message, isError) {
    if (!toastEl || !message) return;
    if (toastTimer) clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.classList.remove('hidden', 'success', 'error');
    toastEl.classList.add(isError ? 'error' : 'success');
    toastTimer = setTimeout(hideToast, 3000);
  }

  function getApiBase() {
    if (apiBaseUrlEl && apiBaseUrlEl.value.trim()) return apiBaseUrlEl.value.trim();
    return runtimeConfig.api_url || bootstrapConfig.api_base_url || '';
  }

  function getClientId() {
    return runtimeConfig.google_client_id || bootstrapConfig.google_client_id || '';
  }

  function parseJwtClaims(token) {
    try {
      var parts = (token || '').split('.');
      if (parts.length < 2) return {};
      var payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (payload.length % 4) payload += '=';
      var decoded = atob(payload);
      var utf8 = decodeURIComponent(decoded.split('').map(function (ch) {
        return '%' + ('00' + ch.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      return JSON.parse(utf8);
    } catch (e) {
      return {};
    }
  }

  function safeString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function setAuthUi(isLoggedIn) {
    loginSectionEl.classList.toggle('hidden', isLoggedIn);
    mainSectionEl.classList.toggle('hidden', !isLoggedIn);
    userInfoEl.classList.toggle('hidden', !isLoggedIn);
  }

  function setUserProfile(profile) {
    userProfile = profile || null;
    if (userNameEl) userNameEl.textContent = (userProfile && userProfile.name) || '';
    if (userEmailEl) userEmailEl.textContent = (userProfile && userProfile.email) || '';

    if (userAvatarEl) {
      if (userProfile && userProfile.picture) {
        userAvatarEl.src = userProfile.picture;
        userAvatarEl.classList.remove('hidden');
      } else {
        userAvatarEl.src = '';
        userAvatarEl.classList.add('hidden');
      }
    }
  }

  function clearSessionUi() {
    idToken = null;
    setUserProfile(null);
    setAuthUi(false);
    instancesEl.innerHTML = '';
  }

  function initGoogleSignIn(force) {
    var clientId = bootstrapConfig.google_client_id;
    if (!clientId) {
      if (googleSignInBtnEl) {
        googleSignInBtnEl.innerHTML = '<span style="color:var(--text-muted);font-size:0.85rem">Loading config...</span>';
      }
      googleInitializedForClientId = '';
      return;
    }
    if (!force && googleInitializedForClientId === clientId) return;

    if (typeof google === 'undefined' || !google.accounts) {
      if (googleSignInBtnEl) {
        googleSignInBtnEl.innerHTML = '<span style="color:var(--text-muted);font-size:0.85rem">Loading Google...</span>';
      }
      return;
    }

    if (googleSignInBtnEl) googleSignInBtnEl.innerHTML = '';
    google.accounts.id.initialize({
      client_id: clientId,
      auto_select: false,
      callback: handleCredentialResponse
    });
    google.accounts.id.renderButton(googleSignInBtnEl, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'signin_with'
    });
    googleInitializedForClientId = clientId;
  }

  function handleCredentialResponse(response) {
    if (!response || !response.credential) return;
    idToken = response.credential;

    var claims = parseJwtClaims(idToken);
    setUserProfile({
      name: safeString(claims.name),
      email: safeString(claims.email),
      picture: safeString(claims.picture)
    });

    setAuthUi(true);
    showError('');
    showToast('Signed in successfully.', false);
    fetchUserConfigThenInstances();
  }

  function getBootstrapApiBase() {
    return bootstrapConfig.api_base_url || '';
  }

  function fetchUserConfigThenInstances() {
    var apiBase = getBootstrapApiBase();
    if (!apiBase) {
      runtimeConfig = { api_url: '', google_client_id: bootstrapConfig.google_client_id };
      if (apiBaseUrlEl) apiBaseUrlEl.value = '';
      showError('Enter API Gateway URL in Settings after saving config.');
      return fetchInstances();
    }
    apiFetch('/config', { baseOverride: apiBase })
      .then(function (res) {
        if (res.ok) return res.json();
        return {};
      })
      .then(function (data) {
        if (data && (data.api_url || data.google_client_id)) {
          runtimeConfig = {
            api_url: (data.api_url || '').trim(),
            google_client_id: (data.google_client_id || '').trim()
          };
        } else {
          runtimeConfig = {
            api_url: getBootstrapApiBase() || '',
            google_client_id: bootstrapConfig.google_client_id || ''
          };
        }
        if (apiBaseUrlEl) apiBaseUrlEl.value = runtimeConfig.api_url;
        return fetchInstances();
      })
      .catch(function () {
        runtimeConfig = {
          api_url: getBootstrapApiBase() || '',
          google_client_id: bootstrapConfig.google_client_id || ''
        };
        if (apiBaseUrlEl) apiBaseUrlEl.value = runtimeConfig.api_url;
        return fetchInstances();
      });
  }

  function signOut(silent) {
    var email = userProfile && userProfile.email;
    if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
      google.accounts.id.disableAutoSelect();
    }

    var finish = function () {
      clearSessionUi();
      showError('');
      if (!silent) showToast('Signed out.', false);
    };

    if (email && typeof google !== 'undefined' && google.accounts && google.accounts.id && typeof google.accounts.id.revoke === 'function') {
      google.accounts.id.revoke(email, finish);
    } else {
      finish();
    }
  }

  function apiFetch(path, options) {
    var base = (options && options.baseOverride) || getApiBase();
    if (!base) return Promise.reject(new Error('API Gateway URL not configured. Check Settings.'));
    var url = base.replace(/\/$/, '') + path;
    var headers = { 'Content-Type': 'application/json' };
    if (options && options.headers) {
      Object.assign(headers, options.headers);
    }
    if (idToken) headers['Authorization'] = 'Bearer ' + idToken;
    var opts = Object.assign({}, options);
    delete opts.baseOverride;
    return fetch(url, Object.assign({}, opts, { headers: headers }));
  }

  function saveConfig() {
    var apiUrl = (apiBaseUrlEl && apiBaseUrlEl.value.trim()) || '';
    var clientId = bootstrapConfig.google_client_id || '';
    if (!apiUrl) {
      showToast('API URL is required.', true);
      return;
    }
    if (!clientId) {
      showToast('Config not loaded. Refresh the page.', true);
      return;
    }
    showError('');
    apiFetch('/config', {
      method: 'POST',
      body: JSON.stringify({ api_url: apiUrl, google_client_id: clientId })
    })
      .then(function (res) {
        if (!res.ok) {
          return res.text().then(function (text) {
            var msg;
            try {
              var b = JSON.parse(text);
              msg = b.error || res.statusText;
            } catch (e) {
              msg = text || res.statusText;
            }
            throw new Error((msg || 'Save failed') + ' (HTTP ' + res.status + ')');
          });
        }
        return res.json();
      })
      .then(function () {
        runtimeConfig = { api_url: apiUrl, google_client_id: clientId };
        showToast('Config saved.', false);
      })
      .catch(function (err) {
        showToast(err.message || 'Failed to save config', true);
      });
  }

  function fetchInstances() {
    fetchSgRules();
    showError('');
    apiFetch('/instances')
      .then(function (res) {
        if (res.status === 401 || res.status === 403) {
          throw { authError: true, message: 'Unauthorized. Please sign in again.' };
        }
        if (!res.ok) {
          return res.text().then(function (text) {
            var msg;
            try {
              var b = JSON.parse(text);
              msg = b.error || res.statusText;
            } catch (e) {
              msg = (text && text.substring(0, 200)) || res.statusText;
            }
            var statusHint = res.status ? ' (HTTP ' + res.status + ')' : ' (check CORS/network)';
            throw new Error((msg || 'Request failed') + statusHint);
          });
        }
        return res.json();
      })
      .then(function (data) {
        if (!data || typeof data.instances === 'undefined') {
          throw new Error('Invalid response format');
        }
        renderInstances(data.instances || []);
      })
      .catch(function (err) {
        if (err && err.authError) {
          clearSessionUi();
          showToast(err.message, true);
          return;
        }
        showError(err.message || 'Failed to load instances');
        renderInstances([]);
        throw err;
      });
  }

  function formatRemaining(minutes) {
    if (minutes == null || minutes < 0) return '\u2014';
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function renderInstances(instances) {
    instancesEl.innerHTML = '';
    if (!instances.length) {
      instancesEl.innerHTML = '<p class="empty">No instances found.</p>';
      return;
    }
    var table = document.createElement('table');
    table.className = 'instances-table';
    table.innerHTML =
      '<thead><tr>' +
      '<th>Name</th>' +
      '<th>Instance ID</th>' +
      '<th>State</th>' +
      '<th>Type</th>' +
      '<th>Time left</th>' +
      '<th>Actions</th>' +
      '</tr></thead><tbody></tbody>';
    var tbody = table.querySelector('tbody');

    instances.forEach(function (inst) {
      var name = inst.name || inst.instance_id;
      var state = inst.state || 'unknown';
      var instanceType = inst.instance_type || '\u2014';
      var isActive = state === 'running' || state === 'pending';
      var remaining = isActive ? formatRemaining(inst.remaining_minutes) : '\u2014';

      var tr = document.createElement('tr');
      tr.className = 'instance-row state-' + state;
      var actionsHtml = '';
      if (state === 'stopped' || state === 'stopping' || state === 'terminated' || state === 'shutting-down') {
        [1, 2, 3].forEach(function (hours) {
          actionsHtml += '<button class="btn-primary" data-action="start" data-id="' + escapeHtml(inst.instance_id) + '" data-hours="' + hours + '">Start ' + hours + 'h</button>';
        });
      } else if (isActive) {
        [1, 2, 3].forEach(function (hours) {
          actionsHtml += '<button data-action="duration" data-id="' + escapeHtml(inst.instance_id) + '" data-hours="' + hours + '">Set ' + hours + 'h</button>';
        });
      } else {
        actionsHtml = '\u2014';
      }

      tr.innerHTML =
        '<td>' + escapeHtml(name) + '</td>' +
        '<td><code>' + escapeHtml(inst.instance_id) + '</code></td>' +
        '<td><span class="state-badge state-' + escapeHtml(state) + '">' + escapeHtml(state) + '</span></td>' +
        '<td>' + escapeHtml(instanceType) + '</td>' +
        '<td>' + (isActive && remaining !== '\u2014' ? '<span class="remaining">' + remaining + '</span>' : '\u2014') + '</td>' +
        '<td class="actions-cell">' + actionsHtml + '</td>';
      tbody.appendChild(tr);
    });

    instancesEl.appendChild(table);

    table.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-action]');
      if (!btn) return;
      var id = btn.getAttribute('data-id');
      var hours = parseInt(btn.getAttribute('data-hours'), 10);
      if (btn.getAttribute('data-action') === 'start') postStart(id, hours);
      else if (btn.getAttribute('data-action') === 'duration') postSetDuration(id, hours);
    });
  }

  function postStart(instanceId, hours) {
    showError('');
    apiFetch('/instances/' + encodeURIComponent(instanceId) + '/start', {
      method: 'POST',
      body: JSON.stringify({ hours: hours })
    })
      .then(function (res) {
        if (!res.ok) {
          return res.text().then(function (text) {
            var msg;
            try {
              var b = JSON.parse(text);
              msg = b.error || res.statusText;
            } catch (e) {
              msg = text || res.statusText;
            }
            throw new Error((msg || 'Start failed') + ' (HTTP ' + res.status + ')');
          });
        }
        return res.json();
      })
      .then(function () {
        showToast('Instance starting...', false);
        return new Promise(function (resolve) { setTimeout(resolve, 1500); });
      })
      .then(fetchInstances)
      .catch(function (err) { showError(err.message || 'Start failed'); });
  }

  function postSetDuration(instanceId, hours) {
    showError('');
    apiFetch('/instances/' + encodeURIComponent(instanceId) + '/set-duration', {
      method: 'POST',
      body: JSON.stringify({ hours: hours })
    })
      .then(function (res) {
        if (!res.ok) {
          return res.text().then(function (text) {
            var msg;
            try {
              var b = JSON.parse(text);
              msg = b.error || res.statusText;
            } catch (e) {
              msg = text || res.statusText;
            }
            throw new Error((msg || 'Set duration failed') + ' (HTTP ' + res.status + ')');
          });
        }
        return res.json();
      })
      .then(function () {
        showToast('Duration updated.', false);
        return fetchInstances();
      })
      .catch(function (err) { showError(err.message || 'Set duration failed'); });
  }

  // ── Security group management ──────────────────────────────────────────────

  var sgRulesContainerEl = document.getElementById('sg-rules-container');
  var sgNameEl = document.getElementById('sg-name');
  var sgIpEl = document.getElementById('sg-ip');
  var sgAddBtnEl = document.getElementById('sg-add-btn');
  var sgMyIpBtnEl = document.getElementById('sg-myip-btn');

  function fetchSgRules() {
    if (!sgRulesContainerEl) return;
    sgRulesContainerEl.innerHTML = '<p class="empty">Loading rules...</p>';
    apiFetch('/security-group/rules')
      .then(function (res) {
        if (!res.ok) return res.json().then(function (d) { throw new Error(d.error || res.statusText); });
        return res.json();
      })
      .then(function (data) {
        if (sgNameEl && data.sg_name) sgNameEl.textContent = data.sg_name;
        renderSgRules(data.rules || []);
      })
      .catch(function (err) {
        if (sgRulesContainerEl) sgRulesContainerEl.innerHTML = '<p class="error">' + escapeHtml(err.message || 'Failed to load rules') + '</p>';
      });
  }

  function renderSgRules(rules) {
    if (!sgRulesContainerEl) return;
    if (!rules.length) {
      sgRulesContainerEl.innerHTML = '<p class="empty">No inbound rules.</p>';
      return;
    }
    var table = document.createElement('table');
    table.className = 'instances-table';
    table.innerHTML =
      '<thead><tr><th>Protocol</th><th>Port range</th><th>Source</th></tr></thead><tbody></tbody>';
    var tbody = table.querySelector('tbody');
    rules.forEach(function (rule) {
      var portDisplay = rule.from_port === rule.to_port
        ? String(rule.from_port)
        : rule.from_port + '–' + rule.to_port;
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + escapeHtml(rule.protocol.toUpperCase()) + '</td>' +
        '<td>' + escapeHtml(portDisplay) + '</td>' +
        '<td>' + escapeHtml(rule.cidr) + '</td>';
      tbody.appendChild(tr);
    });
    sgRulesContainerEl.innerHTML = '';
    sgRulesContainerEl.appendChild(table);
  }

  function addSgRule() {
    var ip = (sgIpEl && sgIpEl.value.trim()) || '';
    if (!ip) { showToast('IP address is required.', true); return; }
    if (sgAddBtnEl) sgAddBtnEl.disabled = true;

    var port = '20-59999';
    var postOne = function (protocol) {
      return apiFetch('/security-group/rules', {
        method: 'POST',
        body: JSON.stringify({ ip: ip, port: port, protocol: protocol })
      }).then(function (res) {
        if (!res.ok) return res.json().then(function (d) { throw new Error(d.error || res.statusText); });
        return res.json();
      });
    };

    Promise.all([postOne('tcp'), postOne('udp')])
      .then(function () {
        showToast('Rules added (TCP + UDP 20–59999).', false);
        if (sgIpEl) sgIpEl.value = '';
        fetchSgRules();
      })
      .catch(function (err) {
        showToast(err.message || 'Failed to add rules', true);
      })
      .finally(function () {
        if (sgAddBtnEl) sgAddBtnEl.disabled = false;
      });
  }

  function fetchMyIp() {
    if (sgMyIpBtnEl) sgMyIpBtnEl.disabled = true;
    fetch('https://api.ipify.org?format=json')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (sgIpEl && data.ip) sgIpEl.value = data.ip;
      })
      .catch(function () { showToast('Could not detect your IP.', true); })
      .finally(function () { if (sgMyIpBtnEl) sgMyIpBtnEl.disabled = false; });
  }

  if (sgAddBtnEl) sgAddBtnEl.addEventListener('click', addSgRule);
  if (sgMyIpBtnEl) sgMyIpBtnEl.addEventListener('click', fetchMyIp);

  // ── End security group ─────────────────────────────────────────────────────

  if (signOutBtnEl) {
    signOutBtnEl.addEventListener('click', function () { signOut(false); });
  }
  if (toastEl) {
    toastEl.addEventListener('click', hideToast);
  }

  if (saveConfigBtnEl) {
    saveConfigBtnEl.addEventListener('click', saveConfig);
  }

  var configToggleBtnEl = document.getElementById('config-toggle-btn');
  var configContentEl = document.getElementById('config-content');
  var configSectionEl = document.getElementById('config-section');
  if (configToggleBtnEl && configContentEl && configSectionEl) {
    configToggleBtnEl.addEventListener('click', function () {
      var wasHidden = configContentEl.classList.contains('hidden');
      configContentEl.classList.toggle('hidden');
      configSectionEl.classList.toggle('expanded', wasHidden);
      configToggleBtnEl.setAttribute('aria-expanded', wasHidden);
    });
  }

  window.addEventListener('load', function () {
    setAuthUi(false);
    fetch((window.location.href.replace(/[^/]*$/, '') || window.location.origin + '/') + 'config.json')
      .then(function (res) { return res.ok ? res.json() : {}; })
      .catch(function () { return {}; })
      .then(function (cfg) {
        bootstrapConfig = {
          api_base_url: (cfg.api_base_url || '').trim(),
          google_client_id: (cfg.google_client_id || '').trim()
        };
        initGoogleSignIn(true);
      });
  });
})();
