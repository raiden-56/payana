// CloudFront Function (viewer-request) on the default behaviour.
//
// The web app is a single-page application: /explore, /bookings/123 and so on
// are routes inside index.html, not files in the bucket. A request whose last
// path segment has no dot is treated as an application route and served
// index.html. Anything that looks like a file (main-ABC123.js, ngsw.json,
// icons/icon-192.png) is passed through, so a missing file stays a 404.
//
// /api/* never reaches this function - it is matched by its own behaviour.
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var lastSegment = uri.substring(uri.lastIndexOf('/') + 1);

  if (lastSegment.indexOf('.') === -1) {
    request.uri = '/index.html';
  }

  return request;
}
