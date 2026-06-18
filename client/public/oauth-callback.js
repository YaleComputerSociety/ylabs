(function () {
  var ACCESS_TOKEN_PATTERN = /^[A-Za-z0-9._~+\/-]+=*$/;
  var OAUTH_STATE_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/;
  var MAX_ACCESS_TOKEN_LENGTH = 4096;
  var OAUTH_CHANNEL_NAME = 'google-oauth-token';

  function safeToken(value) {
    if (typeof value !== 'string') return '';
    if (!value || value !== value.trim()) return '';
    if (value.length > MAX_ACCESS_TOKEN_LENGTH) return '';
    return ACCESS_TOKEN_PATTERN.test(value) ? value : '';
  }

  function safeState(value) {
    if (typeof value !== 'string') return '';
    return OAUTH_STATE_PATTERN.test(value) ? value : '';
  }

  function oauthChannelNameForState(state) {
    return OAUTH_CHANNEL_NAME + ':' + state;
  }

  var hash = window.location.hash.substring(1);
  var params = new URLSearchParams(hash);
  var token = safeToken(params.get('access_token'));
  var state = safeState(params.get('state'));

  try {
    if (window.history && typeof window.history.replaceState === 'function') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  } catch (error) {
    // If history is unavailable, continue with the popup close path.
  }

  try {
    if (token && state) {
      var channel = new BroadcastChannel(oauthChannelNameForState(state));
      channel.postMessage({ type: OAUTH_CHANNEL_NAME, token: token, state: state });
      channel.close();
    }
  } catch (error) {
    // The opener is intentionally unavailable; unsupported browsers just close.
  }

  window.close();
})();
