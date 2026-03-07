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
  var signOutBtnEl = document.getElementById('sign-out-btn');
  var errorEl = document.getElementById('error');
  var instancesEl = document.getElementById('instances');
  var idToken = null;

  // Persist config across page loads
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

  function getApiBase() {
    return (apiBaseUrlEl && apiBaseUrlEl.value.trim()) || '';
  }

  function getClientId() {
    return (googleClientIdEl && googleClientIdEl.value.trim()) || '';
  }

  function parseJwt(token) {
    try {
      return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    } catch (e) {
      return {};
    }
  }

  function initGoogleSignIn() {
    var clientId = getClientId();
    if (!clientId) {
      if (googleSignInBtnEl) googleSignInBtnEl.innerHTML = '';
      return;
    }
    if (typeof google === 'undefined' || !google.accounts) {
      if (googleSignInBtnEl) googleSignInBtnEl.innerHTML = '<span style="color:var(--text-muted);font-size:0.85rem">Loading Google…</span>';
      return;
    }
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
  }

  function handleCredentialResponse(response) {
    if (!response || !response.credential) return;
    idToken = response.credential;

    var claims = parseJwt(idToken);
    if (userAvatarEl && claims.picture) {
      userAvatarEl.src = claims.picture;
      userAvatarEl.classList.remove('hidden');
    }
    if (userNameEl && claims.name) {
      userNameEl.textContent = claims.name;
    }

    loginSectionEl.classList.add('hidden');
    mainSectionEl.classList.remove('hidden');
    userInfoEl.classList.remove('hidden');
    showError('');
    fetchInstances();
  }

  function signOut() {
    idToken = null;
    if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
      google.accounts.id.disableAutoSelect();
    }
    mainSectionEl.classList.add('hidden');
    loginSectionEl.classList.remove('hidden');
    userInfoEl.classList.add('hidden');
    if (userAvatarEl) userAvatarEl.src = '';
    if (userNameEl) userNameEl.textContent = '';
    instancesEl.innerHTML = '';
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
        if (!res.ok) return res.json().then(function (b) { throw new Error(b.error || res.statusText); });
        return res.json();
      })
      .then(function (data) { renderInstances(data.instances || []); })
      .catch(function (err) {
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
    instances.forEach(function (inst) {
      var card = document.createElement('div');
      card.className = 'instance-card ' + (inst.state || '');
      var name = inst.name || inst.instance_id;
      var state = inst.state || 'unknown';
      var instanceType = inst.instance_type || '\u2014';
      var isActive = state === 'running' || state === 'pending';
      var remaining = isActive ? formatRemaining(inst.remaining_minutes) : '\u2014';

      card.innerHTML =
        '<h3>' + escapeHtml(name) + '</h3>' +
        '<div class="meta">' + escapeHtml(inst.instance_id) + ' \u00b7 ' + escapeHtml(state) + ' \u00b7 ' + escapeHtml(instanceType) + '</div>' +
        (isActive && remaining !== '\u2014' ? '<div class="remaining">Time left: ' + remaining + '</div>' : '') +
        '<div class="actions"></div>';

      var actions = card.querySelector('.actions');
      if (state === 'stopped' || state === 'stopping' || state === 'terminated' || state === 'shutting-down') {
        [1, 2, 3].forEach(function (hours) {
          var btn = document.createElement('button');
          btn.className = 'primary';
          btn.textContent = 'Start ' + hours + 'h';
          btn.addEventListener('click', function () { postStart(inst.instance_id, hours); });
          actions.appendChild(btn);
        });
      } else if (isActive) {
        [1, 2, 3].forEach(function (hours) {
          var btn = document.createElement('button');
          btn.textContent = 'Set ' + hours + 'h';
          btn.addEventListener('click', function () { postSetDuration(inst.instance_id, hours); });
          actions.appendChild(btn);
        });
      }
      instancesEl.appendChild(card);
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

  if (signOutBtnEl) signOutBtnEl.addEventListener('click', signOut);

  if (apiBaseUrlEl) {
    apiBaseUrlEl.addEventListener('change', function () {
      localStorage.setItem('iw_api_url', apiBaseUrlEl.value.trim());
    });
  }
  if (googleClientIdEl) {
    googleClientIdEl.addEventListener('input', function () {
      localStorage.setItem('iw_client_id', googleClientIdEl.value.trim());
      initGoogleSignIn();
    });
    googleClientIdEl.addEventListener('change', initGoogleSignIn);
  }

  window.addEventListener('load', initGoogleSignIn);
})();
