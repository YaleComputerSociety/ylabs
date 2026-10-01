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

  window.gtag('js', new Date());
  window.gtag('config', MEASUREMENT_ID);

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

  function isMeasurementRequest(resource) {
    var target =
      typeof resource === 'string'
        ? resource
        : resource && typeof resource.url === 'string'
          ? resource.url
          : '';
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
  // property treats as a site search, so neither the config above nor any gtag call can
  // keep a student's typed query out of them. Redacting on the way out is the only place
  // this repository can make that guarantee rather than leaving it to a Google property
  // setting. A hit whose shape cannot be read is dropped rather than sent, so a transport
  // change by Google costs measurement instead of leaking text.
  var nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function (resource, options) {
      if (!isMeasurementRequest(resource)) return nativeFetch.apply(this, arguments);
      var body = options && options.body;
      if (typeof resource !== 'string' || !isRedactableBody(body)) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      var redactedOptions = Object.assign({}, options);
      if (body != null) redactedOptions.body = redactedBody(body);
      return nativeFetch.call(this, redactedUrl(resource), redactedOptions);
    };
  }

  var nativeSendBeacon =
    typeof navigator.sendBeacon === 'function' ? navigator.sendBeacon.bind(navigator) : null;
  if (nativeSendBeacon) {
    navigator.sendBeacon = function (resource, body) {
      if (!isMeasurementRequest(resource)) return nativeSendBeacon(resource, body);
      if (typeof resource !== 'string' || !isRedactableBody(body)) return true;
      return body == null
        ? nativeSendBeacon(redactedUrl(resource))
        : nativeSendBeacon(redactedUrl(resource), redactedBody(body));
    };
  }

  var nativeOpen = XMLHttpRequest.prototype.open;
  var nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, resource) {
    this.__measurementHit = isMeasurementRequest(resource);
    this.__unredactableMeasurementHit = this.__measurementHit && typeof resource !== 'string';
    var target =
      this.__measurementHit && !this.__unredactableMeasurementHit
        ? redactedUrl(resource)
        : resource;
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
})();
