(function () {
  var MEASUREMENT_ID = 'G-3SQLGT56ZM';
  var MEASUREMENT_HOST =
    /^([a-z0-9-]+\.)*(google-analytics\.com|analytics\.google\.com|doubleclick\.net)$/i;
  var SEARCH_TERM_PARAMETER = 'ep.search_term';
  var ABSOLUTE_HTTP_URL = /^https?:\/\//i;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };

  function withoutQueryOrFragment(value) {
    try {
      var url = new URL(value);
      return url.origin + url.pathname;
    } catch (error) {
      return value;
    }
  }

  function redactParameters(parameters) {
    parameters.delete(SEARCH_TERM_PARAMETER);
    var urlValuedNames = [];
    parameters.forEach(function (value, name) {
      if (ABSOLUTE_HTTP_URL.test(value)) urlValuedNames.push(name);
    });
    urlValuedNames.forEach(function (name) {
      parameters.set(name, withoutQueryOrFragment(parameters.get(name)));
    });
  }

  function rewritableTarget(resource) {
    if (typeof resource === 'string') return resource;
    return resource && typeof resource.href === 'string' ? resource.href : null;
  }

  function requestTarget(resource) {
    var rewritable = rewritableTarget(resource);
    if (rewritable !== null) return rewritable;
    return resource && typeof resource.url === 'string' ? resource.url : null;
  }

  function isMeasurementRequest(resource) {
    var target = requestTarget(resource);
    if (!target) return false;
    try {
      return MEASUREMENT_HOST.test(new URL(target, window.location.href).hostname);
    } catch (error) {
      return false;
    }
  }

  function redactedUrl(target) {
    var url = new URL(target, window.location.href);
    redactParameters(url.searchParams);
    return url.toString();
  }

  function redactedBody(body) {
    return body
      .split('\n')
      .map(function (line) {
        if (!line) return line;
        var parameters = new URLSearchParams(line);
        redactParameters(parameters);
        return parameters.toString();
      })
      .join('\n');
  }

  function isRedactableBody(body) {
    return body == null || typeof body === 'string';
  }

  // The tag builds its own hits out of location.href and out of the query parameters the
  // property treats as a site search, so neither the config call below nor any gtag call can
  // keep a student's typed query out of them. Redacting on the way out is the only place
  // this repository can make that guarantee rather than leaving it to a Google property
  // setting. A hit whose shape cannot be read is dropped rather than sent, so a transport
  // change by Google costs measurement instead of leaking text.
  var nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function (resource, options) {
      if (!isMeasurementRequest(resource)) return nativeFetch.apply(this, arguments);
      var target = rewritableTarget(resource);
      var body = options && options.body;
      if (target === null || !isRedactableBody(body)) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      var redactedOptions = Object.assign({}, options);
      if (body != null) redactedOptions.body = redactedBody(body);
      return nativeFetch.call(this, redactedUrl(target), redactedOptions);
    };
  }

  var nativeSendBeacon =
    typeof navigator.sendBeacon === 'function' ? navigator.sendBeacon.bind(navigator) : null;
  if (nativeSendBeacon) {
    navigator.sendBeacon = function (resource, body) {
      if (!isMeasurementRequest(resource)) return nativeSendBeacon(resource, body);
      var target = rewritableTarget(resource);
      if (target === null || !isRedactableBody(body)) return true;
      return body == null
        ? nativeSendBeacon(redactedUrl(target))
        : nativeSendBeacon(redactedUrl(target), redactedBody(body));
    };
  }

  var nativeOpen = XMLHttpRequest.prototype.open;
  var nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, resource) {
    this.__measurementHit = isMeasurementRequest(resource);
    var rewritable = this.__measurementHit ? rewritableTarget(resource) : null;
    this.__unredactableMeasurementHit = this.__measurementHit && rewritable === null;
    var target = rewritable === null ? resource : redactedUrl(rewritable);
    return nativeOpen.apply(
      this,
      [method, target].concat(Array.prototype.slice.call(arguments, 2)),
    );
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (!this.__measurementHit) return nativeSend.apply(this, arguments);
    if (this.__unredactableMeasurementHit || !isRedactableBody(body)) return undefined;
    return body == null ? nativeSend.call(this) : nativeSend.call(this, redactedBody(body));
  };

  // These two pushes come last because gtag.js loads async and may already have replaced
  // dataLayer.push with its command processor, in which case the config push initialises
  // GA4 and sends its first hit synchronously, through whichever transports are installed
  // at that moment. Configuring before the wrappers exist would let that first hit leave
  // unredacted on exactly the page whose address bar holds the typed query.
  window.gtag('js', new Date());
  window.gtag('config', MEASUREMENT_ID);
})();
