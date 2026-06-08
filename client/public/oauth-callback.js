(function () {
  var hash = window.location.hash.substring(1);
  var params = new URLSearchParams(hash);
  var token = params.get('access_token');
  var state = params.get('state');

  try {
    if (window.history && typeof window.history.replaceState === 'function') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  } catch (error) {
    // If history is unavailable, continue with the popup close path.
  }

  try {
    var channel = new BroadcastChannel('google-oauth-token');
    channel.postMessage({ type: 'google-oauth-token', token: token, state: state });
    channel.close();
  } catch (error) {
    // The opener is intentionally unavailable; unsupported browsers just close.
  }

  window.close();
})();
