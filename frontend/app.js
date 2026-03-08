(function () {
  'use strict';

  var apiBaseUrlEl = document.getElementById('apiBaseUrl');
  var googleClientIdEl = document.getElementById('googleClientId');
  var googleSignInBtnEl = document.getElementById('googleSignInBtn');
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

  if (apiBaseUrlEl && localStorage.getItem('iw_api_url')) {
    apiBaseUrlEl.value = localStorage.getItem('iw_api_url');
  }
  if (googleClientIdEl && localStorage.getItem('iw_client_id')) {
    googleClientIdEl.value = localStorage.getItem('iw_client_id');
  }

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
    return (apiBaseUrlEl && apiBaseUrlEl.value.trim()) || '';
  }

  function getClientId() {
    return (googleClientIdEl && googleClientIdEl.value.trim()) || '';
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
    var clientId = getClientId();
    if (!clientId) {
      if (googleSignInBtnEl) googleSignInBtnEl.innerHTML = '';
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
    fetchInstances();
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
    var base = getApiBase();
    if (!base) return Promise.reject(new Error('Set the API Gateway URL above'));
    var url = base.replace(/\/$/, '') + path;
    var headers = { 'Content-Type': 'application/json' };
    if (options && options.headers) {
      Object.assign(headers, options.headers);
    }
    if (idToken) headers['Authorization'] = 'Bearer ' + idToken;
    return fetch(url, Object.assign({}, options, { headers: headers }));
  }

  function fetchInstances() {
    showError('');
    apiFetch('/instances')
      .then(function (res) {
        if (res.status === 401 || res.status === 403) {
          throw { authError: true, message: 'Unauthorized. Please sign in again.' };
        }
        if (!res.ok) return res.json().then(function (b) { throw new Error(b.error || res.statusText); });
        return res.json();
      })
      .then(function (data) { renderInstances(data.instances || []); })
      .catch(function (err) {
        if (err && err.authError) {
          clearSessionUi();
          showToast(err.message, true);
          return;
        }
        showError(err.message || 'Failed to load instances');
        renderInstances([]);
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
        if (!res.ok) return res.json().then(function (b) { throw new Error(b.error || res.statusText); });
        return res.json();
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
        if (!res.ok) return res.json().then(function (b) { throw new Error(b.error || res.statusText); });
        return res.json();
      })
      .then(fetchInstances)
      .catch(function (err) { showError(err.message || 'Set duration failed'); });
  }

  if (signOutBtnEl) {
    signOutBtnEl.addEventListener('click', function () { signOut(false); });
  }
  if (toastEl) {
    toastEl.addEventListener('click', hideToast);
  }

  if (apiBaseUrlEl) {
    apiBaseUrlEl.addEventListener('change', function () {
      localStorage.setItem('iw_api_url', apiBaseUrlEl.value.trim());
    });
  }
  if (googleClientIdEl) {
    googleClientIdEl.addEventListener('input', function () {
      var value = googleClientIdEl.value.trim();
      localStorage.setItem('iw_client_id', value);
      if (value !== googleInitializedForClientId) initGoogleSignIn(true);
    });
    googleClientIdEl.addEventListener('change', function () {
      var value = googleClientIdEl.value.trim();
      localStorage.setItem('iw_client_id', value);
      if (value !== googleInitializedForClientId) initGoogleSignIn(true);
    });
  }

  window.addEventListener('load', function () {
    setAuthUi(false);
    initGoogleSignIn(true);
  });
})();
