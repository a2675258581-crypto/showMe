// JavaScriptCore 的裸 JSContext 没有这些宿主 API；引擎里的库只在少数路径上用到，给最小实现。
var g = typeof globalThis !== 'undefined' ? globalThis : this
if (typeof g.queueMicrotask !== 'function') {
  g.queueMicrotask = function (fn) {
    Promise.resolve().then(fn)
  }
}
if (typeof g.setTimeout !== 'function') {
  g.setTimeout = function (fn) {
    var args = Array.prototype.slice.call(arguments, 2)
    Promise.resolve().then(function () {
      fn.apply(null, args)
    })
    return 0
  }
  g.clearTimeout = function () {}
}
if (typeof g.console === 'undefined') {
  var noop = function () {}
  g.console = { log: noop, warn: noop, error: noop, info: noop, debug: noop }
}
