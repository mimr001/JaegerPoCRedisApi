'use strict'

////////////////////// START Jaeger Stuff /////////////////////////
// Auto instrumentation MUST BE ON FIRST LINE!!!
const Instrument = require('@risingstack/opentracing-auto')

// Jaeger tracer (standard distributed tracing)
const jaeger = require('jaeger-client')
const UDPSender = require('jaeger-client/dist/src/reporters/udp_sender').default
const sampler = new jaeger.RateLimitingSampler(1)
// Need this since the Jaeger server parts (reporter, collector, storage etc) are running outside the scope of our
// Docker stack in this PoC. Real case scenario, the Jaeger server parts will either run in the same
// Docker stack or in a separate Docker stack but on the same host to avoid network latency to the reporter
const reporter = new jaeger.RemoteReporter(new UDPSender({
  host: 'docker.for.mac.localhost',
  // host: 'localhost',
  port: 6832
}))
const jaegerTracer = new jaeger.Tracer('jaeger-poc-redisapi-jaeger-tracer', reporter, sampler)

// Metrics tracer ("free" metrics data through the use of a second tracer)
const {Tags, FORMAT_HTTP_HEADERS} = require('opentracing')
const MetricsTracer = require('@risingstack/opentracing-metrics-tracer')
const prometheusReporter = new MetricsTracer.PrometheusReporter()
const metricsTracer = new MetricsTracer('jaeger-poc-redisapi-metrics-tracer', [prometheusReporter])

const instrument = new Instrument({
  tracers: [metricsTracer, jaegerTracer]
})
////////////////////// END Jaeger Stuff /////////////////////////

const express = require('express')
const http = require('http')
const redis = require('redis')

var app = express()
var redisClient = redis.createClient(6379, 'redis')

app.get('/counter', function(req, res, next) {
  // // TODO Fix this with .map() call on instrument.tracers instead
  var metricsSpan = createRpcSpan('GET/', req, metricsTracer)
  var jaegerSpan = createRpcSpan('GET/', req, jaegerTracer)
  var spans = [metricsSpan, jaegerSpan]

  console.log('In Redis API endpoint, calling redis')
  jaegerSpan.log({info: 'In Redis API endpoint, calling redis'})

  redisClient.incr('counter', function(err, counter) {
    if(err) {
      jaegerSpan.log({error: 'Error calling redis' + e})
      spans.map((s) => s.setTag(Tags.HTTP_STATUS_CODE, 500)) // Indicate error
      spans.map((s) => s.finish()) // Close spans
      return next(err)
    }

    spans.map((s) => s.finish()) // Close spans
    res.send('Redis counter is: ' + counter)
  })
})

function createRpcSpan(name, req, tracer) {
  // Instrumentation, check for any relevant http headers (debug ids etc)
  const span = tracer.startSpan(name, {
    childOf: tracer.extract(FORMAT_HTTP_HEADERS, req.headers)
  })
  const headers = {}

  tracer.inject(span, FORMAT_HTTP_HEADERS, headers)

  span.setTag(Tags.HTTP_URL, req.url)
  span.setTag(Tags.HTTP_METHOD, req.method || 'GET')
  // FIXME How do we know that here??? Should prob be set after success/failed call
  span.setTag(Tags.HTTP_STATUS_CODE, 200)
  span.setTag(Tags.SPAN_KIND_RPC_CLIENT, true)

  return span
}

http.createServer(app).listen(8081, function() {
  console.log('Listening on port 8081')
})